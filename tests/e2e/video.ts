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
