import { MAX_MODEL_BYTES, ModelStage, firstLook, linesInWorker, modelCardFit, readModel } from "../assets/model-engine";
import { linesSvg } from "../assets/model-lines";
import { LIGHT_PRESETS, MODEL_SECTIONS, defaultLook, readLook, writeLook } from "../assets/model-look";
import type { ModelLook } from "../assets/model-look";
import type { FileFacts, OpenView, ViewDeps, ViewPlace } from "./file-views";
import { ICONS } from "./icons";
import { barButton } from "./view-bar";
import { openMoreMenu } from "./more-menu";
import { mountSettings } from "./setting-rows";
import type { SettingValue } from "./setting-rows";
import type { Section, Setting } from "../gen/types";
import { keepViewState, markActions, toggledMark, viewStateOf } from "./view-state";
import type { MarksChange, ViewState } from "./view-state";

const KEEP_MS = 600;
/** The cards of a turnaround. */
const TURNAROUND = 8;
/** The most lines placed at once, the longest first. */
const MAX_LINES = 40_000;
/** Lines are found at this many times the canvas's size, up to a longer side of this many pixels. */
const LINES_FINER = 2;
const LINES_MAX_EDGE = 4096;

/** A 3D model in its view: turned, zoomed and lit by hand; what it shows can be kept (its place is kept by itself), bookmarked, or shown on a card on a canvas. */
export async function openModelView(el: HTMLElement, file: FileFacts, deps: ViewDeps, place: ViewPlace): Promise<OpenView> {
  if (file.blob.size > MAX_MODEL_BYTES) throw new Error("it is too large to open here");
  const model = await readModel(new Uint8Array(await file.blob.arrayBuffer()), file.name);
  // The rows of its pose, from what its file holds; none when it has no animations.
  const poseRows = (l: ModelLook): Section | null => {
    if (!model.clips.length) return null;
    const c = Math.min(model.clips.length - 1, l["clip"] as number);
    return {
      title: "Pose",
      items: [
        { t: "choice", k: "clip", label: "Animation", opts: model.clips.map((m, i) => [String(i), m.name || `Animation ${i + 1}`] as const), def: "0" },
        { t: "range", k: "poseTime", label: "Time", min: 0, max: Math.max(0.01, Math.round(model.clips[c]!.duration * 100) / 100), step: 0.01, def: 0, usual: [0, 1] },
      ],
    };
  };
  el.innerHTML = `<div class="model-view" data-testid="model-view">
    <div class="view-bar">
      ${barButton("fit", ICONS.locateFixed, "Back to the first view", "The camera back at the first view (or double-click the model)")}
      ${barButton("lights", ICONS.lightbulb, "Lighting", "Lighting: a classic setup", 'aria-haspopup="menu"')}
      <span class="view-gap"></span>
      ${barButton("mark", ICONS.bookmarkPlus, "Bookmark this view", "Bookmark this view, or take its bookmark off", 'aria-pressed="false"')}
      ${barButton("marks", ICONS.tableOfContents, "Go to", "Bookmarked views", 'aria-haspopup="menu"')}
      ${place.placeViews ? barButton("turn", ICONS.rotate3d, "Place a turnaround", "Place a turnaround on the canvas: eight cards, this view from all around") : ""}
      ${place.placeLines ? barButton("lines", ICONS.lineArt, "Place the lines on the canvas", "Place this view's line art on the canvas, as paths to edit") : ""}
      ${place.setPreview ? barButton("card", ICONS.pictureInPicture, "Show this view on the card", "Show this view on the card on the canvas, this copy only (Ctrl+S)") : ""}
      <span class="view-gap"></span>
      ${barButton("reset", ICONS.listRestart, "Reset the settings", "Reset the settings of this view")}
      ${barButton("side", ICONS.sliders, "Settings", "Show or hide the settings", 'aria-pressed="true"')}
    </div>
    <div class="model-main">
      <div class="model-stage is-checker" tabindex="0" data-testid="model-stage"><canvas></canvas></div>
      <div class="model-side" data-testid="model-side"></div>
    </div>
  </div>`;
  const root = el.querySelector<HTMLElement>(".model-view")!;
  const box = root.querySelector<HTMLElement>(".model-stage")!;
  const side = root.querySelector<HTMLElement>(".model-side")!;
  const markBtn = root.querySelector<HTMLElement>('[data-view-act="mark"]')!;
  const stage = await ModelStage.make(root.querySelector("canvas")!);
  if (!stage) {
    el.replaceChildren();
    throw new Error("this browser or machine has no 3D graphics");
  }
  stage.setModel(model);
  const hash = file.hash;
  const first = firstLook(file.name);
  let state: ViewState = viewStateOf(await deps.session.catalog?.entry(hash).catch(() => undefined));
  let look: ModelLook = readLook(place.startAt ?? state.at, first);
  let closed = false;
  let frame = 0;
  const paint = (): void => {
    box.classList.toggle("is-mirrored", !!look["mirror"]);
    if (closed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (closed) return;
      stage.draw(look, Math.max(1, box.clientWidth), Math.max(1, box.clientHeight), stage.heavy ? 1 : Math.min(devicePixelRatio || 1, 2));
      box.dataset["drawn"] = "1";
    });
  };
  let keepTimer: ReturnType<typeof setTimeout> | undefined;
  const keep = (): void => void keepViewState(deps.session, hash, state);
  const changed = (): void => {
    state = { ...state, at: writeLook(look) };
    markBtn.setAttribute("aria-pressed", String(state.marks.some((m) => m.at === state.at)));
    paint();
    clearTimeout(keepTimer);
    keepTimer = setTimeout(keep, KEEP_MS);
  };
  // (a choice's values are words: the animation is kept as its number)
  const sections = (): readonly Section[] => MODEL_SECTIONS.flatMap((sec) => (sec.title === "Pose" ? (poseRows(look) ? [poseRows(look)!] : []) : [sec]));
  const usual = (s: Setting): SettingValue => defaultLook(first)[s.k]!;
  const rows = mountSettings(side, {
    sections,
    get: (k) => (k === "clip" ? String(look[k]) : look[k]!),
    set: (k, v) => {
      look = { ...look, [k]: k === "clip" ? Number(v) : v };
      changed();
      // Lines alone on the usual dark ground would not show: paper, until a ground is chosen.
      if (k === "linesShow" && v === "only" && look["bg"] === defaultLook(first)["bg"]) look = { ...look, bg: "#ffffff" };
      if (k === "surface" || k === "clip" || k === "linesShow") build(); // (what it shows or hides, the length of the time)
    },
    reset: (keys) => {
      look = { ...look, ...Object.fromEntries(keys.map((s) => [s.k, usual(s)])) };
      changed();
    },
    idPrefix: "model-n-",
  });
  const build = (): void => rows.build();
  /** The numbers of the camera shown, after a drag. */
  const showCamera = (): void => {
    for (const k of ["yaw", "pitch", "zoom", "panX", "panY"]) for (const i of side.querySelectorAll<HTMLInputElement>(`[data-k="${k}"] input`)) i.value = String(look[k]);
  };
  const wrap = (a: number): number => ((a + 540) % 360) - 180;
  let drag: { x: number; y: number; pan: boolean } | null = null;
  box.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button !== 0 };
    box.setPointerCapture(e.pointerId);
    box.focus({ preventScroll: true });
    e.preventDefault();
    e.stopPropagation();
  });
  box.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.pan) {
      // (mirrored, what is seen moves the other way: a drag still follows the hand)
      const side = look["mirror"] ? -1 : 1;
      const k = 1.6 / (Math.max(1, Math.min(box.clientWidth, box.clientHeight)) * (look["zoom"] as number));
      look = { ...look, panX: (look["panX"] as number) - side * dx * k, panY: (look["panY"] as number) + dy * k };
    } else look = { ...look, yaw: Math.round(wrap((look["yaw"] as number) - (look["mirror"] ? -dx : dx) * 0.4) * 10) / 10, pitch: Math.round(Math.max(-89, Math.min(89, (look["pitch"] as number) + dy * 0.4)) * 10) / 10 };
    showCamera();
    changed();
  });
  for (const type of ["pointerup", "pointercancel"]) box.addEventListener(type, () => void (drag = null));
  box.addEventListener("contextmenu", (e) => e.preventDefault());
  box.addEventListener("wheel", (e) => {
    e.preventDefault();
    e.stopPropagation();
    look = { ...look, zoom: Math.max(0.1, Math.min(10, (look["zoom"] as number) * Math.exp(-e.deltaY * 0.001))) };
    showCamera();
    changed();
  }, { passive: false });
  const toFirst = (): void => {
    look = { ...look, ...Object.fromEntries(["yaw", "pitch", "zoom", "panX", "panY"].map((k) => [k, defaultLook(first)[k]!])) };
    showCamera();
    changed();
  };
  box.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    toFirst();
  });
  const go = (at: string): void => {
    look = readLook(at, first);
    build();
    changed();
  };
  const here = (): { at: string; label: string } => ({ at: writeLook(look), label: `View ${state.marks.length + 1}` });
  const paintMark = (): void => markBtn.setAttribute("aria-pressed", String(state.marks.some((m) => m.at === state.at)));
  const changeMarks: MarksChange = (change) => {
    state = { ...state, marks: change(state.marks) };
    paintMark();
    keep();
    void place.refresh();
  };
  const showOnCard = (): void => {
    place.setPreview?.(writeLook(look) || "{}", modelCardFit(box.clientWidth / Math.max(1, box.clientHeight)));
    deps.session.editor.message = "This view now shows on the card.";
    deps.session.editor.changed();
  };
  const toggleMark = async (): Promise<void> => {
    state = toggledMark({ ...state, at: writeLook(look) }, here(), () => 0);
    markBtn.setAttribute("aria-pressed", String(state.marks.some((m) => m.at === state.at)));
    keep();
    await place.refresh();
  };
  /** The line art of this view, as real paths: the lines it shows, followed along their middles, off the page. */
  const placeLines = async (): Promise<void> => {
    const { w: cw, h: ch } = stage.pixels;
    // (finer than the screen: a line's path is then smoother than its pixels)
    const k = Math.min(LINES_MAX_EDGE / Math.max(cw, ch), Math.max(1, LINES_FINER));
    const w = Math.round(cw * k), h = Math.round(ch * k);
    const mask = stage.linesMask(look, w, h);
    if (!mask) return;
    deps.session.editor.message = "Finding the lines of this view…";
    deps.session.editor.changed();
    try {
      const { lines, dropped } = await linesInWorker({ mask, w, h, shortest: (look["linesShortest"] as number) * k, simplify: 0.8, most: MAX_LINES });
      if (closed) return;
      if (!lines.length) {
        deps.session.editor.message = "No lines were found in this view.";
        return deps.session.editor.changed();
      }
      place.placeLines?.(linesSvg(lines, w, h, look["linesColour"] as string, Math.max(0.5, ((look["linesWidth"] as number) * h) / 800)), { w, h });
      deps.session.editor.message = `Placed ${lines.length.toLocaleString("en")} ${lines.length === 1 ? "line" : "lines"}${dropped ? `; the ${dropped.toLocaleString("en")} shortest left out` : ""}.`;
      deps.session.editor.changed();
    } catch (e) {
      deps.session.editor.message = `The lines could not be found: ${(e as Error).message}.`;
      deps.session.editor.changed();
    }
  };
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-view-act]");
    switch (b?.dataset["viewAct"]) {
      case "fit": return toFirst();
      case "reset":
        look = defaultLook(first);
        build();
        return changed();
      case "lights":
        return openMoreMenu(b, LIGHT_PRESETS.map((p) => ({ label: p.label, hint: p.hint, icon: ICONS.lightbulb, run: () => {
          look = { ...look, ...p.look };
          build();
          changed();
        } })), "Lighting");
      case "mark": return void toggleMark();
      case "marks":
        return openMoreMenu(b, state.marks.length ? state.marks.map((m) => ({ label: m.label, hint: "A bookmarked view", icon: ICONS.bookmark, run: () => go(m.at), more: markActions(m, changeMarks) })) : [{ label: "No bookmarks yet", hint: "Bookmark a view with the button beside this", icon: ICONS.bookmark, run: () => undefined }], "Go to");
      case "turn": {
        const fit = modelCardFit(box.clientWidth / Math.max(1, box.clientHeight));
        return place.placeViews?.(Array.from({ length: TURNAROUND }, (_, i) => ({ preview: writeLook({ ...look, yaw: wrap((look["yaw"] as number) + (360 * i) / TURNAROUND) }) || "{}", size: fit })));
      }
      case "lines":
        return void placeLines();
      case "card": return showOnCard();
      case "side": {
        side.hidden = !side.hidden;
        b.setAttribute("aria-pressed", String(!side.hidden));
        return;
      }
    }
  });
  const resized = new ResizeObserver(paint);
  resized.observe(box);
  build();
  markBtn.setAttribute("aria-pressed", String(state.marks.some((m) => m.at === state.at)));
  paint();
  return {
    hash,
    leave: async () => true,
    close: () => {
      closed = true;
      cancelAnimationFrame(frame);
      clearTimeout(keepTimer);
      keep();
      resized.disconnect();
      stage.dispose();
      el.replaceChildren();
    },
    zoom: (dir) => {
      look = { ...look, zoom: dir === 0 ? 1 : Math.max(0.1, Math.min(10, (look["zoom"] as number) * 1.25 ** dir)) };
      showCamera();
      changed();
    },
    key: (e) => {
      if (!place.setPreview || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || (e.key !== "s" && e.key !== "S")) return false;
      showOnCard();
      return true;
    },
    goTo: go,
    toggleMark,
    changeMarks,
    here,
  };
}
