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
