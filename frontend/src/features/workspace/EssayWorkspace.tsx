import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentPipeline } from "../../hooks/useAgentPipeline";
import { useFeedback } from "../../hooks/useFeedback";
import { ApiError, detectSubject, finalizeGrade, type DetectConfidence } from "../../api";
import { T } from "../../theme/tokens";
import { i18n } from "../../i18n";
import { Icon } from "../../components/ui/Icon";
import { parseCauHeader, parseGrade } from "../../lib/grade";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { StepIndicator } from "../../components/layout/StepIndicator";
import { subjectLabelOf } from "../../lib/subject";
import { ResultCard } from "./ResultCard";
import { ErrorBoundary } from "../../components/ui/ErrorBoundary";
import { StepUpload } from "../upload/StepUpload";
import { StepReview } from "../review/StepReview";
import { RegradeMockup } from "../regrade/RegradeMockup";
import {
  buildTaskContext,
  deriveDisplayStep,
  nextStepOnPhaseChange,
  stepAfterGrade,
  taskFromPdfName,
} from "./workspace.logic";
import type {
  BackendSubject,
  EssayFile,
  FinalizedResult,
  Grade,
  RubricScores,
  TabMeta,
  TaskFile,
} from "../../types";

interface EssayWorkspaceProps {
  active: boolean;
  onMeta: (meta: TabMeta) => void;
}

export function EssayWorkspace({
  active,
  onMeta,
}: EssayWorkspaceProps) {
  const lang = "vi" as const;
  const t = i18n[lang];
  const pipeline = useAgentPipeline();
  const feedbackHook = useFeedback();

  const [taskPdf, setTaskPdf] = useState<TaskFile | null>(null);
  const [essayImage, setEssayImage] = useState<EssayFile | null>(null);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [step, setStep] = useState<number>(1);
  // High-water-mark of the step the teacher reached this session. The
  // StepIndicator uses this so steps the user walked past keep their
  // green-check state even when they navigate back (e.g. step 5 →
  // "Sửa lại" → step 4). Without it, 4 and 5 collapse back to grey,
  // which read like "you haven't done these" — a bug the teacher
  // flagged 2026-05-18.
  const [maxStepReached, setMaxStepReached] = useState<number>(1);
  const [finalizedResult, setFinalizedResult] = useState<FinalizedResult | null>(null);
  const [isFinalizing, setIsFinalizing] = useState<boolean>(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  // Teacher per-câu score overrides — lifted up here so step 5 ResultCard
  // can read the numbers the teacher set in step 4 (without it, step 4's
  // local state would die on unmount and step 5 would show only AI's
  // numbers). Reset together with grade when a fresh pipeline finishes
  // — see the parseGrade effect below.
  const [finalScores, setFinalScores] = useState<Record<number, number>>({});
  const [maxOverrides, setMaxOverrides] = useState<Record<number, number>>({});

  // Per-tab subject state. Replaces the old App-level `selectedSubject`
  // (which was the same value across all tabs — a latent bug when the
  // teacher graded a math paper in tab 1 then a bio paper in tab 2).
  // `subject` is the value sent to the backend as the authoritative hint;
  // `detected` + `confidence` reflect the most recent /api/detect-subject
  // verdict so SubjectChip can render "Phát hiện: …" hints. `manualSubject`
  // tracks whether the teacher overrode the auto-pick — used by the chip
  // to show "Đã xác nhận" instead of "Tự phát hiện".
  const [subject, setSubject] = useState<BackendSubject | null>(null);
  const [detectedSubject, setDetectedSubject] = useState<BackendSubject | null>(null);
  const [subjectConfidence, setSubjectConfidence] = useState<DetectConfidence | null>(null);
  const [subjectDetecting, setSubjectDetecting] = useState(false);
  const [subjectDetectError, setSubjectDetectError] = useState<string | null>(null);
  const [manualSubject, setManualSubject] = useState(false);

  const handleSubjectChange = useCallback((code: BackendSubject) => {
    setSubject(code);
    setManualSubject(true);
  }, []);

  // Re-run detection every time the task PDF changes (new upload OR file
  // swap). Uses a ref to invalidate stale responses if the teacher uploads
  // a second PDF before the first call resolves — only the most recent
  // request gets to mutate state, preventing race-condition flicker.
  const detectionSeqRef = useRef(0);
  useEffect(() => {
    if (!taskPdf?.dataUrl) {
      // PDF cleared → reset everything subject-related so the chip goes
      // back to its "Tải đề bài để phát hiện môn" idle state.
      detectionSeqRef.current += 1;
      setSubject(null);
      setDetectedSubject(null);
      setSubjectConfidence(null);
      setSubjectDetecting(false);
      setSubjectDetectError(null);
      setManualSubject(false);
      return;
    }
    const seq = ++detectionSeqRef.current;
    const ctrl = new AbortController();
    setSubjectDetecting(true);
    setSubjectDetectError(null);
    setManualSubject(false);
    detectSubject({ task_pdf_b64: taskPdf.dataUrl }, { signal: ctrl.signal })
      .then((res) => {
        if (seq !== detectionSeqRef.current) return; // stale response
        setDetectedSubject(res.detected);
        setSubjectConfidence(res.confidence);
        // Auto-apply only when the backend is confident. Low / none
        // require an explicit click on the chip — the chip enters its
        // amber "Xác nhận hoặc đổi" state until the teacher picks.
        if (res.confidence === "high") {
          setSubject(res.detected);
        } else {
          setSubject(null);
        }
      })
      .catch((err) => {
        if (seq !== detectionSeqRef.current) return;
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof ApiError ? err.detail : (err as Error).message;
        setSubjectDetectError(msg || "Không phát hiện được môn từ file đề.");
        setSubjectConfidence("none");
      })
      .finally(() => {
        if (seq !== detectionSeqRef.current) return;
        setSubjectDetecting(false);
      });
    return () => {
      ctrl.abort();
    };
  }, [taskPdf?.dataUrl]);

  const subjectLabel = useMemo(() => subjectLabelOf(subject), [subject]);

  const taskLabel = useMemo(() => taskFromPdfName(taskPdf?.name), [taskPdf]);
  const task = useMemo(
    () => buildTaskContext(taskPdf?.name, subjectLabel === "—" ? "" : subjectLabel),
    [taskPdf, subjectLabel],
  );

  // Parse grade when pipeline returns
  useEffect(() => {
    const g = parseGrade(pipeline.code);
    if (g) {
      setGrade(g);
      setFinalizedResult(null);
      setIsFinalizing(false);
      setFinalizeError(null);
      // Discard the previous run's teacher edits — a fresh AI grade
      // invalidates them. Without this reset, a teacher who edited câu
      // scores then regraded would see their old overrides applied
      // against new AI scores, producing nonsense deltas in step 5.
      setFinalScores({});
      setMaxOverrides({});
      // Reset the step high-water-mark — a regrade restarts the review
      // arc, so the indicator shouldn't claim step 5 is still "done"
      // from the previous round.
      setMaxStepReached((prev) => Math.max(prev, 3));
      setStep((s) => stepAfterGrade(s));
    }
  }, [pipeline.code]);

  // Track the highest step the teacher reaches. Plain ratchet — only
  // moves upward, never resets except on a fresh grade (above).
  useEffect(() => {
    setMaxStepReached((prev) => (step > prev ? step : prev));
  }, [step]);

  // Handle pipeline phase changes
  useEffect(() => {
    setStep((s) => nextStepOnPhaseChange(s, pipeline.phase, pipeline.error));
  }, [pipeline.phase, pipeline.error]);

  // Listen for "load cached grade" requests from the header dropdown. Only
  // the active tab reacts so clicking a history entry routes to the tab
  // the teacher is currently looking at (mirrors Chrome's "open in current
  // tab" behavior). Event detail carries the grade id from the cache AND
  // an optional target step (3 = Xem xét, 4 = Chấm lại, 5 = Xong) — the
  // dropdown surfaces three jump buttons per entry. Defaults to 3 when
  // the field is omitted so older event payloads stay compatible.
  //
  // We always force the step explicitly after a load. The normal grade
  // flow goes step 1 → 2 (loading) → 3 (review), and ``stepAfterGrade``
  // (workspace.logic) only advances from 2 or 4. Cached loads dispatch
  // PIPELINE_SUCCESS directly without ever entering step 2, so without
  // this manual setStep the workspace would silently update the underlying
  // grade state but leave the user stuck on the Upload screen.
  // ``feedbackHook.reset()`` clears any pending teacher comments from the
  // previous session — they belong to a different grade.
  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; step?: 3 | 4 | 5 }>).detail;
      const id = detail?.id;
      if (typeof id !== "string" || !id) return;
      const ok = pipeline.loadCachedById(id);
      if (ok) {
        feedbackHook.reset();
        setIsFinalizing(false);
        setFinalizeError(null);
        setFinalizedResult(null);
        setStep(detail?.step ?? 3);
      }
    };
    window.addEventListener("hitl.loadGrade", handler);
    return () => window.removeEventListener("hitl.loadGrade", handler);
  }, [active, pipeline, feedbackHook]);

  // Report tab metadata
  const label = useMemo(() => taskLabel.slice(0, 30), [taskLabel]);

  useEffect(() => {
    onMeta({ label, phase: pipeline.phase, step, hasGrade: step === 5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, pipeline.phase, step]);

  // Subject must be confirmed (either auto-detected at "high" confidence
  // or explicitly picked by the teacher) before grading is allowed. Without
  // it, the backend hint would be null and we'd silently fall back to
  // DEFAULT_SUBJECT — exactly the failure mode auto-detection is meant to
  // prevent. The chip's amber state nudges the teacher to click.
  const canRun =
    !!taskPdf && !!essayImage && !!subject && pipeline.phase !== "generating";

  const handleRun = useCallback(() => {
    feedbackHook.reset();
    setIsFinalizing(false);
    setFinalizeError(null);
    pipeline.generate(
      task,
      lang,
      null,
      null,
      essayImage?.dataUrl || null,
      taskPdf?.dataUrl || null,
      subject,
    );
  }, [task, lang, essayImage, taskPdf, pipeline, feedbackHook, subject]);

  const handleApprove = useCallback(() => setStep(5), []);

  // Click on a completed step in the indicator → jump back. Only user
  // checkpoints (1: Upload, 3: Review) are exposed as navigable — steps
  // 2 (AI reading) and 4 (AI re-grading) are transient loaders, not
  // checkpoints; clicking them would put the UI back into a "loading"
  // state with no real work happening.
  const handleStepClick = useCallback((n: number) => {
    setStep(n);
  }, []);
  // Step 4 (Chấm lại) is normally a transient pipeline loader, but during
  // the UI mockup phase we expose it as a navigable checkpoint so the
  // teacher can review the regrade design without triggering a real call.
  const isStepNavigable = useCallback(
    (n: number) => n === 1 || n === 3 || n === 4,
    [],
  );

  // Persist the finalized grade and capture AI↔teacher score delta as a
  // HITL lesson. The UI only locks after the backend confirms persistence.
  const persistFinalizedGrade = useCallback(
    async (payload: { scores: RubricScores; overall: number | string }) => {
      const toNum = (v: unknown): number | null => {
        const n = parseFloat(v as string);
        return Number.isFinite(n) ? n : null;
      };
      const teacherScores: Record<string, number> = {};
      const aiScores: Record<string, number> = {};
      for (const key of ["content", "argument", "expression", "creativity"] as const) {
        const te = toNum(payload?.scores?.[key]);
        const ai = toNum(grade?.scores?.[key]);
        if (te !== null) teacherScores[key] = te;
        if (ai !== null) aiScores[key] = ai;
      }
      // Per-câu maps mirror what step-4 actually edits. Teacher overrides
      // live in ``finalScores`` (câu_num → score); câus the teacher didn't
      // touch fall back to AI's score so the delta reads as 0 and gets
      // dropped by the 0.25 threshold server-side (no phantom lesson).
      const pqf = grade?.per_question_feedback ?? [];
      const aiPerQuestion: Record<string, number> = {};
      const teacherPerQuestion: Record<string, number> = {};
      let sumAiPq = 0;
      let hasRealPqf = false;
      for (let i = 0; i < pqf.length; i++) {
        const q = pqf[i];
        const aiScore =
          typeof q.score === "number" && Number.isFinite(q.score) ? q.score : null;
        if (aiScore === null) continue;
        hasRealPqf = true;
        const parsed = parseCauHeader(q.question ?? "", i + 1);
        const key = String(parsed.num);
        const teacherScore = finalScores[parsed.num] ?? aiScore;
        aiPerQuestion[key] = aiScore;
        teacherPerQuestion[key] = teacherScore;
        sumAiPq += aiScore;
      }
      // Apples-to-apples overall comparison: when per-câu data is present
      // use sumAI as ai_overall so the delta reads against the SAME
      // dimension the teacher edited. The old code compared sumTeacher
      // (per-câu) against grade.overall (rubric-derived), which produced
      // phantom deltas any time AI's rubric overall ≠ its per-câu sum.
      const teacherOverall = toNum(payload?.overall);
      const aiOverall = hasRealPqf ? sumAiPq : toNum(grade?.overall);
      const finalGrade = {
        ...(grade || {}),
        scores: { ...(grade?.scores || {}), ...teacherScores },
        overall: teacherOverall ?? grade?.overall ?? null,
      };
      try {
        return await finalizeGrade({
          task,
          lang,
          ai_overall: aiOverall,
          teacher_overall: teacherOverall,
          ai_scores: aiScores,
          teacher_scores: teacherScores,
          ai_per_question: aiPerQuestion,
          teacher_per_question: teacherPerQuestion,
          approved_grade_json: JSON.stringify(finalGrade),
          run_id: pipeline.runId,
          subject,
        });
      } catch (err) {
        console.warn("[HITL] finalize-grade persist failed:", err);
        if (err instanceof ApiError) {
          throw new Error(
            err.detail ||
              String(t.finalizeSaveError ?? "") ||
              "Could not save the finalized grade. Please try again.",
          );
        }
        throw err;
      }
    },
    [grade, task, lang, pipeline.runId, subject, finalScores, t],
  );

  const displayStep = deriveDisplayStep(step);

  const stepLabels = [
    String(t.stepUpload ?? ""),
    String(t.stepReading ?? ""),
    String(t.stepReview ?? ""),
    String(t.stepRegrade ?? ""),
    String(t.stepDone ?? ""),
  ];

  return (
    <div style={{ padding: "0 clamp(16px, 4vw, 32px) 96px", display: active ? "block" : "none" }}>
      <StepIndicator
        steps={stepLabels}
        currentStep={displayStep}
        maxStepReached={maxStepReached}
        onStepClick={handleStepClick}
        isStepNavigable={isStepNavigable}
      />

      {pipeline.error && (
        <div
          style={{
            maxWidth: 640,
            margin: "0 auto 20px",
            padding: "12px 16px",
            background: T.redSoft,
            border: `1px solid ${T.red}`,
            borderRadius: 8,
            fontSize: 16,
            color: T.red,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              verticalAlign: "middle",
              marginRight: 4,
            }}
          >
            <Icon.AlertTriangle size={14} color={T.red} />
          </span>{" "}
          {String(t.pipelineError ?? "Error")}: {pipeline.error}
        </div>
      )}

      {step === 1 && (
        <ErrorBoundary label="Upload step failed">
          <StepUpload
            taskPdf={taskPdf}
            setTaskPdf={setTaskPdf}
            essayImage={essayImage}
            setEssayImage={setEssayImage}
            onSubmit={handleRun}
            canSubmit={canRun}
            t={t}
            subject={subject}
            detectedSubject={detectedSubject}
            subjectConfidence={subjectConfidence}
            subjectDetecting={subjectDetecting}
            subjectDetectError={subjectDetectError}
            manualSubject={manualSubject}
            onSubjectChange={handleSubjectChange}
          />
        </ErrorBoundary>
      )}

      {step === 2 && (
        <LoadingSpinner
          title={String(t.step2Title ?? "")}
          description={String(t.step2Desc ?? "")}
        />
      )}

      {step === 3 && (
        <ErrorBoundary label="Review step failed">
          <StepReview
            grade={grade}
            pipeline={pipeline}
            feedbackHook={feedbackHook}
            onApprove={handleApprove}
            onGoToRegrade={() => setStep(4)}
            onPrev={() => setStep(1)}
            backendSubject={subject}
            task={task}
            t={t}
            essayImage={essayImage}
          />
        </ErrorBoundary>
      )}

      {step === 4 && (
        // Mockup phase: step 4 used to be a loading spinner during the
        // regrade pipeline run. While we're still iterating on the visual,
        // show the design mockup so the teacher can click into the step
        // from the stepper and review the layout. If a real regrade ever
        // lands here while ``phase === "generating"``, fall back to the
        // loading spinner so the UX matches the rest of the pipeline.
        pipeline.phase === "generating" ? (
          <LoadingSpinner
            title={String(t.step4Title ?? "")}
            description={String(t.step4Desc ?? "")}
          />
        ) : (
          <ErrorBoundary label="Regrade mockup failed">
            <RegradeMockup
              onPrev={() => setStep(3)}
              onFinish={() => setStep(5)}
              grade={grade}
              essayImage={essayImage}
              finalScores={finalScores}
              setFinalScores={setFinalScores}
              maxOverrides={maxOverrides}
              setMaxOverrides={setMaxOverrides}
              feedbackHook={feedbackHook}
              task={task}
              pipelineCode={pipeline.code}
              runId={pipeline.runId}
              subject={subject}
            />
          </ErrorBoundary>
        )
      )}

      {step === 5 && (
        <ErrorBoundary label="Result card failed">
          <ResultCard
            grade={grade}
            t={t}
            finalized={finalizedResult}
            isFinalizing={isFinalizing}
            finalizeError={finalizeError}
            subjectLabel={subjectLabel === "—" ? "" : subjectLabel}
            teacherFinalScores={finalScores}
            teacherMaxOverrides={maxOverrides}
            onFinalize={async (payload) => {
              if (isFinalizing) return;
              setIsFinalizing(true);
              setFinalizeError(null);
              try {
                await persistFinalizedGrade(payload);
                setFinalizedResult({
                  ...payload,
                  finalizedAt: new Date().toISOString(),
                });
              } catch (err) {
                const e = err as Error;
                setFinalizeError(
                  e?.message ||
                    String(t.finalizeSaveError ?? "") ||
                    "Không thể lưu điểm cuối cùng. Vui lòng thử lại.",
                );
              } finally {
                setIsFinalizing(false);
              }
            }}
            onEdit={() => {
              // "← Sửa lại" — release the finalized lock AND jump back
              // to step 4 (Chấm lại) where per-câu editing actually
              // happens. Without the setStep, the button would only
              // unlock the UI in place, which doesn't match its label.
              setFinalizedResult(null);
              setFinalizeError(null);
              setStep(4);
            }}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}
