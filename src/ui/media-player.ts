import type { ViewState } from "../app/view-state";
import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { AssetLibrary } from "../assets/asset-library";
import type { ImageObject } from "../doc/model";
import { pivotOf } from "../doc/model";
import { formatTime, stepFrame, stepTime } from "../doc/media";
import { GifFrames } from "../assets/gif";
import { cameraIn } from "../scene/frame-index";
import { worldToScreen } from "../core/camera";
import { radiansFromAngle } from "../core/angle";
import type { SettingKey, SettingsStore } from "../settings/settings";
import { ICONS } from "./icons";

/**
 * The on-canvas player of a selected video, audio file or GIF (ADR 0041, 0042): a native video element (or, for a GIF, a canvas) laid exactly over the instance (it
 * ignores the pointer, so selecting, moving and resizing work as for any image) and a control bar. Playing never
 * writes to the document; pausing, stepping, releasing the scrubber and the repeat switch each write one undo step.
 * Only the one selected video is loaded; deselecting pauses it and keeps its position.
 */
export interface MediaPlayerActions {
  setMedia(id: string, patch: { t?: number; repeat?: boolean }, label: string): void;
  /** The picture shown now, as a PNG, to become a new image next to the instance. */
  extract(id: string, png: Blob): void;
}

/** Beyond this many CSS px a side, the overlay is not laid out (browsers cap element sizes); the media still plays. */
const MAX_OVERLAY_PX = 16000;

/** What differs between the kinds: the element laid over the picture and how time or frames move. Positions are saved units (seconds, or a GIF frame index). */
interface Engine {
  readonly el: HTMLElement;
  /** Whether the overlay is drawn over the picture (audio has none). */
  visual: boolean;
  load(o: ImageObject, blob: Blob, duration: number): Promise<void>;
  unload(): void;
  pos(): number;
  /** The last position: scrubber range and "play from the start" test. */
  len(): number;
  seek(p: number): void;
  playing(): boolean;
  play(): void;
  pause(): void;
  setLoop(on: boolean): void;
  step(dir: 1 | -1, amount: number, repeat: boolean): void;
  label(): string;
  /** The picture shown now as a PNG (null when there is none to take). */
  frame(): Promise<Blob | null>;
  /** Called when the position moved by itself (playing) and when playback ended. */
  onTick: () => void;
  onEnded: () => void;
}

function avEngine(v: HTMLVideoElement): Engine {
  let url = "";
  let duration = 0;
  const e: Engine = {
    el: v,
    visual: true,
    async load(o, blob, dur) {
      url = URL.createObjectURL(blob);
      v.muted = false;
      v.src = url;
      await new Promise<void>((res) => v.addEventListener("loadedmetadata", () => res(), { once: true }));
      duration = Number.isFinite(v.duration) ? v.duration : dur;
      v.currentTime = Math.min(o.media!.t, duration);
      v.loop = o.media!.repeat;
    },
    unload() {
      v.pause();
      v.removeAttribute("src");
      v.load();
      if (url) URL.revokeObjectURL(url);
      url = "";
    },
    pos: () => v.currentTime,
    len: () => duration,
    seek: (p) => void (v.currentTime = p),
    playing: () => !v.paused && !v.ended,
    play() {
      if (v.currentTime >= duration - 0.05) v.currentTime = 0;
      void v.play().catch(() => undefined);
    },
    pause: () => v.pause(),
    setLoop: (on) => void (v.loop = on),
    step: (dir, amount, repeat) => void (v.currentTime = stepTime(v.currentTime, dir * amount, duration, repeat)),
    label: () => `${formatTime(v.currentTime)} / ${formatTime(duration)}`,
    async frame() {
      if (!v.videoWidth || v.readyState < 2) return null;
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      return new Promise((res) => c.toBlob(res, "image/png"));
    },
    onTick: () => undefined,
    onEnded: () => undefined,
  };
  v.addEventListener("timeupdate", () => e.onTick());
  v.addEventListener("play", () => e.onTick());
  v.addEventListener("pause", () => e.onTick());
  v.addEventListener("ended", () => e.onEnded());
  return e;
}

/** A GIF plays frame by frame from the decoder (assets/gif.ts), each held for its own delay. */
function gifEngine(c: HTMLCanvasElement): Engine {
  const ctx = c.getContext("2d")!;
  let g: GifFrames | null = null;
  let idx = 0;
  let loop = false;
  let timer = 0;
  let on = false;
  const show = (i: number): void => {
    idx = i;
    ctx.putImageData(new ImageData(g!.frame(i), g!.width, g!.height), 0, 0);
  };
  const stop = (): void => {
    on = false;
    clearTimeout(timer);
  };
  const schedule = (): void => {
    timer = window.setTimeout(() => {
      let next = idx + 1;
      if (next >= g!.count) {
        if (!loop) {
          stop();
          e.onTick();
          e.onEnded();
          return;
        }
        next = 0;
      }
      show(next);
      e.onTick();
      schedule();
    }, g!.frames[idx]!.delay * 1000);
  };
  const e: Engine = {
    el: c,
    visual: true,
    async load(o, blob) {
      g = new GifFrames(new Uint8Array(await blob.arrayBuffer()));
      c.width = g.width;
      c.height = g.height;
      loop = o.media!.repeat;
      show(Math.min(o.media!.t, g.count - 1));
    },
    unload() {
      stop();
      g = null;
    },
    pos: () => idx,
    len: () => (g ? g.count - 1 : 0),
    seek: (p) => g && show(Math.max(0, Math.min(g.count - 1, Math.round(p)))),
    playing: () => on,
    play() {
      if (!g || on) return;
      if (idx >= g.count - 1) show(0);
      on = true;
      e.onTick();
      schedule();
    },
    pause() {
      stop();
      e.onTick();
    },
    setLoop: (v) => void (loop = v),
    step: (dir, amount, repeat) => g && show(stepFrame(idx, dir * amount, g.count, repeat)),
    label: () => `Frame ${idx + 1} / ${g?.count ?? 0}`,
    frame: () => new Promise((res) => c.toBlob(res, "image/png")),
    onTick: () => undefined,
    onEnded: () => undefined,
  };
  return e;
}

export function mountMediaPlayer(host: HTMLElement, view: ViewState, doc: DocumentStore, editor: EditorState, assets: AssetLibrary, settings: SettingsStore, actions: MediaPlayerActions): void {
  const v = document.createElement("video");
  v.className = "media-video";
  v.hidden = true;
  v.playsInline = true;
  v.preload = "auto";
  const gc = document.createElement("canvas");
  gc.className = "media-video";
  gc.hidden = true;
  const av = avEngine(v); // one element plays both video and audio
  const engines = { video: av, audio: av, gif: gifEngine(gc) };
  const bar = document.createElement("div");
  bar.className = "toolbar media-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Media player");
  bar.dataset["testid"] = "media-bar";
  bar.hidden = true;
  const btn = (cmd: string, icon: string, label: string): string => `<button type="button" data-cmd="${cmd}" aria-label="${label}" title="${label}">${icon}</button>`;
  bar.innerHTML = `${btn("back", ICONS.rewind, "Step back")}${btn("play", ICONS.play, "Play")}${btn("fwd", ICONS.fastForward, "Step forward")}
    <input type="range" class="media-scrub" min="0" max="1" step="any" value="0" aria-label="Position">
    <output class="media-time">0:00 / 0:00</output>
    ${btn("extract", ICONS.imagePlus, "Extract frame")}${btn("repeat", ICONS.repeat, "Repeat")}${btn("mute", ICONS.volume, "Mute")}${btn("settings", ICONS.settings, "Media & Playback settings")}
    <div class="media-settings" role="group" aria-label="Media &amp; Playback" hidden>
      <label>Video step (s) <input type="number" min="0.1" max="600" step="any" data-step="media.step.video"></label>
      <label>Audio step (s) <input type="number" min="0.1" max="600" step="any" data-step="media.step.audio"></label>
      <label>GIF step (frames) <input type="number" min="1" max="1000" step="1" data-step="media.step.gif"></label>
    </div>`;
  host.append(v, gc, bar);
  const $ = <T extends HTMLElement>(sel: string): T => bar.querySelector<T>(sel)!;
  const scrub = $<HTMLInputElement>(".media-scrub");
  const time = $<HTMLOutputElement>(".media-time");
  const playBtn = $<HTMLButtonElement>('[data-cmd="play"]');
  const repeatBtn = $<HTMLButtonElement>('[data-cmd="repeat"]');
  const muteBtn = $<HTMLButtonElement>('[data-cmd="mute"]');
  const extractBtn = $<HTMLButtonElement>('[data-cmd="extract"]');

  let cur: ImageObject | null = null;
  let eng: Engine | null = null;
  let loading = 0;

  const refresh = (): void => {
    if (!eng) return;
    const len = eng.len();
    if (document.activeElement !== scrub) scrub.value = String(len ? eng.pos() / len : 0);
    time.textContent = eng.label();
    const playing = eng.playing();
    playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    playBtn.title = playing ? "Pause" : "Play";
    repeatBtn.setAttribute("aria-pressed", String(!!cur?.media?.repeat));
    muteBtn.hidden = cur?.media?.kind === "gif";
    extractBtn.hidden = cur?.media?.kind === "audio";
    muteBtn.setAttribute("aria-pressed", String(v.muted));
    muteBtn.innerHTML = v.muted ? ICONS.volumeOff : ICONS.volume;
  };
  for (const e of new Set(Object.values(engines))) {
    e.onTick = refresh;
    e.onEnded = () => {
      if (cur && !cur.media!.repeat) actions.setMedia(cur.id, { t: eng!.len() }, "Pause media");
      refresh();
    };
  }

  const position = (): void => {
    if (!cur || !eng) return;
    const o = cur;
    const cam = cameraIn(view.frameCamera, o.frame ?? doc.space.world) ?? view.camera;
    const s = worldToScreen(cam, view.viewport, o.anchor);
    const ppu = 2 ** (o.unit + cam.zi + cam.zf);
    const w = o.w * ppu;
    const h = o.h * ppu;
    const vp = view.viewport;
    const visible = eng.visual && w <= MAX_OVERLAY_PX && h <= MAX_OVERLAY_PX && s.x < vp.width && s.y < vp.height && s.x + w > 0 && s.y + h > 0;
    const el = eng.el;
    el.style.display = visible ? "" : "none";
    if (visible) {
      el.style.left = `${s.x}px`;
      el.style.top = `${s.y}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      if (o.rot) {
        const pv = pivotOf(o);
        el.style.transformOrigin = `${pv.x * ppu}px ${pv.y * ppu}px`;
        el.style.transform = `rotate(${radiansFromAngle(o.rot)}rad)`;
      } else el.style.transform = "";
    }
    // The bar sits under the picture's centre, kept inside the view.
    const cx = Math.min(Math.max(s.x + Math.min(w, 4000) / 2, 180), vp.width - 180);
    bar.style.left = `${cx}px`;
    bar.style.top = `${Math.min(Math.max(s.y + Math.min(h, 4000) + 8, 60), vp.height - 56)}px`;
  };

  const release = (): void => {
    if (!cur || !eng) return;
    const o = cur;
    const e = eng;
    if (e.playing()) e.pause();
    if (!loading) actions.setMedia(o.id, { t: e.pos() }, "Pause media");
    cur = null;
    eng = null;
    v.hidden = gc.hidden = bar.hidden = true;
    e.unload();
  };

  const open = async (o: ImageObject): Promise<void> => {
    cur = o;
    eng = engines[o.media!.kind];
    eng.visual = o.media!.kind !== "audio"; // audio has no picture to lay over the waveform
    const mine = ++loading;
    v.hidden = gc.hidden = bar.hidden = false;
    const rec = await assets.record(o.assetId);
    if (mine !== loading || cur?.id !== o.id) return;
    if (!rec) {
      loading = 0;
      return;
    }
    try {
      await eng.load(o, rec.blob, rec.duration ?? 0);
    } catch {
      if (mine === loading) loading = 0;
      return;
    }
    if (mine !== loading) return;
    loading = 0;
    refresh();
    position();
  };

  const sync = (): void => {
    const id = editor.selection.size === 1 ? [...editor.selection][0]! : null;
    const o = id ? doc.get(id) : undefined;
    const want = o && o.kind === "image" && o.media && !o.hidden ? o : null;
    if (cur && cur.id !== want?.id) release();
    if (!want) return;
    if (!cur) {
      void open(want);
      return;
    }
    const prev = cur;
    cur = want;
    eng!.setLoop(want.media!.repeat);
    // An undo or redo changed the paused position: follow it (never while playing).
    if (!eng!.playing() && !loading && Math.abs(eng!.pos() - want.media!.t) > 0.01 && want.media!.t !== prev.media!.t) eng!.seek(want.media!.t);
    position();
    refresh();
  };

  scrub.addEventListener("input", () => {
    eng?.seek(Number(scrub.value) * eng.len());
    refresh();
  });
  scrub.addEventListener("change", () => {
    if (cur && eng && !eng.playing()) actions.setMedia(cur.id, { t: eng.pos() }, "Seek media");
  });
  // Steps are device settings: a bad value is refused and the field shows the current one again.
  bar.addEventListener("change", (e) => {
    const i = e.target as HTMLInputElement;
    const key = i.dataset["step"] as SettingKey | undefined;
    if (!key) return;
    if (!settings.set(key, Number(i.value) as never)) i.value = String(settings.get(key));
  });
  bar.addEventListener("click", (e) => {
    const cmd = (e.target as HTMLElement).closest<HTMLElement>("[data-cmd]")?.dataset["cmd"];
    if (!cur || !eng || !cmd) return;
    if (cmd === "play") {
      if (!eng.playing()) eng.play();
      else {
        eng.pause();
        actions.setMedia(cur.id, { t: eng.pos() }, "Pause media");
      }
    } else if (cmd === "back" || cmd === "fwd") {
      const kind = cur.media!.kind;
      eng.step(cmd === "back" ? -1 : 1, settings.get(kind === "gif" ? "media.step.gif" : kind === "audio" ? "media.step.audio" : "media.step.video"), cur.media!.repeat);
      if (!eng.playing()) actions.setMedia(cur.id, { t: eng.pos() }, "Step media");
    } else if (cmd === "repeat") actions.setMedia(cur.id, { repeat: !cur.media!.repeat }, "Repeat media");
    else if (cmd === "mute") v.muted = !v.muted;
    else if (cmd === "settings") {
      const box = bar.querySelector<HTMLElement>(".media-settings")!;
      box.hidden = !box.hidden;
      for (const i of box.querySelectorAll<HTMLInputElement>("[data-step]")) i.value = String(settings.get(i.dataset["step"] as SettingKey));
    }
    else if (cmd === "extract") {
      const id = cur.id;
      void eng.frame().then((png) => png && actions.extract(id, png));
    }
    refresh();
  });
  view.subscribe(position);
  doc.subscribe(sync);
  editor.subscribe(sync);
}
