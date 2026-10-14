import type { ViewState } from "../app/view-state";
import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { AssetLibrary } from "../assets/asset-library";
import type { ImageObject } from "../doc/model";
import { pivotOf } from "../doc/model";
import { formatTime, stepFrame, stepTime } from "../doc/media";
import { GifFrames } from "../assets/gif";
import { presented } from "../assets/video";
import { rasterKey } from "../doc/model";
import { cameraIn } from "../scene/frame-index";
import { worldToScreen } from "../core/camera";
import { projectObject } from "../render/projection";
import { radiansFromAngle } from "../core/angle";
import type { SettingKey, SettingsStore } from "../settings/settings";
import { ICONS } from "./icons";

/**
 * The on-canvas players of videos, audio files and GIFs (ADR 0041, 0042, 0044): each loaded instance has its own native
 * video element (or, for a GIF, a canvas) laid exactly over it (it ignores the pointer, so selecting, moving and resizing
 * work as for any image). The one selected instance also has the control bar. Playing never writes to the document;
 * pausing, stepping, releasing the scrubber and the repeat switch each write one undo step. Deselecting a paused
 * instance unloads it; one that is playing keeps playing (at most MAX_PLAYING at once) until it ends, is paused, is
 * deleted or leaves the view.
 */
export interface MediaPlayerActions {
  setMedia(id: string, patch: { t?: number; repeat?: boolean }, label: string): void;
  /** The picture shown now, as a PNG, to become a new image next to the instance. */
  extract(id: string, png: Blob): void;
}

/** Beyond this many CSS px a side, the overlay is not laid out (browsers cap element sizes); the media still plays. */
const MAX_OVERLAY_PX = 16000;
/** Players playing at once; starting one more pauses the one that has been playing longest (bounded decoders). */
export const MAX_PLAYING = 4;

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
  /** Called when the picture of a paused position is on screen (after a seek or a pause). */
  onSettled: () => void;
  /** Called when the position moved by itself (playing) and when playback ended. */
  onTick: () => void;
  onEnded: () => void;
}

function avEngine(v: HTMLVideoElement): Engine {
  let url = "";
  let duration = 0;
  // Where the paused picture is. The element's own clock is not trusted when paused: Firefox can report a spurious end (and jump to the
  // end) after a seek near it, which would save the end as the position while the picture shown is earlier.
  let target = 0;
  let played = false;
  const e: Engine = {
    el: v,
    visual: true,
    async load(o, blob, dur) {
      url = URL.createObjectURL(blob);
      v.muted = false;
      v.src = url;
      await new Promise<void>((res) => v.addEventListener("loadedmetadata", () => res(), { once: true }));
      duration = Number.isFinite(v.duration) ? v.duration : dur;
      const at = Math.min(o.media!.t, duration);
      if (Math.abs(v.currentTime - at) > 1e-3) {
        const seeked = new Promise<void>((res) => v.addEventListener("seeked", () => res(), { once: true }));
        v.currentTime = at;
        await seeked;
      }
      target = at;
      v.loop = o.media!.repeat;
    },
    unload() {
      played = false;
      v.pause();
      v.removeAttribute("src");
      v.load();
      if (url) URL.revokeObjectURL(url);
      url = "";
    },
    pos: () => (e.playing() ? v.currentTime : target),
    len: () => duration,
    seek(p) {
      target = p;
      v.currentTime = p;
    },
    playing: () => played && !v.paused && !v.ended,
    play() {
      if (e.pos() >= duration - 0.05) e.seek(0);
      played = true;
      void v.play().catch(() => (played = false));
    },
    pause() {
      if (played) target = v.currentTime;
      played = false;
      v.pause();
    },
    setLoop: (on) => void (v.loop = on),
    step: (dir, amount, repeat) => e.seek(stepTime(e.pos(), dir * amount, duration, repeat)),
    label: () => `${formatTime(e.pos())} / ${formatTime(duration)}`,
    async frame() {
      if (!v.videoWidth || v.readyState < 2) return null;
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      return new Promise((res) => c.toBlob(res, "image/png"));
    },
    onSettled: () => undefined,
    onTick: () => undefined,
    onEnded: () => undefined,
  };
  v.addEventListener("seeked", () => {
    if (!played) e.onSettled();
  });
  v.addEventListener("timeupdate", () => e.onTick());
  v.addEventListener("play", () => e.onTick());
  v.addEventListener("pause", () => {
    if (played && !v.ended) {
      target = v.currentTime; // paused by the browser (a media key, say)
      played = false;
    }
    if (!played && !v.ended) e.onSettled();
    e.onTick();
  });
  v.addEventListener("ended", () => {
    if (!played) {
      v.currentTime = target; // an end nobody played to: back to where the picture is
      return;
    }
    played = false;
    target = duration;
    e.onEnded();
  });
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
    onSettled: () => undefined,
    onTick: () => undefined,
    onEnded: () => undefined,
  };
  return e;
}

/** One loaded instance: its engine, its element and the object it plays. */
interface Player {
  o: ImageObject;
  eng: Engine;
  loading: number;
}

export function mountMediaPlayer(host: HTMLElement, view: ViewState, doc: DocumentStore, editor: EditorState, assets: AssetLibrary, settings: SettingsStore, actions: MediaPlayerActions): void {
  const bar = document.createElement("div");
  bar.className = "toolbar media-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Media player");
  bar.dataset["testid"] = "media-bar";
  bar.hidden = true;
  const btn = (cmd: string, icon: string, label: string): string => `<button type="button" data-cmd="${cmd}" aria-label="${label}" title="${label}">${icon}</button>`;
  bar.innerHTML = `<div class="media-row"><input type="range" class="media-scrub" min="0" max="1" step="any" value="0" aria-label="Position"><output class="media-time">0:00 / 0:00</output></div>
    <div class="media-row">${btn("back", ICONS.rewind, "Step back")}${btn("play", ICONS.play, "Play")}${btn("fwd", ICONS.fastForward, "Step forward")}${btn("extract", ICONS.imagePlus, "Extract frame")}${btn("repeat", ICONS.repeat, "Repeat")}<span class="media-gap"></span>${btn("mute", ICONS.volume, "Mute")}<input type="range" class="media-volume" min="0" max="100" step="1" aria-label="Volume">${btn("settings", ICONS.settings, "Media & Playback settings")}</div>
    <div class="media-settings" role="group" aria-label="Media &amp; Playback" hidden>
      <label>Video step (s) <input type="number" min="0.1" max="600" step="any" data-step="media.step.video"></label>
      <label>Audio step (s) <input type="number" min="0.1" max="600" step="any" data-step="media.step.audio"></label>
      <label>GIF step (frames) <input type="number" min="1" max="1000" step="1" data-step="media.step.gif"></label>
    </div>`;
  host.append(bar);
  const $ = <T extends HTMLElement>(sel: string): T => bar.querySelector<T>(sel)!;
  const scrub = $<HTMLInputElement>(".media-scrub");
  const time = $<HTMLOutputElement>(".media-time");
  const playBtn = $<HTMLButtonElement>('[data-cmd="play"]');
  const repeatBtn = $<HTMLButtonElement>('[data-cmd="repeat"]');
  const muteBtn = $<HTMLButtonElement>('[data-cmd="mute"]');
  const volume = $<HTMLInputElement>(".media-volume");
  const extractBtn = $<HTMLButtonElement>('[data-cmd="extract"]');

  const players = new Map<string, Player>();
  /** The player the bar controls: that of the one selected media instance. */
  let sel: Player | null = null;
  const videoOf = (p: Player): HTMLVideoElement | null => (p.eng.el instanceof HTMLVideoElement ? p.eng.el : null);

  const refresh = (): void => {
    if (!sel) return;
    const { eng, o } = sel;
    const len = eng.len();
    if (document.activeElement !== scrub) scrub.value = String(len ? eng.pos() / len : 0);
    time.textContent = eng.label();
    const playing = eng.playing();
    playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    playBtn.title = playing ? "Pause" : "Play";
    repeatBtn.setAttribute("aria-pressed", String(!!o.media?.repeat));
    muteBtn.hidden = volume.hidden = o.media?.kind === "gif";
    extractBtn.hidden = o.media?.kind === "audio";
    const muted = videoOf(sel)?.muted ?? false;
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.innerHTML = muted ? ICONS.volumeOff : ICONS.volume;
    if (document.activeElement !== volume) volume.value = String(muted ? 0 : settings.get("media.volume"));
  };

  /** Stop and unload a player, writing its position unless it never finished loading or its object is gone. */
  const release = (p: Player): void => {
    if (p.eng.playing()) p.eng.pause();
    const t = p.eng.pos();
    const write = !p.loading && !!doc.get(p.o.id);
    // Out of the map first: writing the position notifies the document's listeners, which look at the players again.
    players.delete(p.o.id);
    if (sel === p) {
      sel = null;
      bar.hidden = true;
    }
    if (write) actions.setMedia(p.o.id, { t }, "Pause media");
    p.eng.unload();
    p.eng.el.remove();
  };

  const transforming = (id: string): boolean => editor.preview.kind !== "none" && "ids" in editor.preview && editor.preview.ids.includes(id);

  const position = (p: Player): void => {
    const o = p.o;
    const cam = cameraIn(view.frameCamera, o.frame ?? doc.space.world) ?? view.camera;
    const s = worldToScreen(cam, view.viewport, o.anchor);
    const ppu = 2 ** (o.unit + cam.zi + cam.zf);
    const w = o.w * ppu;
    const h = o.h * ppu;
    const vp = view.viewport;
    const bb = projectObject(o, cam, vp, { keepTiny: true })?.box ?? { minX: s.x, maxX: s.x + w, minY: s.y, maxY: s.y + h };
    const inView = bb.maxX > 0 && bb.maxY > 0 && bb.minX < vp.width && bb.minY < vp.height;
    // One that is not selected has nothing to show or control once it is out of view: it stops (its position is kept).
    if (!inView && p !== sel) return release(p);
    // While the instance is being moved, scaled or turned the canvas draws it at the previewed place: the overlay would lag behind.
    const visible = p.eng.visual && !p.loading && !transforming(o.id) && w <= MAX_OVERLAY_PX && h <= MAX_OVERLAY_PX && inView;
    const el = p.eng.el;
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
    if (p !== sel) return;
    bar.style.display = transforming(o.id) ? "none" : ""; // the bar would stay behind a moving instance
    // The bar stays outside the picture's bounds (rotated ones too): below it, else above its turn handle, else pinned to the bottom of the view.
    const barH = bar.offsetHeight || 96;
    const cx = Math.min(Math.max((bb.minX + bb.maxX) / 2, 210), vp.width - 210);
    const below = bb.maxY + 12;
    const above = bb.minY - 44 - barH;
    bar.style.left = `${cx}px`;
    bar.style.top = `${below + barH <= vp.height - 8 ? below : above >= 56 ? above : vp.height - barH - 8}px`;
  };
  const positionAll = (): void => {
    for (const p of [...players.values()]) position(p);
  };

  const create = (o: ImageObject): Player => {
    let eng: Engine;
    if (o.media!.kind === "gif") {
      const c = document.createElement("canvas");
      c.className = "media-video";
      eng = gifEngine(c);
    } else {
      const v = document.createElement("video");
      v.className = "media-video";
      v.playsInline = true;
      v.preload = "auto";
      v.volume = settings.get("media.volume") / 100;
      eng = avEngine(v);
      eng.visual = o.media!.kind !== "audio"; // audio has no picture to lay over the waveform
    }
    const p: Player = { o, eng, loading: 0 };
    eng.el.style.display = "none"; // shown once it holds the paused picture: never the first frame for a moment
    host.append(eng.el);
    eng.onTick = () => p === sel && refresh();
    // The canvas draws a paused video from a decode of the file; what the player really showed is better: keep that picture instead.
    eng.onSettled = () => {
      const v = videoOf(p);
      if (!v || p.o.media!.kind !== "video" || p.loading || p.eng.playing()) return;
      const at = p.eng.pos();
      void presented(v).then(async () => {
        if (!players.has(p.o.id) || p.eng.playing() || Math.abs(p.eng.pos() - at) > 1e-3) return;
        const bmp = await createImageBitmap(v).catch(() => null);
        if (bmp) assets.setPoster(rasterKey({ ...p.o, media: { ...p.o.media!, t: at } }), bmp);
      });
    };
    eng.onEnded = () => {
      if (!p.o.media!.repeat) actions.setMedia(p.o.id, { t: p.eng.len() }, "Pause media");
      if (p !== sel) release(p);
      else refresh();
    };
    players.set(o.id, p);
    return p;
  };

  const open = async (p: Player): Promise<void> => {
    const mine = ++p.loading;
    const rec = await assets.record(p.o.assetId);
    if (mine !== p.loading || players.get(p.o.id) !== p) return;
    try {
      if (!rec) throw new Error("original missing");
      await p.eng.load(p.o, rec.blob, rec.duration ?? 0);
    } catch {
      if (mine === p.loading) release(p);
      return;
    }
    if (mine !== p.loading) return;
    p.loading = 0;
    refresh();
    positionAll();
  };

  const sync = (): void => {
    const id = editor.selection.size === 1 ? [...editor.selection][0]! : null;
    const o = id ? doc.get(id) : undefined;
    const want = o && o.kind === "image" && o.media && !o.hidden ? o : null;
    // Players follow their objects; one whose object is gone or hidden stops without writing.
    for (const p of [...players.values()]) {
      const cur = doc.get(p.o.id);
      if (!cur || cur.kind !== "image" || !cur.media || cur.hidden) {
        p.eng.unload();
        p.eng.el.remove();
        players.delete(p.o.id);
        if (sel === p) sel = null;
        continue;
      }
      const prev = p.o;
      p.o = cur;
      p.eng.setLoop(cur.media.repeat);
      // An undo or redo changed the paused position: follow it (never while playing).
      if (!p.eng.playing() && !p.loading && Math.abs(p.eng.pos() - cur.media.t) > 0.01 && cur.media.t !== prev.media!.t) p.eng.seek(cur.media.t);
    }
    // The previously selected player leaves the bar: one that is playing carries on, a paused one unloads.
    if (sel && sel.o.id !== want?.id) {
      const left = sel;
      sel = null;
      if (!left.eng.playing()) release(left);
    }
    if (want) {
      let p = players.get(want.id);
      if (!p) {
        p = create(want);
        void open(p);
      }
      sel = p;
    }
    bar.hidden = !sel;
    positionAll();
    refresh();
  };

  scrub.addEventListener("input", () => {
    if (!sel) return;
    sel.eng.seek(Number(scrub.value) * sel.eng.len());
    refresh();
  });
  scrub.addEventListener("change", () => {
    if (sel && !sel.eng.playing()) actions.setMedia(sel.o.id, { t: sel.eng.pos() }, "Seek media");
  });
  // Volume is a device setting (0 to 100) shared by all players; sliding it to 0 mutes, anything above unmutes.
  volume.addEventListener("input", () => {
    const n = Number(volume.value);
    settings.set("media.volume", n);
    for (const p of players.values()) {
      const v = videoOf(p);
      if (v) {
        v.muted = n === 0;
        v.volume = n / 100;
      }
    }
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
    if (!sel || !cmd) return;
    const { eng, o } = sel;
    if (cmd === "play") {
      if (!eng.playing()) {
        // A few at once: starting one more stops the one that has played longest.
        const others = [...players.values()].filter((q) => q !== sel && q.eng.playing());
        if (others.length >= MAX_PLAYING) release(others[0]!);
        eng.play();
      } else {
        eng.pause();
        actions.setMedia(o.id, { t: eng.pos() }, "Pause media");
      }
    } else if (cmd === "back" || cmd === "fwd") {
      const kind = o.media!.kind;
      eng.step(cmd === "back" ? -1 : 1, settings.get(kind === "gif" ? "media.step.gif" : kind === "audio" ? "media.step.audio" : "media.step.video"), o.media!.repeat);
      if (!eng.playing()) actions.setMedia(o.id, { t: eng.pos() }, "Step media");
    } else if (cmd === "repeat") actions.setMedia(o.id, { repeat: !o.media!.repeat }, "Repeat media");
    else if (cmd === "mute") {
      const v = videoOf(sel);
      if (v) v.muted = !v.muted;
    } else if (cmd === "settings") {
      const box = bar.querySelector<HTMLElement>(".media-settings")!;
      box.hidden = !box.hidden;
      for (const i of box.querySelectorAll<HTMLInputElement>("[data-step]")) i.value = String(settings.get(i.dataset["step"] as SettingKey));
    } else if (cmd === "extract") {
      const id = o.id;
      void eng.frame().then((png) => png && actions.extract(id, png));
    }
    refresh();
  });
  view.subscribe(positionAll);
  doc.subscribe(sync);
  editor.subscribe(sync);
}
