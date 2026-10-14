/** What a video file is: its picture at time `t` (clamped to its length) and its length. */
export async function decodeVideo(blob: Blob, t = 0): Promise<{ bitmap: ImageBitmap; duration: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    const once = (ev: string): Promise<void> =>
      new Promise((res, rej) => {
        v.addEventListener(ev, () => res(), { once: true });
        v.addEventListener("error", () => rej(new Error("the video could not be decoded")), { once: true });
      });
    const meta = once("loadeddata");
    v.src = url;
    await meta;
    // A recording can lack its length: seeking far past the end makes the browser find it.
    if (!Number.isFinite(v.duration)) {
      const s = once("seeked");
      v.currentTime = 1e7;
      await s;
    }
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    const at = Math.min(Math.max(0, t), duration);
    if (Math.abs(v.currentTime - at) > 1e-3) {
      const s = once("seeked");
      v.currentTime = at;
      await s;
    }
    return { bitmap: await createImageBitmap(v), duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Size of the picture an audio file is shown as. */
export const WAVE_W = 480;
export const WAVE_H = 120;

/** An audio file's picture (its waveform, one bar per column) and its length. */
export async function decodeAudio(blob: Blob): Promise<{ bitmap: ImageBitmap; duration: number }> {
  const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
  const data = buf.getChannelData(0);
  const c = document.createElement("canvas");
  c.width = WAVE_W;
  c.height = WAVE_H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#e8eef7";
  ctx.fillRect(0, 0, WAVE_W, WAVE_H);
  ctx.fillStyle = "#2f6fdb";
  const per = Math.max(1, Math.floor(data.length / WAVE_W));
  for (let x = 0; x < WAVE_W; x++) {
    let peak = 0;
    for (let i = x * per; i < Math.min(data.length, (x + 1) * per); i++) peak = Math.max(peak, Math.abs(data[i]!));
    const h = Math.max(2, peak * (WAVE_H - 8));
    ctx.fillRect(x, (WAVE_H - h) / 2, 1, h);
  }
  return { bitmap: await createImageBitmap(c), duration: buf.duration };
}
