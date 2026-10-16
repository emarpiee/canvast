/**
 * The picture of a video this browser cannot decode (ADR 0045, ADR 0089): a grey card of the video's own shape with a play sign, its codec
 * and size, and the same general message as every file card. Not the name: renaming never makes it again.
 */
export async function makeCard(w: number, h: number, codec: string): Promise<ImageBitmap> {
  const k = Math.min(1, 640 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(w * k));
  c.height = Math.max(2, Math.round(h * k));
  const x = c.getContext("2d")!;
  x.fillStyle = "oklch(0.3 0 0)";
  x.fillRect(0, 0, c.width, c.height);
  const u = Math.min(c.width, c.height);
  x.fillStyle = "oklch(1 0 0 / 0.14)";
  x.beginPath();
  x.arc(c.width / 2, c.height / 2 - u * 0.06, u * 0.2, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "oklch(0.93 0 0)";
  x.beginPath();
  x.moveTo(c.width / 2 - u * 0.06, c.height / 2 - u * 0.06 - u * 0.1);
  x.lineTo(c.width / 2 + u * 0.12, c.height / 2 - u * 0.06);
  x.lineTo(c.width / 2 - u * 0.06, c.height / 2 - u * 0.06 + u * 0.1);
  x.fill();
  x.textAlign = "center";
  // Text that fits the card: cut with an ellipsis to the width, and everything scales with the card.
  const room = c.width * 0.88;
  const fit = (text: string, font: string): string => {
    x.font = font;
    let t = text;
    while (t.length > 1 && x.measureText(t).width > room) t = `${t.slice(0, -2)}…`;
    return t;
  };
  const detailFont = `${Math.max(9, Math.min(u * 0.05, c.width * 0.06))}px system-ui, sans-serif`;
  const detailSize = parseFloat(detailFont);
  let y = c.height / 2 + u * 0.3;
  x.fillStyle = "oklch(0.8 0 0)";
  x.fillText(fit(`${codec || "Video"} · ${w}×${h}`, detailFont), c.width / 2, y);
  y += detailSize * 1.5;
  x.fillStyle = "oklch(0.72 0 0)";
  x.fillText(fit("Can't be previewed in this browser", detailFont), c.width / 2, y);
  return createImageBitmap(c);
}

/**
 * The picture of a file the browser cannot show (ADR 0078, ADR 0089): a grey page with the extension on it and one general message, the
 * same for every kind of file. It holds nothing that can change (not the name, not the size), so renaming never makes it again, and its
 * greys are neutral so it looks right under any theme. The stored size is always 400 × 300.
 */
export const FILE_CARD_W = 400;
export const FILE_CARD_H = 300;
export const FILE_CARD_NOTE = "No preview for this kind of file";
export async function makeFileCard(chip: string): Promise<ImageBitmap> {
  const W = FILE_CARD_W;
  const H = FILE_CARD_H;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d")!;
  x.fillStyle = "oklch(0.3 0 0)";
  x.fillRect(0, 0, W, H);
  x.strokeStyle = "oklch(1 0 0 / 0.1)";
  x.lineWidth = 2;
  x.strokeRect(1, 1, W - 2, H - 2);
  // The file icon: a page with a folded corner.
  const pw = 112;
  const ph = 144;
  const px = (W - pw) / 2;
  const py = 34;
  const fold = 34;
  x.beginPath();
  x.moveTo(px + 12, py);
  x.lineTo(px + pw - fold, py);
  x.lineTo(px + pw, py + fold);
  x.lineTo(px + pw, py + ph - 12);
  x.arcTo(px + pw, py + ph, px + pw - 12, py + ph, 12);
  x.lineTo(px + 12, py + ph);
  x.arcTo(px, py + ph, px, py + ph - 12, 12);
  x.lineTo(px, py + 12);
  x.arcTo(px, py, px + 12, py, 12);
  x.closePath();
  x.fillStyle = "oklch(0.46 0 0)";
  x.fill();
  x.beginPath();
  x.moveTo(px + pw - fold, py);
  x.lineTo(px + pw - fold, py + fold);
  x.lineTo(px + pw, py + fold);
  x.closePath();
  x.fillStyle = "oklch(0.58 0 0)";
  x.fill();
  // The extension, on the page.
  const text = chip.slice(0, 8);
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.font = `700 ${text.length > 4 ? 22 : 30}px system-ui, sans-serif`;
  x.fillStyle = "oklch(0.93 0 0)";
  x.fillText(text, W / 2, py + ph * 0.66, pw - 16);
  x.font = "16px system-ui, sans-serif";
  x.fillStyle = "oklch(0.72 0 0)";
  x.fillText(FILE_CARD_NOTE, W / 2, 232);
  return createImageBitmap(c);
}
