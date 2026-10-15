/** A picture that is one flat colour (or nothing at all): what some browsers hand back when they cannot draw a video's frame. */
export function isFlat(b: ImageBitmap): boolean {
  const c = document.createElement("canvas");
  c.width = c.height = 8;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(b, 0, 0, 8, 8);
  const d = x.getImageData(0, 0, 8, 8).data;
  for (let i = 4; i < d.length; i += 4) {
    if (Math.abs(d[i]! - d[0]!) > 3 || Math.abs(d[i + 1]! - d[1]!) > 3 || Math.abs(d[i + 2]! - d[2]!) > 3 || Math.abs(d[i + 3]! - d[3]!) > 3) return false;
  }
  return true;
}

/**
 * The picture came back flat at every time tried: this browser draws nothing for the video (seen in Firefox on Android).
 * It carries the flat picture, for a file that cannot be shown as a card instead.
 */
export class BlankPictureError extends Error {
  constructor(readonly result: { bitmap: ImageBitmap; duration: number }) {
    super("this browser draws no picture for the video");
  }
}

/** What a video file is: its picture at time `t` (clamped to its length) and its length. */
export async function decodeVideo(blob: Blob, t = 0): Promise<{ bitmap: ImageBitmap; duration: number }> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  try {
    v.muted = true;
    v.preload = "auto";
    // In the page (faint, tiny, ignoring the pointer): some browsers present no new picture after a seek for an element nobody can see.
    v.style.cssText = "position:fixed;left:0;top:0;width:16px;height:16px;opacity:0.01;pointer-events:none";
    document.body.append(v);
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
      const shown = presentedNear(v, at); // asked before the seek: a picture shown after it, of about that time
      v.currentTime = at;
      await s;
      await shown;
    } else await presented(v);
    let bitmap = await frameBitmap(v);
    if (isFlat(bitmap)) {
      // A real flat frame (a black start) or a browser that draws nothing: other times tell them apart.
      let alive = false;
      for (const f of [0.1, 0.3, 0.6]) {
        if (!(duration > 0)) break;
        const s = once("seeked");
        v.currentTime = duration * f;
        await s;
        await presented(v, 300);
        const other = await frameBitmap(v);
        alive = !isFlat(other);
        other.close();
        if (alive) break;
      }
      if (!alive && duration > 0) throw new BlankPictureError({ bitmap, duration });
    }
    return { bitmap, duration };
  } finally {
    URL.revokeObjectURL(url);
    v.remove();
  }
}

/**
 * The picture a video element shows now, as a bitmap, taken through a canvas: it is what Extract Frame saves, and in
 * Firefox `createImageBitmap(video)` has returned an older picture than drawing the element does.
 */
export async function frameBitmap(v: HTMLVideoElement): Promise<ImageBitmap> {
  if (!v.videoWidth || !v.videoHeight) throw new Error("no picture");
  const c = document.createElement("canvas");
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext("2d")!.drawImage(v, 0, 0);
  const first = await createImageBitmap(c);
  if (!isFlat(first)) return first;
  // Drawing the element left it flat (Firefox on Android does): the other ways to take its picture, the first that shows something.
  const VF = (globalThis as { VideoFrame?: new (src: CanvasImageSource) => CanvasImageSource & { close(): void } }).VideoFrame;
  const ways: Array<() => Promise<ImageBitmap>> = [
    () => createImageBitmap(v),
    async () => {
      if (!VF) throw new Error("no VideoFrame");
      const f = new VF(v);
      try {
        return await createImageBitmap(f as unknown as ImageBitmap);
      } finally {
        f.close();
      }
    },
  ];
  for (const way of ways) {
    const b = await way().catch(() => null);
    if (!b) continue;
    if (!isFlat(b)) {
      first.close();
      return b;
    }
    b.close();
  }
  return first;
}

type Vfc = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, md: { mediaTime: number }) => void) => number };

/**
 * Resolves with the time of a picture the element has presented that is within `tol` seconds of `target`, or null when
 * the browser cannot say or none came within `ms`. Ask before seeking: a picture shown before the call is not reported.
 * A picture of another time (a stale one, shown while the seek catches up) is passed over.
 */
export function presentedNear(v: HTMLVideoElement, target: number, tol = 0.5, ms = 700): Promise<number | null> {
  return new Promise((res) => {
    const rvfc = (v as Vfc).requestVideoFrameCallback;
    if (!rvfc) return void setTimeout(() => res(null), 150);
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      res(null);
    }, ms);
    const cb = (_now: number, md: { mediaTime: number }): void => {
      if (done) return;
      if (Math.abs(md.mediaTime - target) <= tol) {
        done = true;
        clearTimeout(timer);
        res(md.mediaTime);
      } else rvfc.call(v, cb);
    };
    rvfc.call(v, cb);
  });
}

/** Resolves once the element has shown a new picture (where the browser says so), at most `ms` later. */
export function presented(v: HTMLVideoElement, ms = 150): Promise<void> {
  return new Promise((res) => {
    const done = (): void => res();
    setTimeout(done, ms);
    (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void }).requestVideoFrameCallback?.(done);
  });
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
