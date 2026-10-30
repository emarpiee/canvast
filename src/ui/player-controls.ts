import type { SettingsStore } from "../settings/settings";
import { ICONS } from "./icons";
import type { Engine } from "./media-player";

/**
 * The control bar of the on-canvas media player, reused for the Assets viewer (ADR 0064): the same engines (a video or audio file by an
 * HTML media element, a GIF frame by frame), the same look, the same device settings (step lengths, volume). It controls one engine at a
 * time; unlike the canvas bar it never writes to a document (the viewer only plays).
 */
export type PlayerKind = "video" | "audio" | "gif";

export interface PlayerControls {
  readonly el: HTMLElement;
  /** Control this engine (already loaded). `repeat` is whether it loops. */
  show(engine: Engine, kind: PlayerKind, repeat: boolean): void;
  hide(): void;
  /** Redraw from the engine's state (called as it ticks). */
  refresh(): void;
}

export function mountPlayerControls(host: HTMLElement, settings: SettingsStore, hooks: { extract(): void }): PlayerControls {
  const bar = document.createElement("div");
  bar.className = "toolbar media-bar viewer-media-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Media player");
  bar.dataset["testid"] = "viewer-media-bar";
  bar.tabIndex = -1; // (a click on its empty space puts the focus in the player, so its keys are the player's)
  bar.hidden = true;
  const btn = (cmd: string, icon: string, label: string): string => `<button type="button" data-cmd="${cmd}" aria-label="${label}" title="${label}">${icon}</button>`;
  bar.innerHTML = `<div class="media-row"><input type="range" class="media-scrub" min="0" max="1" step="any" value="0" aria-label="Position"><output class="media-time">0:00 / 0:00</output></div>
    <div class="media-row">${btn("back", ICONS.rewind, "Step back")}${btn("play", ICONS.play, "Play")}${btn("fwd", ICONS.fastForward, "Step forward")}${btn("extract", ICONS.imageDown, "Extract frame: keeps this frame as a picture in the library (Settings > Media and playback can also place it on the open canvas)")}${btn("repeat", ICONS.repeat, "Repeat")}<span class="media-gap"></span>${btn("mute", ICONS.volume, "Mute")}<input type="range" class="media-volume" min="0" max="100" step="1" aria-label="Volume"></div>`;
  host.append(bar);
  const $ = <T extends HTMLElement>(sel: string): T => bar.querySelector<T>(sel)!;
  const scrub = $<HTMLInputElement>(".media-scrub");
  const time = $<HTMLOutputElement>(".media-time");
  const playBtn = $<HTMLButtonElement>('[data-cmd="play"]');
  const repeatBtn = $<HTMLButtonElement>('[data-cmd="repeat"]');
  const muteBtn = $<HTMLButtonElement>('[data-cmd="mute"]');
  const volume = $<HTMLInputElement>(".media-volume");
  const extractBtn = $<HTMLButtonElement>('[data-cmd="extract"]');
  let eng: Engine | null = null;
  let kind: PlayerKind = "video";
  let loop = false;
  const video = (): HTMLVideoElement | null => (eng && eng.el instanceof HTMLVideoElement ? eng.el : null);

  const step = (dir: -1 | 1): void => eng?.step(dir, settings.get(kind === "gif" ? "media.step.gif" : kind === "audio" ? "media.step.audio" : "media.step.video"), loop);
  const refresh = (): void => {
    if (!eng) return;
    const len = eng.len();
    if (document.activeElement !== scrub) scrub.value = String(len ? eng.pos() / len : 0);
    time.textContent = eng.label();
    const playing = eng.playing();
    playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    playBtn.title = playing ? "Pause" : "Play";
    repeatBtn.setAttribute("aria-pressed", String(loop));
    muteBtn.hidden = volume.hidden = kind === "gif";
    extractBtn.hidden = kind === "audio";
    const muted = video()?.muted ?? false;
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.innerHTML = muted ? ICONS.volumeOff : ICONS.volume;
    if (document.activeElement !== volume) volume.value = String(muted ? 0 : Math.round((video()?.volume ?? 1) * 100));
  };

  scrub.addEventListener("input", () => {
    if (!eng) return;
    eng.seek(Number(scrub.value) * eng.len());
    refresh();
  });
  volume.addEventListener("input", () => {
    const n = Number(volume.value); // (this player's own: the setting is only where a player starts)
    const v = video();
    if (v) {
      v.muted = n === 0;
      v.volume = n / 100;
    }
  });
  bar.addEventListener("click", (e) => {
    const cmd = (e.target as HTMLElement).closest<HTMLElement>("[data-cmd]")?.dataset["cmd"];
    if (!eng || !cmd) return;
    if (cmd === "play") {
      if (eng.playing()) eng.pause();
      else eng.play();
    } else if (cmd === "back" || cmd === "fwd") {
      step(cmd === "back" ? -1 : 1);
    } else if (cmd === "extract") {
      hooks.extract();
    } else if (cmd === "repeat") {
      loop = !loop;
      eng.setLoop(loop);
    } else if (cmd === "mute") {
      const v = video();
      if (v) v.muted = !v.muted;
    }
    refresh();
  });
  // Keys on the bar are the bar's (the viewer's arrow keys step the asset, a space plays or pauses the slideshow): a slider keeps its
  // own arrows, and while the focus is anywhere in the player (also once it has faded away) Left and Right step the file back and
  // forward and Space plays or pauses it (not the button that has the focus).
  const PLAYER_KEYS = ["ArrowLeft", "ArrowRight", " "];
  bar.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).matches("input[type=range]") && e.key !== " ") return void e.stopPropagation();
    if (!PLAYER_KEYS.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey || !eng) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === " ") {
      if (!e.repeat) void (eng.playing() ? eng.pause() : eng.play());
    } else step(e.key === "ArrowLeft" ? -1 : 1);
    refresh();
  });
  bar.addEventListener("keyup", (e) => e.key === " " && e.preventDefault()); // (a button would take the space as a click on key up)
  // The bar never starts a pan or a click on the picture under it.
  for (const type of ["pointerdown", "dblclick", "click"]) bar.addEventListener(type, (e) => e.stopPropagation());

  return {
    el: bar,
    show(engine, k, repeat) {
      eng = engine;
      kind = k;
      loop = repeat;
      engine.setLoop(repeat);
      engine.onTick = refresh;
      const v = video();
      if (v) v.volume = settings.get("media.volume") / 100;
      bar.hidden = false;
      refresh();
    },
    hide() {
      if (eng) eng.onTick = () => undefined;
      eng = null;
      bar.hidden = true;
    },
    refresh,
  };
}
