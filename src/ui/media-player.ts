import type { ViewState } from "../app/view-state";
import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { AssetLibrary } from "../assets/asset-library";
import type { ImageObject } from "../doc/model";
import { pivotOf } from "../doc/model";
import { formatTime, stepTime } from "../doc/media";
import { cameraIn } from "../scene/frame-index";
import { worldToScreen } from "../core/camera";
import { radiansFromAngle } from "../core/angle";
import type { SettingsStore } from "../settings/settings";
import { ICONS } from "./icons";

/**
 * The on-canvas player of a selected video (ADR 0041): a native video element laid exactly over the instance (it
 * ignores the pointer, so selecting, moving and resizing work as for any image) and a control bar. Playing never
 * writes to the document; pausing, stepping, releasing the scrubber and the repeat switch each write one undo step.
 * Only the one selected video is loaded; deselecting pauses it and keeps its position.
 */
export interface MediaPlayerActions {
  setMedia(id: string, patch: { t?: number; repeat?: boolean }, label: string): void;
}

/** Beyond this many CSS px a side, the overlay is not laid out (browsers cap element sizes); the video still plays. */
const MAX_OVERLAY_PX = 16000;

export function mountMediaPlayer(host: HTMLElement, view: ViewState, doc: DocumentStore, editor: EditorState, assets: AssetLibrary, settings: SettingsStore, actions: MediaPlayerActions): void {
  const v = document.createElement("video");
  v.className = "media-video";
  v.hidden = true;
  v.playsInline = true;
  v.preload = "auto";
  const bar = document.createElement("div");
  bar.className = "toolbar media-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Video player");
  bar.dataset["testid"] = "media-bar";
  bar.hidden = true;
  const btn = (cmd: string, icon: string, label: string): string => `<button type="button" data-cmd="${cmd}" aria-label="${label}" title="${label}">${icon}</button>`;
  bar.innerHTML = `${btn("back", ICONS.rewind, "Step back")}${btn("play", ICONS.play, "Play")}${btn("fwd", ICONS.fastForward, "Step forward")}
    <input type="range" class="media-scrub" min="0" max="1" step="any" value="0" aria-label="Position">
    <output class="media-time">0:00 / 0:00</output>
    ${btn("repeat", ICONS.repeat, "Repeat")}${btn("mute", ICONS.volume, "Mute")}`;
  host.append(v, bar);
  const $ = <T extends HTMLElement>(sel: string): T => bar.querySelector<T>(sel)!;
  const scrub = $<HTMLInputElement>(".media-scrub");
  const time = $<HTMLOutputElement>(".media-time");
  const playBtn = $<HTMLButtonElement>('[data-cmd="play"]');
  const repeatBtn = $<HTMLButtonElement>('[data-cmd="repeat"]');
  const muteBtn = $<HTMLButtonElement>('[data-cmd="mute"]');

  let cur: ImageObject | null = null;
  let url = "";
  let duration = 0;
  let loading = 0;

  const refresh = (): void => {
    const t = v.currentTime;
    if (document.activeElement !== scrub) scrub.value = String(duration ? t / duration : 0);
    time.textContent = `${formatTime(t)} / ${formatTime(duration)}`;
    const playing = !v.paused && !v.ended;
    playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    playBtn.title = playing ? "Pause" : "Play";
    repeatBtn.setAttribute("aria-pressed", String(!!cur?.media?.repeat));
    muteBtn.setAttribute("aria-pressed", String(v.muted));
    muteBtn.innerHTML = v.muted ? ICONS.volumeOff : ICONS.volume;
  };

  const position = (): void => {
    if (!cur) return;
    const o = cur;
    const cam = cameraIn(view.frameCamera, o.frame ?? doc.space.world) ?? view.camera;
    const s = worldToScreen(cam, view.viewport, o.anchor);
    const ppu = 2 ** (o.unit + cam.zi + cam.zf);
    const w = o.w * ppu;
    const h = o.h * ppu;
    const vp = view.viewport;
    const visible = w <= MAX_OVERLAY_PX && h <= MAX_OVERLAY_PX && s.x < vp.width && s.y < vp.height && s.x + w > 0 && s.y + h > 0;
    v.style.display = visible ? "" : "none";
    if (visible) {
      v.style.left = `${s.x}px`;
      v.style.top = `${s.y}px`;
      v.style.width = `${w}px`;
      v.style.height = `${h}px`;
      if (o.rot) {
        const pv = pivotOf(o);
        v.style.transformOrigin = `${pv.x * ppu}px ${pv.y * ppu}px`;
        v.style.transform = `rotate(${radiansFromAngle(o.rot)}rad)`;
      } else v.style.transform = "";
    }
    // The bar sits under the picture's centre, kept inside the view.
    const cx = Math.min(Math.max(s.x + Math.min(w, 4000) / 2, 180), vp.width - 180);
    bar.style.left = `${cx}px`;
    bar.style.top = `${Math.min(Math.max(s.y + Math.min(h, 4000) + 8, 60), vp.height - 56)}px`;
  };

  const release = (): void => {
    if (!cur) return;
    const o = cur;
    if (!v.paused) v.pause();
    if (!loading) actions.setMedia(o.id, { t: v.currentTime }, "Pause video");
    cur = null;
    v.hidden = bar.hidden = true;
    v.removeAttribute("src");
    v.load();
    if (url) URL.revokeObjectURL(url);
    url = "";
  };

  const open = async (o: ImageObject): Promise<void> => {
    cur = o;
    duration = 0;
    const mine = ++loading;
    v.hidden = bar.hidden = false;
    v.muted = false;
    const rec = await assets.record(o.assetId);
    if (mine !== loading || cur?.id !== o.id) return;
    if (!rec) {
      loading = 0;
      return;
    }
    url = URL.createObjectURL(rec.blob);
    v.src = url;
    await new Promise<void>((res) => v.addEventListener("loadedmetadata", () => res(), { once: true }));
    if (mine !== loading) return;
    duration = Number.isFinite(v.duration) ? v.duration : (rec.duration ?? 0);
    v.currentTime = Math.min(o.media!.t, duration);
    loading = 0;
    v.loop = o.media!.repeat;
    refresh();
    position();
  };

  const sync = (): void => {
    const id = editor.selection.size === 1 ? [...editor.selection][0]! : null;
    const o = id ? doc.get(id) : undefined;
    const want = o && o.kind === "image" && o.media?.kind === "video" && !o.hidden ? o : null;
    if (cur && cur.id !== want?.id) release();
    if (!want) return;
    if (!cur) {
      void open(want);
      return;
    }
    const prev = cur;
    cur = want;
    v.loop = want.media!.repeat;
    // An undo or redo changed the paused position: follow it (never while playing).
    if (v.paused && !loading && Math.abs(v.currentTime - want.media!.t) > 0.01 && want.media!.t !== prev.media!.t) v.currentTime = want.media!.t;
    position();
    refresh();
  };

  v.addEventListener("timeupdate", refresh);
  v.addEventListener("play", refresh);
  v.addEventListener("pause", refresh);
  v.addEventListener("ended", () => {
    if (cur && !cur.media!.repeat) actions.setMedia(cur.id, { t: duration }, "Pause video");
    refresh();
  });
  scrub.addEventListener("input", () => {
    v.currentTime = Number(scrub.value) * duration;
    refresh();
  });
  scrub.addEventListener("change", () => {
    if (cur && v.paused) actions.setMedia(cur.id, { t: v.currentTime }, "Seek video");
  });
  bar.addEventListener("click", (e) => {
    const cmd = (e.target as HTMLElement).closest<HTMLElement>("[data-cmd]")?.dataset["cmd"];
    if (!cur || !cmd) return;
    if (cmd === "play") {
      if (v.paused) {
        if (v.currentTime >= duration - 0.05) v.currentTime = 0;
        void v.play().catch(() => undefined);
      } else {
        v.pause();
        actions.setMedia(cur.id, { t: v.currentTime }, "Pause video");
      }
    } else if (cmd === "back" || cmd === "fwd") {
      const step = settings.get("media.step.video") * (cmd === "back" ? -1 : 1);
      v.currentTime = stepTime(v.currentTime, step, duration, cur.media!.repeat);
      if (v.paused) actions.setMedia(cur.id, { t: v.currentTime }, "Step video");
    } else if (cmd === "repeat") actions.setMedia(cur.id, { repeat: !cur.media!.repeat }, "Repeat video");
    else if (cmd === "mute") v.muted = !v.muted;
    refresh();
  });
  view.subscribe(position);
  doc.subscribe(sync);
  editor.subscribe(sync);
}
