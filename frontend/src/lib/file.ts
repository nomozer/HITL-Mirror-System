/**
 * Pure file utilities — no React, no DOM globals beyond FileReader.
 */

const IMAGE_MAX_DIMENSION = 1200; // Optimal for reading handwriting while saving space
const IMAGE_MAX_BYTES = 1_500_000;

export function isPdfFile(file: File | null | undefined): boolean {
  if (!file) return false;
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

export function isDocxFile(file: File | null | undefined): boolean {
  if (!file) return false;
  return (
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  );
}

export function isImageFile(file: File | null | undefined): boolean {
  return !!file && typeof file.type === "string" && file.type.startsWith("image/");
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = src;
  });
}

export async function readOptimizedUploadDataUrl(
  file: File | null | undefined,
): Promise<string | null> {
  if (!file) return null;

  const original = await readFileAsDataUrl(file);
  if (!isImageFile(file)) {
    return original;
  }

  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof Image === "undefined"
  ) {
    return original;
  }

  const image = await loadImage(original);
  const longestEdge = Math.max(image.naturalWidth || 0, image.naturalHeight || 0);

  // Resize and Compression logic
  const scale =
    longestEdge > IMAGE_MAX_DIMENSION ? IMAGE_MAX_DIMENSION / longestEdge : 1;
  const width = Math.max(
    1,
    Math.round((image.naturalWidth || image.width || 1) * scale),
  );
  const height = Math.max(
    1,
    Math.round((image.naturalHeight || image.height || 1) * scale),
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return original;
  ctx.drawImage(image, 0, 0, width, height);

  // Iterative compression to hit < 1.5MB target
  // Note: Base64 is ~33% larger than binary, so 1.5MB binary is ~2M chars
  const charLimit = Math.floor(IMAGE_MAX_BYTES * 1.33);
  let optimized = original;

  for (const q of [0.85, 0.7, 0.5, 0.3]) {
    const current = canvas.toDataURL("image/jpeg", q);
    optimized = current;
    if (current.length < charLimit) break;
  }

  return optimized.length < original.length ? optimized : original;
}
