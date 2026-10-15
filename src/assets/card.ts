/** The picture of a video this browser cannot decode: a card of the video's own shape saying what it is (ADR 0045). */
export async function makeCard(w: number, h: number, name: string, codec: string, why = ""): Promise<ImageBitmap> {
  const k = Math.min(1, 640 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(w * k));
  c.height = Math.max(2, Math.round(h * k));
  const x = c.getContext("2d")!;
  x.fillStyle = "#1d2230";
  x.fillRect(0, 0, c.width, c.height);
  const u = Math.min(c.width, c.height);
  x.fillStyle = "rgba(255,255,255,0.14)";
  x.beginPath();
  x.arc(c.width / 2, c.height / 2 - u * 0.06, u * 0.2, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "#e8ecf5";
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
  x.fillStyle = "#e8ecf5";
  x.font = nameFont;
  const nameSize = parseFloat(nameFont.split("px")[0]!.split(" ").pop()!);
  let y = c.height / 2 + u * 0.3;
  x.fillText(fit(name || "Video", nameFont), c.width / 2, y);
  x.fillStyle = "#9aa4bb";
  const detailSize = parseFloat(detailFont);
  for (const line of [`${codec || "Video"} · ${w}×${h}`, "can't be previewed in this browser", ...(why ? [why] : [])]) {
    y += (line === `${codec || "Video"} · ${w}×${h}` ? nameSize : detailSize) * 1.45;
    x.fillText(fit(line, detailFont), c.width / 2, y);
  }
  return createImageBitmap(c);
}
