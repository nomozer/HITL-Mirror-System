import { useCallback, useRef, useState } from "react";
import { T } from "../../theme/tokens";
import { Icon } from "../../components/ui/Icon";
import { readFileAsDataUrl, readOptimizedUploadDataUrl } from "../../lib/file";
import { validateTaskFile, validateEssayFile } from "./StepUpload.logic";
import type { EssayFile, I18nStrings, Lang, TaskFile } from "../../types";

interface StepUploadProps {
  taskPdf: TaskFile | null;
  setTaskPdf: (value: TaskFile | null) => void;
  essayImage: EssayFile | null;
  setEssayImage: (value: EssayFile | null) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  lang: Lang;
  t: I18nStrings;
}

export function StepUpload({
  taskPdf,
  setTaskPdf,
  essayImage,
  setEssayImage,
  onSubmit,
  canSubmit,
  lang,
  t,
}: StepUploadProps) {
  const taskInputRef = useRef<HTMLInputElement | null>(null);
  const essayInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOverTask, setDragOverTask] = useState(false);
  const [dragOverEssay, setDragOverEssay] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleTaskFile = useCallback(
    async (file: File | null | undefined) => {
      const check = validateTaskFile(file, lang);
      if (!check.ok) {
        setUploadError(check.error);
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file as File);
        setUploadError(null);
        setTaskPdf({ dataUrl, name: (file as File).name });
      } catch {
        setUploadError(String(t.uploadReadError ?? ""));
      }
    },
    [lang, setTaskPdf, t.uploadReadError],
  );

  const handleEssayFile = useCallback(
    async (file: File | null | undefined) => {
      const check = validateEssayFile(file, t);
      if (!check.ok) {
        setUploadError(check.error);
        return;
      }
      try {
        const dataUrl = await readOptimizedUploadDataUrl(file as File);
        if (!dataUrl) {
          setUploadError(String(t.uploadReadError ?? ""));
          return;
        }
        setUploadError(null);
        setEssayImage({
          dataUrl,
          name: (file as File).name,
          isPdf: !!check.isPdf,
        });
      } catch {
        setUploadError(String(t.uploadReadError ?? ""));
      }
    },
    [setEssayImage, t],
  );

  return (
    <div
      style={{
        maxWidth: 640,
        margin: "0 auto",
        animation: "fadeUp 0.4s ease-out",
      }}
    >
      {/* ── Task PDF Upload ── */}
      <div style={{ marginBottom: 24 }}>
        <label
          style={{
            display: "block",
            fontSize: 15,
            fontWeight: 600,
            color: T.textSoft,
            marginBottom: 8,
            letterSpacing: "0.02em",
          }}
        >
          {String(t.promptLabel ?? "")}
        </label>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverTask(true);
          }}
          onDragLeave={() => setDragOverTask(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverTask(false);
            handleTaskFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => {
            if (taskInputRef.current) {
              taskInputRef.current.value = "";
              taskInputRef.current.click();
            }
          }}
          style={{
            border: `2px dashed ${dragOverTask ? T.accent : T.border}`,
            borderRadius: 12,
            padding: taskPdf ? 16 : 40,
            textAlign: "center",
            cursor: "pointer",
            transition: "all 0.2s",
            background: dragOverTask ? T.accentSoft : T.bgCard,
          }}
        >
          <input
            ref={taskInputRef}
            type="file"
            accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            style={{ display: "none" }}
            onChange={(e) => {
              handleTaskFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {taskPdf ? (
            <div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 10,
                  padding: "16px 0",
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 80,
                    borderRadius: 10,
                    background: `linear-gradient(135deg, ${T.accent}, ${T.accentLight})`,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    boxShadow: `0 6px 20px ${T.accentGlow}`,
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      width: 20,
                      height: 20,
                      background: "rgba(255,255,255,0.2)",
                      clipPath: "polygon(0 0, 100% 100%, 0 100%)",
                    }}
                  />
                  <Icon.FileText size={28} color="white" />
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      marginTop: 6,
                      letterSpacing: "0.1em",
                    }}
                  >
                    {taskPdf.name?.toLowerCase().endsWith(".docx")
                      ? "DOCX"
                      : "PDF"}
                  </div>
                </div>
                <div
                  style={{ fontSize: 15, color: T.textSoft, fontWeight: 500 }}
                >
                  {String(t.promptUploaded ?? "")}
                </div>
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 14,
                  color: T.textMute,
                  textAlign: "center",
                }}
              >
                {taskPdf.name} ·{" "}
                <span style={{ color: T.accent, cursor: "pointer" }}>
                  {String(t.promptChange ?? "")}
                </span>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 10, opacity: 0.4 }}>
                <Icon.FileText size={36} color={T.textMute} />
              </div>
              <div
                style={{ fontSize: 17, color: T.textSoft, fontWeight: 500 }}
              >
                {String(t.promptDrop ?? "")}
              </div>
              <div
                style={{ fontSize: 13, color: T.textFaint, marginTop: 6 }}
              >
                PDF, DOCX
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Essay Image/PDF Upload ── */}
      <div style={{ marginBottom: 32 }}>
        <label
          style={{
            display: "block",
            fontSize: 15,
            fontWeight: 600,
            color: T.textSoft,
            marginBottom: 8,
            letterSpacing: "0.02em",
          }}
        >
          {String(t.imageLabel ?? "")}
        </label>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverEssay(true);
          }}
          onDragLeave={() => setDragOverEssay(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverEssay(false);
            handleEssayFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => {
            if (essayInputRef.current) {
              essayInputRef.current.value = "";
              essayInputRef.current.click();
            }
          }}
          style={{
            border: `2px dashed ${dragOverEssay ? T.accent : T.border}`,
            borderRadius: 12,
            padding: essayImage ? 16 : 48,
            textAlign: "center",
            cursor: "pointer",
            transition: "all 0.2s",
            background: dragOverEssay ? T.accentSoft : T.bgCard,
          }}
        >
          <input
            ref={essayInputRef}
            type="file"
            accept="image/*,.pdf,application/pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              handleEssayFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {essayImage ? (
            <div>
              {essayImage.isPdf ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 12,
                    padding: "24px 0",
                  }}
                >
                  <div
                    style={{
                      width: 80,
                      height: 100,
                      borderRadius: 12,
                      background: `linear-gradient(135deg, ${T.red}, #9B3530)`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      boxShadow: `0 8px 24px rgba(184, 66, 58, 0.25)`,
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        right: 0,
                        width: 24,
                        height: 24,
                        background: "rgba(255,255,255,0.2)",
                        clipPath: "polygon(0 0, 100% 100%, 0 100%)",
                      }}
                    />
                    <Icon.FileText size={32} color="white" />
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        marginTop: 8,
                        letterSpacing: "0.1em",
                      }}
                    >
                      PDF
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 15,
                      color: T.textSoft,
                      fontWeight: 500,
                    }}
                  >
                    {String(t.pdfUploaded ?? "")}
                  </div>
                </div>
              ) : (
                <img
                  src={essayImage.dataUrl}
                  alt={essayImage.name}
                  style={{
                    maxWidth: "100%",
                    maxHeight: 260,
                    borderRadius: 8,
                    display: "block",
                    margin: "0 auto",
                    boxShadow: `0 4px 24px rgba(0,0,0,0.3)`,
                  }}
                />
              )}
              <div
                style={{
                  marginTop: 10,
                  fontSize: 14,
                  color: T.textMute,
                  textAlign: "center",
                }}
              >
                {essayImage.name} ·{" "}
                <span style={{ color: T.accent, cursor: "pointer" }}>
                  {String(t.imageChange ?? "")}
                </span>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 12, opacity: 0.45 }}>
                <Icon.Upload size={44} color={T.textMute} />
              </div>
              <div
                style={{ fontSize: 17, color: T.textSoft, fontWeight: 500 }}
              >
                {String(t.imageDrop ?? "")}
              </div>
              <div
                style={{ fontSize: 13, color: T.textFaint, marginTop: 6 }}
              >
                JPG, PNG, PDF
              </div>
            </div>
          )}
        </div>
        {uploadError && (
          <div
            style={{ marginTop: 8, fontSize: 14, color: T.red, lineHeight: 1.5 }}
          >
            {uploadError}
          </div>
        )}
      </div>

      {/* Submit */}
      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        style={{
          width: "100%",
          padding: "14px 24px",
          fontSize: 17,
          color: canSubmit ? T.bgCard : T.textMute,
          background: canSubmit ? T.accent : T.bgCard,
          border: canSubmit ? "none" : `1px solid ${T.border}`,
          transition: "all 0.2s",
        }}
      >
        {String(t.startGrading ?? "")}
      </button>
    </div>
  );
}
