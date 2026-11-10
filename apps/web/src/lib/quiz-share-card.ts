/**
 * Draws the finished-quiz score card as a JPEG: score, level, the hit/miss row and a QR code
 * back to the quiz. Rendered on a canvas in the browser so no image service is needed; the
 * QR encoder loads only when someone actually shares.
 */

export interface ShareCardData {
  title: string;
  date: string;
  score: number;
  total: number;
  level: string;
  results: boolean[];
  scanLabel: string;
  url: string;
}

const WIDTH = 1080;
const HEIGHT = 1440;
const MISS = "#e96a6a";

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

async function drawQr(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, size: number): Promise<void> {
  const { default: qrcode } = await import("qrcode-generator");
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 2;
  const cell = Math.floor(size / (count + quiet * 2));
  const drawn = cell * (count + quiet * 2);
  const offset = (size - drawn) / 2;

  ctx.fillStyle = "#ffffff";
  roundRect(ctx, x, y, size, size, 24);
  ctx.fill();
  ctx.fillStyle = "#08111d";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) ctx.fillRect(x + offset + (col + quiet) * cell, y + offset + (row + quiet) * cell, cell, cell);
    }
  }
}

export async function renderShareCard(data: ShareCardData): Promise<Blob> {
  const accent = cssVar("--accent", "#ef8a45");
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";
  await document.fonts?.ready;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;

  // Background: the site's night-blue panel with a soft accent glow.
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, "#132842");
  bg.addColorStop(1, "#040b16");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const glow = ctx.createRadialGradient(WIDTH * 0.85, 120, 0, WIDTH * 0.85, 120, 620);
  glow.addColorStop(0, "rgba(239,138,69,.22)");
  glow.addColorStop(1, "rgba(239,138,69,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textBaseline = "alphabetic";

  // Brand.
  ctx.textAlign = "left";
  ctx.font = `700 44px ${font}`;
  ctx.fillStyle = "#eff8ff";
  ctx.fillText("fripSi", 88, 140);
  let brandX = 88 + ctx.measureText("fripSi").width;
  ctx.fillStyle = accent;
  ctx.fillText(".de", brandX, 140);
  brandX += ctx.measureText(".de").width;
  ctx.fillStyle = "#eff8ff";
  ctx.fillText(" Fan Site", brandX, 140);

  // Title and date.
  ctx.textAlign = "center";
  ctx.fillStyle = accent;
  ctx.font = `700 34px ${font}`;
  ctx.fillText(data.date, WIDTH / 2, 300);
  ctx.fillStyle = "#eff8ff";
  ctx.font = `800 76px ${font}`;
  ctx.fillText(data.title, WIDTH / 2, 400, WIDTH - 88 * 2);

  // Score.
  ctx.font = `800 240px ${font}`;
  ctx.fillText(`${data.score} / ${data.total}`, WIDTH / 2, 680);
  ctx.fillStyle = accent;
  ctx.font = `700 50px ${font}`;
  ctx.fillText(data.level, WIDTH / 2, 780);

  // Hit/miss row.
  const mark = 72;
  const gap = 20;
  const rowWidth = data.results.length * mark + (data.results.length - 1) * gap;
  data.results.forEach((hit, index) => {
    ctx.fillStyle = hit ? accent : MISS;
    roundRect(ctx, (WIDTH - rowWidth) / 2 + index * (mark + gap), 840, mark, mark, 16);
    ctx.fill();
  });

  // Footer: divider, invitation and QR code.
  ctx.strokeStyle = "rgba(159,180,211,.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(88, 1010);
  ctx.lineTo(WIDTH - 88, 1010);
  ctx.stroke();

  const qrSize = 300;
  await drawQr(ctx, data.url, WIDTH - 88 - qrSize, 1060, qrSize);

  // Invitation and address, centered as a block against the QR code.
  ctx.textAlign = "left";
  ctx.font = `700 46px ${font}`;
  const textWidth = WIDTH - 88 * 2 - qrSize - 48;
  const lines = wrap(ctx, data.scanLabel, textWidth);
  const blockHeight = lines.length * 62 + 56;
  let lineY = 1060 + qrSize / 2 - blockHeight / 2 + 46;
  ctx.fillStyle = "#eff8ff";
  for (const line of lines) {
    ctx.fillText(line, 88, lineY);
    lineY += 62;
  }
  ctx.fillStyle = "rgba(220,232,246,.65)";
  ctx.font = `500 34px ${font}`;
  ctx.fillText(data.url.replace(/^https?:\/\//, ""), 88, lineY + 14, textWidth);

  return new Promise((resolve, reject) => {
    // JPEG: the gradient background makes a PNG well over a megabyte; at this quality the
    // text and QR code stay crisp at a small fraction of the size.
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas export failed"))), "image/jpeg", 0.9);
  });
}

/** Latin words stay whole, CJK breaks between characters; at most two lines. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const tokens = text.match(/[\p{Script=Latin}\d'’.!?-]+|\s+|./gu) ?? [];
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    if (ctx.measureText(line + token).width > width && line.trim()) {
      lines.push(line.trim());
      line = token.trimStart();
    } else {
      line += token;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.slice(0, 2);
}
