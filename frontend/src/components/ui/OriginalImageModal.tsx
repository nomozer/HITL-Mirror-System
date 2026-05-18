import { useEffect, useState } from "react";
import { T } from "../../theme/tokens";
import type { EssayFile, I18nStrings } from "../../types";

// ---------------------------------------------------------------------------
// OriginalImageModal — shared lightbox for the student's raw bài làm.
//
// Used by step 3 (Xem xét) and step 4 (Chấm lại) so teachers can spot-check
// the AI's transcription against the original. Owns its own dataUrl → blob
// URL conversion + revoke lifecycle — callers just pass the EssayFile
// straight from workspace state.
//
// Why convert to a blob URL: <object data="data:application/pdf;base64,…">
// renders inconsistently across Chrome/Firefox/Safari. A blob URL works
// uniformly. For images we'd be fine with the dataUrl directly, but the
// branch isn't worth the extra code.
// ---------------------------------------------------------------------------

export interface OriginalImageModalProps {
  /** Whether the modal is open. Lets the caller own the trigger state. */
  open: boolean;
  /** Student's bài làm. The modal handles the empty / null case as a
   *  no-op so callers can render unconditionally without guards. */
  essayImage: EssayFile | null;
  onClose: () => void;
  t: I18nStrings;
}

export function OriginalImageModal({
  open,
  essayImage,
  onClose,
  t,
}: OriginalImageModalProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const src = essayImage?.dataUrl;
    if (!src) {
      setBlobUrl(null);
      return undefined;
    }
    const match = /^data:([^;]+);base64,(.+)$/.exec(src);
    if (!match) {
      setBlobUrl(src);
      return undefined;
    }
    let url: string | null = null;
    try {
      const binary = atob(match[2]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      url = URL.createObjectURL(new Blob([bytes], { type: match[1] }));
      setBlobUrl(url);
    } catch {
      setBlobUrl(src);
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [essayImage?.dataUrl]);

  if (!open || !blobUrl) return null;
  const isPdf = !!essayImage?.isPdf;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.78)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        animation: "fadeUp 0.2s ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: isPdf ? "92vw" : "auto",
          height: isPdf ? "92vh" : "auto",
          maxWidth: "92vw",
          maxHeight: "92vh",
          background: T.paper,
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.55)",
            border: "none",
            color: "#fff",
            cursor: "pointer",
            fontSize: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1,
          }}
          title={String(t.close ?? "Đóng")}
        >
          ×
        </button>
        {isPdf ? (
          <object
            data={blobUrl}
            type="application/pdf"
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              background: "#fff",
            }}
          >
            <iframe
              src={blobUrl}
              title={String(t.originalImage ?? "Bài làm gốc của học sinh")}
              loading="eager"
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                border: "none",
                background: "#fff",
              }}
            />
          </object>
        ) : (
          <img
            src={blobUrl}
            alt={String(t.originalImage ?? "Bài làm gốc của học sinh")}
            decoding="async"
            loading="eager"
            style={{
              display: "block",
              maxWidth: "92vw",
              maxHeight: "92vh",
              objectFit: "contain",
            }}
          />
        )}
      </div>
    </div>
  );
}
