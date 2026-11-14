/**
 * Turns a pasted, dropped or picked image into what the chat API accepts: JPEG, PNG or
 * WebP under the per-image byte cap, as base64. A file that already qualifies is sent
 * untouched, so a screenshot keeps its exact pixels; anything else is redrawn smaller.
 */
export interface PreparedImage { base64: string; url: string }

const PASS_THROUGH = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_EDGE = 2048;

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/** The scale that fits `width` × `height` inside `edge`, never enlarging. */
export function fitScale(width: number, height: number, edge: number): number {
  return Math.min(1, edge / Math.max(width, height, 1));
}

export async function prepareImage(file: Blob, maxBytes: number): Promise<PreparedImage> {
  let blob = file;
  if (!PASS_THROUGH.has(file.type) || file.size > maxBytes) {
    const bitmap = await createImageBitmap(file);
    try {
      // Each pass gives up some quality, then some size, until the result fits.
      const passes = [[MAX_EDGE, .85], [MAX_EDGE, .7], [1536, .7], [1024, .7], [768, .6]] as const;
      for (const [edge, quality] of passes) {
        const scale = fitScale(bitmap.width, bitmap.height, edge);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas unavailable");
        // JPEG has no alpha; without this a transparent PNG would come out black.
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (!encoded) throw new Error("encode failed");
        blob = encoded;
        if (blob.size <= maxBytes) break;
      }
    } finally { bitmap.close(); }
    if (blob.size > maxBytes) throw new Error("image too large");
  }
  const url = await dataUrl(blob);
  return { base64: url.slice(url.indexOf(",") + 1), url };
}
