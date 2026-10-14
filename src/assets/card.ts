/** The picture of a video this browser cannot decode: a card of the video's own shape saying what it is (ADR 0045). */
export async function makeCard(w: number, h: number, name: string, codec: string): Promise<ImageBitmap> {
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
  x.font = `600 ${Math.max(9, u * 0.06)}px system-ui, sans-serif`;
  const label = name.length > 34 ? `${name.slice(0, 33)}…` : name;
  x.fillText(label, c.width / 2, c.height / 2 + u * 0.3);
  x.fillStyle = "#9aa4bb";
  x.font = `${Math.max(8, u * 0.05)}px system-ui, sans-serif`;
  x.fillText(`${codec || "Video"} · ${w}×${h} · can't be previewed in this browser`, c.width / 2, c.height / 2 + u * 0.39);
  return createImageBitmap(c);
}
