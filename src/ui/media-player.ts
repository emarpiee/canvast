import { scrubNumbers } from "../colour-picker/scrub";
import { playingFilter } from "../render/adjust-filter";
import type { ViewState } from "../app/view-state";
import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { AssetLibrary } from "../assets/asset-library";
import type { ImageObject } from "../doc/model";
import { pivotOf } from "../doc/model";
import { formatTime, stepFrame, stepTime } from "../doc/media";
import { GifFrames } from "../assets/gif";
import { pictureNow, presented, presentedNear } from "../assets/video";
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
  setMedia(id: string, patch: { t?: number; repeat?: boolean; range?: readonly [number, number] | null; speed?: number }, label: string): void;
  /** The picture shown now, as a PNG, to become a new image next to the instance. */
  extract(id: string, png: Blob, label: string): void;
  /** Draw the instance again (its picture was replaced). */
  repaint(id: string): void;
}

/** Beyond this many CSS px a side, the overlay is not laid out (browsers cap element sizes); the media still plays. */
const MAX_OVERLAY_PX = 16000;
/** Players playing at once; starting one more pauses the one that has been playing longest (bounded decoders). */
export const MAX_PLAYING = 4;

/** What differs between the kinds: the element laid over the picture and how time or frames move. Positions are saved units (seconds, or a GIF frame index). */
export interface Engine {
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
  /** How fast it plays (1: as made). */
  setSpeed(rate: number): void;
  /** How fast it plays (1: as made). */
  setSpeed(rate: number): void;
  step(dir: 1 | -1, amount: number, repeat: boolean): void;
  label(): string;
  /** The picture shown now as a PNG (null when there is none to take). */
  frame(): Promise<Blob | null>;
  /** The picture shown now, as a bitmap, taken whichever way works in this browser (null: none, or none to take). */
  snap(): Promise<ImageBitmap | null>;
  /** Settles when the last seek's picture has been presented (null: the browser cannot say). */
  shown: Promise<number | null>;
  /** Called when the picture of a paused position is on screen (after a seek or a pause). */
  onSettled: () => void;
  /** Called when the position moved by itself (playing) and when playback ended. */
  onTick: () => void;
  onEnded: () => void;
}

/** Where the player's top edge goes: 12 px under its picture, or as low as the view lets it when the picture's bottom is at the edge (the Actions bar works from this too). */
export const mediaBarTop = (pictureBottom: number, barHeight: number, viewHeight: number): number => Math.max(0, Math.min(pictureBottom + 12, viewHeight - barHeight - 8));

export function avEngine(v: HTMLVideoElement): Engine {
  let url = "";
  let file: Blob | null = null;
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
      file = blob;
      v.muted = false;
      v.src = url;
      await new Promise<void>((res, rej) => {
        v.addEventListener("loadedmetadata", () => res(), { once: true });
        v.addEventListener("error", () => rej(new Error("this browser cannot play the file")), { once: true });
      });
      // A file whose picture this browser cannot decode (say H.265) still loads its length and sound: it has no picture size.
      if (e.visual && !v.videoWidth) throw new Error("this browser cannot decode the picture");
      duration = Number.isFinite(v.duration) ? v.duration : dur;
      const at = Math.min(o.media!.t, duration);
      if (Math.abs(v.currentTime - at) > 1e-3) {
        const seeked = new Promise<void>((res) => v.addEventListener("seeked", () => res(), { once: true }));
        v.currentTime = at;
        await seeked;
      }
      await presented(v, 200); // the sought picture on screen before the layer shows
      target = at;
      v.loop = o.media!.repeat;
      v.playbackRate = o.media!.speed ?? 1;
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
      e.shown = presentedNear(v, p); // asked before the seek
      v.currentTime = p;
    },
    playing: () => played && !v.paused && !v.ended,
    play() {
      if (e.pos() >= duration - 0.05) e.seek(0);
      played = true;
      void v.play().catch(() => (played = false));
    },
    pause() {
      const was = played;
      played = false;
      v.pause();
      // While playing, `currentTime` is the sound's clock and the frame on screen is a frame after it (Firefox): a seek to it later
      // (a reselect, a reload) would show another frame than the one paused on. Seeking to it now puts the frame it shows on screen.
      if (was) e.seek(v.currentTime);
    },
    setLoop: (on) => void (v.loop = on),
    setSpeed: (rate) => void (v.playbackRate = rate),
    step: (dir, amount, repeat) => e.seek(stepTime(e.pos(), dir * amount, duration, repeat)),
    label: () => `${formatTime(e.pos())} / ${formatTime(duration)}`,
    async frame() {
      if (!file || !v.videoWidth || v.readyState < 2) return null;
      const bmp = await pictureNow(v, file, e.pos());
      if (!bmp) return null;
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      bmp.close();
      return new Promise((res) => c.toBlob(res, "image/png"));
    },
    async snap() {
      return file && v.videoWidth ? pictureNow(v, file, e.pos()) : null;
    },
    shown: Promise.resolve(null),
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
      played = false; // paused by the browser (a media key, say)
      e.seek(v.currentTime);
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
export function gifEngine(c: HTMLCanvasElement): Engine {
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
  let speed = 1;
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
    }, (g!.frames[idx]!.delay * 1000) / speed);
  };
  const e: Engine = {
    el: c,
    visual: true,
    async load(o, blob) {
      g = new GifFrames(new Uint8Array(await blob.arrayBuffer()));
      c.width = g.width;
      c.height = g.height;
      loop = o.media!.repeat;
      speed = o.media!.speed ?? 1;
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
    setSpeed: (rate) => void (speed = rate),
    step: (dir, amount, repeat) => g && show(stepFrame(idx, dir * amount, g.count, repeat)),
    label: () => `Frame ${idx + 1} / ${g?.count ?? 0}`,
    frame: () => new Promise((res) => c.toBlob(res, "image/png")),
    snap: async () => null,
    shown: Promise.resolve(null),
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
  /** This browser could not play the file (say its codec): the bar offers only the original file. */
  failed?: boolean;
  /** Playing was paused for a move, scale or turn of the instance and starts again when that ends. */
  resume?: boolean;
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
    <div class="media-row">${btn("back", ICONS.rewind, "Step back")}${btn("play", ICONS.play, "Play")}${btn("fwd", ICONS.fastForward, "Step forward")}${btn("extract", ICONS.imageDown, "Extract frame")}${btn("repeat", ICONS.repeat, "Repeat")}${btn("download", ICONS.download, "Save the original file (to open in your system player)")}<span class="media-gap"></span>${btn("mute", ICONS.volume, "Mute")}<input type="range" class="media-volume" min="0" max="100" step="1" aria-label="Volume">${btn("settings", ICONS.settings, "Media & Playback settings")}</div>
    <div class="media-settings" role="group" aria-label="Media &amp; Playback" hidden>
      <label>Video step (s) <input type="number" min="0.1" max="600" step="any" data-step="media.step.video"></label>
      <label>Audio step (s) <input type="number" min="0.1" max="600" step="any" data-step="media.step.audio"></label>
      <div class="media-range" data-range-row><span>Play only</span><output data-range-text></output>
        <button type="button" data-cmd="rin" title="Start playing from the position now">Start here</button><button type="button" data-cmd="rout" title="Stop playing at the position now">End here</button><button type="button" data-cmd="rclear" title="Play the whole file">Whole file</button></div>
      <label>Speed <select data-speed aria-label="Playing speed">${[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((v) => `<option value="${v}">${v}×</option>`).join("")}</select></label>
      <label>GIF step (frames) <input type="number" min="1" max="1000" step="1" data-step="media.step.gif"></label>
    </div>`;
  scrubNumbers(bar);
  host.append(bar);
  bar.querySelector<HTMLSelectElement>("[data-speed]")!.addEventListener("change", (e) => {
    if (sel) actions.setMedia(sel.o.id, { speed: Number((e.target as HTMLSelectElement).value) }, "Playing speed");
  });
  const $ = <T extends HTMLElement>(sel: string): T => bar.querySelector<T>(sel)!;
  const scrub = $<HTMLInputElement>(".media-scrub");
  const time = $<HTMLOutputElement>(".media-time");
  const playBtn = $<HTMLButtonElement>('[data-cmd="play"]');
  const repeatBtn = $<HTMLButtonElement>('[data-cmd="repeat"]');
  const muteBtn = $<HTMLButtonElement>('[data-cmd="mute"]');
  const volume = $<HTMLInputElement>(".media-volume");
  const extractBtn = $<HTMLButtonElement>('[data-cmd="extract"]');

  const players = new Map<string, Player>();
  /** The volume each item was last set to (a paused player unloads when it is left, and starts again from this, not from the setting). Kept while the app is open. */
  const ownVolume = new Map<string, number>();
  /** The player the bar controls: that of the one selected media instance. */
  let sel: Player | null = null;
  const videoOf = (p: Player): HTMLVideoElement | null => (p.eng.el instanceof HTMLVideoElement ? p.eng.el : null);

  const refresh = (): void => {
    if (!sel) return;
    const { eng, o } = sel;
    const failed = !!sel.failed;
    for (const b of bar.querySelectorAll<HTMLButtonElement>("button:not([data-cmd=download])")) b.disabled = failed;
    scrub.disabled = failed;
    if (failed) {
      time.textContent = "Can't play in this browser";
      return;
    }
    const len = eng.len();
    if (document.activeElement !== scrub) scrub.value = String(len ? eng.pos() / len : 0);
    const range = o.media?.range;
    time.textContent = eng.label(); // (the range is told in the settings: a longer label would move the buttons under the pointer)
    bar.querySelector<HTMLElement>("[data-range-row]")!.hidden = o.media?.kind === "gif";
    bar.querySelector<HTMLElement>("[data-range-text]")!.textContent = range ? `${formatTime(range[0])} to ${formatTime(range[1])}` : "the whole file";
    const playing = eng.playing();
    playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    playBtn.title = playing ? "Pause" : "Play";
    repeatBtn.setAttribute("aria-pressed", String(!!o.media?.repeat));
    const speedSel = bar.querySelector<HTMLSelectElement>("[data-speed]")!;
    if (document.activeElement !== speedSel) speedSel.value = String(o.media?.speed ?? 1);
    muteBtn.hidden = volume.hidden = o.media?.kind === "gif";
    extractBtn.hidden = o.media?.kind === "audio";
    const muted = videoOf(sel)?.muted ?? false;
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.innerHTML = muted ? ICONS.volumeOff : ICONS.volume;
    if (document.activeElement !== volume) volume.value = String(muted ? 0 : Math.round((videoOf(sel)?.volume ?? 1) * 100)); // (each player has its own volume)
  };

  /** Stop and unload a player, writing its position unless it never finished loading or its object is gone. */
  const release = (p: Player): void => {
    if (p.eng.playing()) p.eng.pause();
    const t = p.eng.pos();
    const write = !p.loading && !p.failed && !!doc.get(p.o.id);
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
    // Audio that is playing carries on: there is no picture to lose and it costs no video decoder (ADR 0044).
    if (!inView && p !== sel && !(p.o.media?.kind === "audio" && p.eng.playing())) return release(p);
    // While the instance is being moved, scaled or turned the canvas draws it at the previewed place: the overlay would lag behind.
    // While it loads it stays in the page but transparent: Firefox presents no new picture after a seek for an element nobody can see,
    // so the paused frame it opens on would be a stale one.
    const visible = p.eng.visual && !p.failed && !transforming(o.id) && w <= MAX_OVERLAY_PX && h <= MAX_OVERLAY_PX && inView;
    const el = p.eng.el;
    el.style.display = visible ? "" : "none";
    el.style.opacity = p.loading ? "0" : "";
    el.style.filter = playingFilter(o.adjust); // (every adjustment, as a filter: the same one the canvas draws the paused picture with)
    if (visible) {
      // A cropped video or GIF: the element is the whole picture, as big as the window would make it, put so the window is where the
      // object is, and everything outside the window is clipped away.
      const c = o.crop;
      const kx = c ? w / c.w : 0, ky = c ? h / c.h : 0;
      const offX = c ? c.x * kx : 0, offY = c ? c.y * ky : 0;
      const fullW = c ? kx * o.pixelW : w, fullH = c ? ky * o.pixelH : h;
      el.style.left = `${s.x - offX}px`;
      el.style.top = `${s.y - offY}px`;
      el.style.width = `${fullW}px`;
      el.style.height = `${fullH}px`;
      el.style.clipPath = c ? `inset(${offY}px ${fullW - offX - w}px ${fullH - offY - h}px ${offX}px)` : "";
      if (o.rot) {
        const pv = pivotOf(o);
        el.style.transformOrigin = `${pv.x * ppu + offX}px ${pv.y * ppu + offY}px`;
        el.style.transform = `rotate(${radiansFromAngle(o.rot)}rad)`;
      } else el.style.transform = "";
    }
    if (p !== sel) return;
    bar.style.display = transforming(o.id) ? "none" : ""; // the bar would stay behind a moving instance
    // The player always sits right under its picture (rotated ones too: under the box that holds it), the one thing that never moves from there;
    // the Actions bar steps aside for it (ui/context-bar.ts). Only a picture at the very bottom of the view pulls it up, to stay on screen.
    const barH = bar.offsetHeight || 96;
    const cx = Math.min(Math.max((bb.minX + bb.maxX) / 2, 210), vp.width - 210);
    bar.style.left = `${cx}px`;
    bar.style.top = `${mediaBarTop(bb.maxY, barH, vp.height)}px`;
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
      v.volume = (ownVolume.get(o.id) ?? settings.get("media.volume")) / 100;
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
      void p.eng.shown.then(async (seen) => {
        if (!players.has(p.o.id) || p.eng.playing() || Math.abs(p.eng.pos() - at) > 1e-3) return;
        if (seen !== null && Math.abs(seen - at) > 0.5) console.warn(`canvast: the picture shown is from ${seen.toFixed(2)} s, wanted ${at.toFixed(2)} s`);
        const bmp = await p.eng.snap().catch(() => null); // null: nothing better than the picture the canvas already has
        if (bmp) {
          assets.setPoster(rasterKey({ ...p.o, media: { ...p.o.media!, t: at } }), bmp);
          actions.repaint(p.o.id); // a picture already drawn from the file's own decode is replaced by this one
        }
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
      if (mine === p.loading) {
        p.loading = 0;
        p.failed = true; // keeps the card; the bar offers the original file
        refresh();
        positionAll(); // hides the layer it showed (transparent) while loading
      }
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
      // Not while the instance is being moved, scaled or turned: it stops, then plays on from where it stopped.
      if (transforming(cur.id) && p.eng.playing()) {
        p.eng.pause();
        p.resume = true;
      } else if (p.resume && !transforming(cur.id)) {
        p.resume = false;
        p.eng.play();
      }
      p.eng.setLoop(cur.media.repeat);
      p.eng.setSpeed(cur.media.speed ?? 1);
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
  // Volume is the selected player's own (0 to 100; the device setting is only where a new player starts); sliding it to 0 mutes, anything above unmutes.
  volume.addEventListener("input", () => {
    const n = Number(volume.value);
    const v = sel ? videoOf(sel) : null;
    if (sel) ownVolume.set(sel.o.id, n);
    if (v) {
      v.muted = n === 0;
      v.volume = n / 100;
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
        const r = o.media!.range;
        if (r && (eng.pos() < r[0] || eng.pos() >= r[1] - 0.05)) eng.seek(r[0]); // (from the start of the range, as from the start of a file)
        eng.play();
      } else {
        eng.pause();
        actions.setMedia(o.id, { t: eng.pos() }, "Pause media");
      }
    } else if (cmd === "back" || cmd === "fwd") {
      const kind = o.media!.kind;
      eng.step(cmd === "back" ? -1 : 1, settings.get(kind === "gif" ? "media.step.gif" : kind === "audio" ? "media.step.audio" : "media.step.video"), o.media!.repeat);
      if (!eng.playing()) actions.setMedia(o.id, { t: eng.pos() }, "Step media");
    } else if (cmd === "rin" || cmd === "rout") {
      const at = eng.pos();
      const r = o.media!.range;
      const len = eng.len();
      const from = cmd === "rin" ? at : (r?.[0] ?? 0);
      const to = cmd === "rout" ? at : (r?.[1] ?? len);
      if (to > from + 0.05) actions.setMedia(o.id, { range: [from, to] }, "Set the playing range");
    } else if (cmd === "rclear") actions.setMedia(o.id, { range: null }, "Play the whole file");
    else if (cmd === "repeat") actions.setMedia(o.id, { repeat: !o.media!.repeat }, "Repeat media");
    else if (cmd === "download") {
      void assets.record(o.assetId).then((rec) => {
        if (!rec) return;
        // A page cannot start the system's player; saving the file lets the browser or the file manager open it there.
        const a = document.createElement("a");
        a.href = URL.createObjectURL(rec.blob);
        a.download = rec.name || "media";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      });
    } else if (cmd === "mute") {
      const v = videoOf(sel);
      if (v) v.muted = !v.muted;
    } else if (cmd === "settings") {
      const box = bar.querySelector<HTMLElement>(".media-settings")!;
      box.hidden = !box.hidden;
      for (const i of box.querySelectorAll<HTMLInputElement>("[data-step]")) i.value = String(settings.get(i.dataset["step"] as SettingKey));
    } else if (cmd === "extract") {
      const id = o.id;
      // The picture may not be presented yet (a seek just landed, the machine is busy): try a few times instead of doing nothing.
      void (async () => {
        for (let i = 0; i < 4; i++) {
          if (!players.get(id) || players.get(id)!.eng !== eng) return;
          const png = await eng.frame().catch(() => null);
          if (png) return actions.extract(id, png, eng.label());
          await new Promise((r) => setTimeout(r, 250));
        }
      })();
    }
    refresh();
  });
  // A playing instance with a range stops, or goes back to its start, when it reaches the end of the range (the element only reports
  // its time a few times a second, so this looks at it often).
  window.setInterval(() => {
    for (const p of players.values()) {
      const r = p.o.media?.range;
      if (!r || !p.eng.playing() || p.o.media!.kind === "gif") continue;
      const t = p.eng.pos();
      if (t < r[1] - 0.03 && t >= r[0] - 0.03) continue;
      if (p.o.media!.repeat || t < r[0]) p.eng.seek(r[0]);
      else {
        p.eng.pause();
        actions.setMedia(p.o.id, { t: r[1] }, "Pause media");
      }
      if (p === sel) refresh();
    }
  }, 50);
  view.subscribe(positionAll);
  doc.subscribe(sync);
  editor.subscribe(sync);
}
