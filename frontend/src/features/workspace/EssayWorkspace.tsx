import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentPipeline } from "../../hooks/useAgentPipeline";
import { useFeedback } from "../../hooks/useFeedback";
import { ApiError, finalizeGrade } from "../../api";
import { T } from "../../theme/tokens";
import { i18n } from "../../i18n";
import { Icon } from "../../components/ui/Icon";
import { parseGrade } from "../../lib/grade";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { StepIndicator } from "../../components/layout/StepIndicator";
import { ResultCard } from "./ResultCard";
import { ErrorBoundary } from "../../components/ui/ErrorBoundary";
import { StepUpload } from "../upload/StepUpload";
import { StepReview } from "../review/StepReview";
import {
  buildTaskContext,
  deriveDisplayStep,
  nextStepOnPhaseChange,
  stepAfterGrade,
  subjectCodeFromSelection,
  taskFromPdfName,
} from "./workspace.logic";
import type {
  EssayFile,
  FinalizedResult,
  Grade,
  Lang,
  RubricScores,
  TabMeta,
  TaskFile,
} from "../../types";

interface EssayWorkspaceProps {
  active: boolean;
  lang: Lang;
  selectedSubject: string;
  selectedClass: string;
  onMeta: (meta: TabMeta) => void;
}

export function EssayWorkspace({
  active,
  lang,
  selectedSubject,
  selectedClass,
  onMeta,
}: EssayWorkspaceProps) {
  const t = i18n[lang];
  const pipeline = useAgentPipeline();
  const feedbackHook = useFeedback();

  const [taskPdf, setTaskPdf] = useState<TaskFile | null>(null);
  const [essayImage, setEssayImage] = useState<EssayFile | null>(null);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [step, setStep] = useState<number>(1);
  const [finalizedResult, setFinalizedResult] = useState<FinalizedResult | null>(
    null,
  );
  const [isFinalizing, setIsFinalizing] = useState<boolean>(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  const taskLabel = useMemo(() => taskFromPdfName(taskPdf?.name), [taskPdf]);
  const task = useMemo(
    () => buildTaskContext(taskPdf?.name, selectedSubject, selectedClass),
    [taskPdf, selectedSubject, selectedClass],
  );
  const subject = useMemo(
    () => subjectCodeFromSelection(selectedSubject),
    [selectedSubject],
  );

  // Parse grade when pipeline returns
  useEffect(() => {
    const g = parseGrade(pipeline.code);
    if (g) {
      setGrade(g);
      setFinalizedResult(null);
      setIsFinalizing(false);
      setFinalizeError(null);
      setStep((s) => stepAfterGrade(s));
    }
  }, [pipeline.code]);

  // Handle pipeline phase changes
  useEffect(() => {
    setStep((s) => nextStepOnPhaseChange(s, pipeline.phase, pipeline.error));
  }, [pipeline.phase, pipeline.error]);

  // Report tab metadata
  const label = useMemo(() => taskLabel.slice(0, 30), [taskLabel]);

  useEffect(() => {
    onMeta({ label, phase: pipeline.phase, step, hasGrade: step === 5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, pipeline.phase, step]);

  const canRun = !!taskPdf && !!essayImage && pipeline.phase !== "generating";

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
      for (const key of [
        "content",
        "argument",
        "expression",
        "creativity",
      ] as const) {
        const te = toNum(payload?.scores?.[key]);
        const ai = toNum(grade?.scores?.[key]);
        if (te !== null) teacherScores[key] = te;
        if (ai !== null) aiScores[key] = ai;
      }
      const teacherOverall = toNum(payload?.overall);
      const aiOverall = toNum(grade?.overall);
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
    [grade, task, lang, pipeline.runId, subject, t],
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
    <div style={{ padding: "0 32px 40px", display: active ? "block" : "none" }}>
      <StepIndicator steps={stepLabels} currentStep={displayStep} />

      {pipeline.error && (
        <div
          style={{
            maxWidth: 640,
            margin: "0 auto 20px",
            padding: "12px 16px",
            background: T.redSoft,
            border: `1px solid ${T.red}`,
            borderRadius: 8,
            fontSize: 15,
            color: T.red,
            animation: "fadeUp 0.3s ease-out",
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
            lang={lang}
            t={t}
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
            task={task}
            t={t}
            essayImage={essayImage}
          />
        </ErrorBoundary>
      )}

      {step === 4 && (
        <LoadingSpinner
          title={String(t.step4Title ?? "")}
          description={String(t.step4Desc ?? "")}
        />
      )}

      {step === 5 && (
        <ErrorBoundary label="Result card failed">
          <ResultCard
            grade={grade}
            t={t}
            finalized={finalizedResult}
            isFinalizing={isFinalizing}
            finalizeError={finalizeError}
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
              setFinalizedResult(null);
              setFinalizeError(null);
            }}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}
