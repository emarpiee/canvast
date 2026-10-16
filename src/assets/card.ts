/** The picture of a video this browser cannot decode: a card of the video's own shape saying what it is (ADR 0045). */
export async function makeCard(w: number, h: number, name: string, codec: string, why = ""): Promise<ImageBitmap> {
  const k = Math.min(1, 640 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(w * k));
  c.height = Math.max(2, Math.round(h * k));
  const x = c.getContext("2d")!;
  x.fillStyle = "oklch(0.254 0.028 269)";
  x.fillRect(0, 0, c.width, c.height);
  const u = Math.min(c.width, c.height);
  x.fillStyle = "oklch(1 0 0 / 0.14)";
  x.beginPath();
  x.arc(c.width / 2, c.height / 2 - u * 0.06, u * 0.2, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "oklch(0.943 0.013 267)";
  x.beginPath();
  x.moveTo(c.width / 2 - u * 0.06, c.height / 2 - u * 0.06 - u * 0.1);
  x.lineTo(c.width / 2 + u * 0.12, c.height / 2 - u * 0.06);
  x.lineTo(c.width / 2 - u * 0.06, c.height / 2 - u * 0.06 + u * 0.1);
  x.fill();
  x.textAlign = "center";
  // Text that fits the card: the name is cut with an ellipsis to the width, the details are wrapped, and everything scales with the card.
  const room = c.width * 0.88;
  const fit = (text: string, font: string): string => {
    x.font = font;
    let t = text;
    while (t.length > 1 && x.measureText(t).width > room) t = `${t.slice(0, -2)}…`;
    return t;
  };
  const nameFont = `600 ${Math.max(10, Math.min(u * 0.06, c.width * 0.07))}px system-ui, sans-serif`;
  const detailFont = `${Math.max(9, Math.min(u * 0.045, c.width * 0.055))}px system-ui, sans-serif`;
  x.fillStyle = "oklch(0.943 0.013 267)";
  x.font = nameFont;
  const nameSize = parseFloat(nameFont.split("px")[0]!.split(" ").pop()!);
  let y = c.height / 2 + u * 0.3;
  x.fillText(fit(name || "Video", nameFont), c.width / 2, y);
  x.fillStyle = "oklch(0.718 0.035 267)";
  const detailSize = parseFloat(detailFont);
  const head = `${codec || "Video"} · ${w}×${h}`;
  y += nameSize * 1.45;
  x.fillText(fit(head, detailFont), c.width / 2, y);
  // The reason, when there is one, wrapped on words (it is what tells why a picture could not be taken).
  x.font = detailFont;
  const lines: string[] = ["can't be previewed in this browser"];
  let cur = "";
  for (const word of why.split(/\s+/).filter(Boolean)) {
    if (cur && x.measureText(`${cur} ${word}`).width > room) {
      lines.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) lines.push(cur);
  for (const line of lines.slice(0, 5)) {
    y += detailSize * 1.45;
    x.fillText(fit(line, detailFont), c.width / 2, y);
  }
  return createImageBitmap(c);
}

/**
 * The picture of a file the browser cannot show (ADR 0078): a card with the extension on a chip, the name, what it is and its size.
 * `scale` makes it larger for the viewer; the stored size is always 400 × 300.
 */
export const FILE_CARD_W = 400;
export const FILE_CARD_H = 300;
export async function makeFileCard(name: string, chip: string, category: string, bytes: number, scale = 1, note = "No preview for this kind of file yet"): Promise<ImageBitmap> {
  const W = FILE_CARD_W;
  const H = FILE_CARD_H;
  const c = document.createElement("canvas");
  c.width = Math.round(W * scale);
  c.height = Math.round(H * scale);
  const x = c.getContext("2d")!;
  x.scale(scale, scale);
  x.fillStyle = "oklch(0.254 0.028 269)";
  x.fillRect(0, 0, W, H);
  x.strokeStyle = "oklch(1 0 0 / 0.1)";
  x.lineWidth = 2;
  x.strokeRect(1, 1, W - 2, H - 2);
  x.textAlign = "center";
  x.textBaseline = "middle";
  // The extension chip: the thing to read first.
  const text = chip.slice(0, 8);
  const chipFont = `700 ${text.length > 5 ? 38 : 52}px system-ui, sans-serif`;
  x.font = chipFont;
  const tw = x.measureText(text).width;
  const cw = Math.max(120, tw + 56);
  const ch = 84;
  const cx = (W - cw) / 2;
  const cy = 46;
  x.fillStyle = "oklch(0.72 0.1 178)";
  x.beginPath();
  x.roundRect(cx, cy, cw, ch, 20);
  x.fill();
  x.fillStyle = "oklch(0.2 0.03 269)";
  x.fillText(text, W / 2, cy + ch / 2 + 2);
  // Text that fits: the name is cut with an ellipsis.
  const fit = (t: string, font: string, room: number): string => {
    x.font = font;
    let r = t;
    while (r.length > 1 && x.measureText(r).width > room) r = `${r.slice(0, -2)}…`;
    return r;
  };
  const nameFont = "600 22px system-ui, sans-serif";
  x.fillStyle = "oklch(0.943 0.013 267)";
  x.font = nameFont;
  x.fillText(fit(name || "Untitled", nameFont, W * 0.88), W / 2, 168);
  const size = bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(2)} GB`;
  const metaFont = "16px system-ui, sans-serif";
  x.fillStyle = "oklch(0.718 0.035 267)";
  x.font = metaFont;
  x.fillText(fit(`${category} · ${size}`, metaFont, W * 0.88), W / 2, 202);
  const noteFont = "14px system-ui, sans-serif";
  x.fillStyle = "oklch(0.62 0.03 267)";
  x.font = noteFont;
  x.fillText(fit(note, noteFont, W * 0.88), W / 2, 258);
  return createImageBitmap(c);
}
