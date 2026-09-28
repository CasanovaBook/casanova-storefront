/** Client-side image preparation for uploads: validates, downscales and re-encodes photos. */

export interface PreparedImage {
  blob: Blob;
  width: number | null;
  height: number | null;
  ext: string;
  type: string;
}

const MAX_INPUT = 12 * 1024 * 1024;
const MAX_SIDE = 1800;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "image/avif"];

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ALLOWED.includes(file.type)) throw new Error("סוג הקובץ אינו נתמך. אפשר להעלות JPG, PNG, WebP, GIF, AVIF או SVG.");
  if (file.size > MAX_INPUT) throw new Error("הקובץ גדול מדי (עד 12MB).");
  // vector / animated images are stored as-is
  if (file.type === "image/svg+xml" || file.type === "image/gif") {
    return { blob: file, width: null, height: null, ext: file.type === "image/gif" ? "gif" : "svg", type: file.type };
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("לא ניתן לעבד את התמונה בדפדפן הזה.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const keepPng = file.type === "image/png";
  const type = keepPng ? "image/png" : "image/webp";
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("העיבוד נכשל."))), type, 0.84));
  return { blob, width: w, height: h, ext: keepPng ? "png" : "webp", type };
}

export const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("קריאת הקובץ נכשלה."));
    r.readAsDataURL(blob);
  });
