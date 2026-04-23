import { isPdfFile, isImageFile, isDocxFile } from "../../lib/file";
import type { I18nStrings, Lang } from "../../types";

export type ValidationResult =
  | { ok: true; isPdf?: boolean }
  | { ok: false; error: string | null };

/**
 * Validate a prompt file (PDF or DOCX).
 */
export function validateTaskFile(
  file: File | null | undefined,
  lang: Lang,
): ValidationResult {
  if (!file) return { ok: false, error: null };
  if (!isPdfFile(file) && !isDocxFile(file)) {
    return {
      ok: false,
      error:
        lang === "vi"
          ? "Đề bài hỗ trợ định dạng PDF hoặc DOCX."
          : "Only PDF or DOCX files are accepted for the exam prompt.",
    };
  }
  return { ok: true };
}

/**
 * Validate a student essay file (PDF or image).
 */
export function validateEssayFile(
  file: File | null | undefined,
  t: I18nStrings,
): ValidationResult {
  if (!file) return { ok: false, error: null };
  const isPdf = isPdfFile(file);
  const isImage = isImageFile(file);
  if (!isPdf && !isImage) {
    return { ok: false, error: String(t.uploadInvalidType ?? "Invalid file") };
  }
  return { ok: true, isPdf };
}
