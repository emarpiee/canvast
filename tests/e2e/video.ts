import type { Page } from "@playwright/test";

/** A short WebM made in the page (a canvas recorded for `seconds`): no binary fixture is stored. */
export async function makeWebm(p: Page, seconds = 2): Promise<Buffer> {
  const bytes = await p.evaluate(async (secs) => {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 90;
    const ctx = c.getContext("2d")!;
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start();
    const t0 = performance.now();
    while (performance.now() - t0 < secs * 1000) {
      ctx.fillStyle = `hsl(${((performance.now() - t0) / 5) % 360} 80% 50%)`;
      ctx.fillRect(0, 0, 160, 90);
      await new Promise((r) => setTimeout(r, 40));
    }
    rec.stop();
    await stopped;
    return Array.from(new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer()));
  }, seconds);
  return Buffer.from(bytes);
}

/** A mono 16-bit WAV of a sine (8 kHz), built in code. */
export function makeWav(seconds = 2): Buffer {
  const rate = 8000;
  const n = rate * seconds;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 20000), 44 + i * 2);
  return b;
}
