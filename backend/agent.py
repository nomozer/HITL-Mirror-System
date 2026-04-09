"""
agent.py — Dual-Persona Gemini Engine (Coder + Critic)
Purpose: Orchestrates two Gemini model instances with distinct system
         instructions to simulate an AI self-critique loop.
Author: [Your Name]
Research Project: HITL Agentic Code-Learning System — "Mirror" Edition
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any

import google.generativeai as genai
from dotenv import load_dotenv

from memory import MemoryManager
from prompt_orchestrator import PromptOrchestrator, Role

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------


@dataclass
class PipelineResult:
    """Immutable output of a single pipeline run."""

    code: str
    critique: dict[str, Any]
    lessons_used: list[dict[str, Any]] = field(default_factory=list)
    run_id: int | None = None
    # Transparency: the fully-assembled prompt bundles for UI inspector / research
    coder_prompt: dict[str, Any] | None = None
    critic_prompt: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Agent wrappers
# ---------------------------------------------------------------------------

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


def _configure_genai() -> None:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "GOOGLE_API_KEY is missing. Set it in your .env file."
        )
    genai.configure(api_key=api_key)


def _create_model(system_instruction: str) -> genai.GenerativeModel:
    return genai.GenerativeModel(
        model_name=GEMINI_MODEL,
        system_instruction=system_instruction,
    )


def _extract_code_block(text: str) -> str:
    """Pull the first ```python ... ``` block out of model output."""
    match = re.search(r"```python\s*\n(.*?)```", text, re.DOTALL)
    return match.group(1).strip() if match else text.strip()


def _parse_critique_json(text: str) -> dict[str, Any]:
    """Best-effort extraction of JSON from critic response."""
    # Strip markdown fences if present
    cleaned = re.sub(r"```(?:json)?\s*\n?", "", text).strip()
    cleaned = cleaned.rstrip("`").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Fallback: try to find first { ... } blob
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        return {
            "issues": [{"dimension": "Parse Error", "description": cleaned, "line": None}],
            "severity": "medium",
            "suggestion": "Could not parse critic output — review manually.",
        }


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

MAX_RETRIES = 3
RETRY_BASE_DELAY = 2  # seconds


class AgentOrchestrator:
    """Runs the Coder → Critic pipeline with retry & memory integration.

    Prompt assembly is delegated to PromptOrchestrator (injection-safe
    system/memory/dynamic decomposition + research logging).
    """

    def __init__(
        self,
        memory: MemoryManager | None = None,
        prompt_orchestrator: PromptOrchestrator | None = None,
    ) -> None:
        _configure_genai()
        self.memory = memory or MemoryManager()
        self.prompts = prompt_orchestrator or PromptOrchestrator(self.memory)

    # ---- internal ---------------------------------------------------------

    # _get_models removed as system prompts are now managed by PromptOrchestrator.

    async def _call_with_retry(
        self, model: genai.GenerativeModel, prompt: str
    ) -> str:
        """Call Gemini with exponential backoff on 429 / 503."""
        last_exc: Exception | None = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = await asyncio.to_thread(
                    model.generate_content, prompt
                )
                return response.text
            except Exception as exc:
                last_exc = exc
                err_str = str(exc)
                retryable = any(code in err_str for code in ("429", "503"))
                if retryable and attempt < MAX_RETRIES:
                    delay = RETRY_BASE_DELAY ** attempt
                    logger.warning(
                        "Gemini %s — retrying in %ss (attempt %d/%d)",
                        err_str[:80],
                        delay,
                        attempt,
                        MAX_RETRIES,
                    )
                    await asyncio.sleep(delay)
                else:
                    raise
        # BUG-4 FIX: guard against None before raising
        if last_exc is not None:
            raise last_exc
        raise RuntimeError("Pipeline retry loop exited unexpectedly.")

    # ---- public -----------------------------------------------------------

    async def run_pipeline(
        self,
        task: str,
        lang: str = "en",
        feedback: str | None = None,
    ) -> PipelineResult:
        """Execute the full Coder → Critic pipeline.

        Args:
            task: Natural-language task description.
            lang: Language code ('en' or 'vi') for prompts and critique output.
            feedback: Optional human feedback to inject on a retry round.

        Steps:
            1. Build coder PromptBundle (system + lessons + task [+ feedback]).
            2. Create Gemini Coder model with bundle.system; generate code.
            3. Wait 2 s (Gemini rate-limit courtesy).
            4. Build critic PromptBundle (system + lessons + task + code).
            5. Create Gemini Critic model with bundle.system; parse JSON critique.
            6. Log the pipeline run to SQLite.

        Returns:
            PipelineResult with code, critique, lessons_used, run_id, and the
            two PromptBundles (as dicts) for UI transparency and research.
        """
        # 1 — Build coder prompt via orchestrator
        coder_bundle = self.prompts.build_prompt(
            role=Role.CODER,
            task=task,
            feedback=feedback,
            lang=lang,
        )

        # 2 — Create model dynamically using the bundle's system instructions
        coder_model = _create_model(coder_bundle.system)
        raw_code = await self._call_with_retry(coder_model, coder_bundle.user_content)
        code = _extract_code_block(raw_code)

        # 3 — Rate-limit gap
        await asyncio.sleep(2)

        # 4 — Build critic prompt (with generated code attached)
        critic_bundle = self.prompts.build_prompt(
            role=Role.CRITIC,
            task=task,
            code=code,
            lang=lang,
        )

        # 5 — Create critic model dynamically and review
        critic_model = _create_model(critic_bundle.system)
        raw_critique = await self._call_with_retry(critic_model, critic_bundle.user_content)
        critique = _parse_critique_json(raw_critique)

        # 6 — Log pipeline run
        auto_fixed = critique.get("severity") == "low"
        run_id = self.memory.log_pipeline_run(
            task=task, iterations=1, auto_fixed=auto_fixed
        )

        return PipelineResult(
            code=code,
            critique=critique,
            lessons_used=coder_bundle.lessons_used,
            run_id=run_id,
            coder_prompt=coder_bundle.to_dict(),
            critic_prompt=critic_bundle.to_dict(),
        )
