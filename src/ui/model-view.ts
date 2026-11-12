import { MAX_MODEL_BYTES, ModelStage, firstLook, linesInWorker, modelCardFit, readModel } from "../assets/model-engine";
import { drawingOfLines, inkSvg, lineCount } from "../assets/model-edges";
import type { Drawing } from "../assets/model-edges";
import { LIGHT_PRESETS, LINE_PRESETS, MODEL_SECTIONS, MODEL_TABS, cleanLineStyle, defaultLook, readLook, withLineStyle, writeLook } from "../assets/model-look";
import type { ModelLook } from "../assets/model-look";
import { LINE_STYLE_KIND } from "../assets/styles";
import { plural } from "../doc/plural";
import type { CardLook, FileFacts, OpenView, ViewDeps, ViewPlace } from "./file-views";
import { saveFile } from "./file-actions";
import { ICONS } from "./icons";
import { barButton } from "./view-bar";
import { openMoreMenu } from "./more-menu";
import type { MenuItem } from "./more-menu";
import { mountSettings } from "./setting-rows";
import type { SettingValue } from "./setting-rows";
import type { Section, Setting } from "../gen/types";
import { keepViewState, markActions, toggledMark, viewStateOf } from "./view-state";
import { modelViewInFront, setModelViewInFront } from "./model-front";
import type { MarksChange, ViewState } from "./view-state";

const KEEP_MS = 600;
/** The cards of a turnaround. */
const TURNAROUND = 8;
/** The most lines placed at once, the longest first. */
const MAX_LINES = 40_000;
/** Lines are found at this many times the canvas's size, up to a longer side of this many pixels. */
const LINES_FINER = 2;
const LINES_MAX_EDGE = 4096;
/** Groups of line settings that only lines from the model's edges have. */
const EDGE_ONLY = new Set(["Hidden edges", "Shading", "Hand-drawn"]);
/** Settings other rows show or hide by: the rows are made again when one changes. */
const SHAPERS = new Set(["surface", "clip", ...MODEL_SECTIONS.flatMap((s) => s.items.flatMap((i) => (i.when ? [i.when[0]!] : [])))]);


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
  // What a narrow view folds into its More menu: the bar keeps what turns and looks.
  const minor = 'data-minor=""';
  el.innerHTML = `<div class="model-view" data-testid="model-view">
    <div class="view-bar">
      ${barButton("fit", ICONS.locateFixed, "Back to the first view", "The camera back at the first view (or double-click the model)")}
      ${barButton("lights", ICONS.lightbulb, "Lighting", "Lighting: a classic setup", 'aria-haspopup="menu"')}
      ${barButton("styles", ICONS.draftingCompass, "Line styles", "Line styles: blueprint, ink, etching… and your own", 'aria-haspopup="menu"')}
      <span class="view-gap"></span>
      ${barButton("mark", ICONS.bookmarkPlus, "Bookmark this view", "Bookmark this view, or take its bookmark off", `aria-pressed="false" ${minor} data-hint="Or take its bookmark off"`)}
      ${barButton("marks", ICONS.tableOfContents, "Go to", "Bookmarked views", `aria-haspopup="menu" ${minor} data-hint="Its bookmarked views"`)}
      ${place.placeViews ? barButton("turn", ICONS.rotate3d, "Place a turnaround", "Place a turnaround on the canvas: eight cards, this view from all around", `${minor} data-hint="Eight cards, from all around"`) : ""}
      ${place.placeLines ? barButton("lines", ICONS.lineArt, "Place the lines on the canvas", "Place this view's line art on the canvas, as paths to edit", `${minor} data-hint="As paths to edit"`) : ""}
      ${place.setPreview ? barButton("card", ICONS.pictureInPicture, "Show this view on the card", "Show this view on the card on the canvas, this copy only (Ctrl+S)", `${minor} data-hint="This copy only (Ctrl+S)"`) : ""}
      ${barButton("svg", ICONS.download, "Save the lines as SVG", "Save this view's line art as an SVG file", `${minor} data-hint="Each kind of line in its own group"`)}
      <span class="view-gap"></span>
      ${barButton("reset", ICONS.listRestart, "Reset the settings", "Reset the settings of this view", `${minor} data-hint="All of this view's settings"`)}
      ${barButton("more", ICONS.ellipsis, "More", "More of this view", 'aria-haspopup="menu"')}
      ${barButton("side", ICONS.sliders, "Settings", "Show or hide the settings", 'aria-pressed="true"')}
    </div>
    <div class="model-main">
      <div class="model-stage is-checker" tabindex="0" data-testid="model-stage"><canvas></canvas></div>
      <div class="model-side" data-testid="model-side">
        <div class="seg pg-tabs" role="tablist" aria-label="Settings of the view">${MODEL_TABS.map((t) => `<button type="button" role="tab" data-tab="${t.id}" data-testid="model-tab-${t.id}" aria-selected="${t.id === "view"}">${t.label}</button>`).join("")}</div>
        <div class="model-rows" role="tabpanel"></div>
      </div>
    </div>
  </div>`;
  const root = el.querySelector<HTMLElement>(".model-view")!;
  const box = root.querySelector<HTMLElement>(".model-stage")!;
  const side = root.querySelector<HTMLElement>(".model-side")!;
  const rowsEl = side.querySelector<HTMLElement>(".model-rows")!;
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
  let tab = "view";
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
      box.dataset["inked"] = stage.inkCurrent ? "1" : "0"; // (its lines from the model's edges are those of this view)
    });
  };
  // (the lines of the model's edges come a moment after the view: drawn again with them)
  stage.onInk = paint;
  let keepTimer: ReturnType<typeof setTimeout> | undefined;
  const keep = (): void => void keepViewState(deps.session, hash, state);
  const changed = (): void => {
    state = { ...state, at: writeLook(look) };
    markBtn.setAttribute("aria-pressed", String(state.marks.some((m) => m.at === state.at)));
    paint();
    clearTimeout(keepTimer);
    keepTimer = setTimeout(keep, KEEP_MS);
  };
  const linesOn = (): boolean => look["linesShow"] !== "off";
  const tabOf = (title: string): string => MODEL_TABS.find((t) => t.titles.includes(title))?.id ?? "view";
  // The groups of the tab shown: lines that are off show only their switch, and what only lines from edges have goes with them.
  const sections = (): readonly Section[] =>
    MODEL_SECTIONS.flatMap((sec): Section[] => {
      if (tabOf(sec.title) !== tab) return [];
      if (sec.title === "Pose") return poseRows(look) ? [poseRows(look)!] : [];
      if (sec.title === "Lines" && !linesOn()) return [{ ...sec, items: sec.items.filter((i) => i.k === "linesShow") }];
      if (EDGE_ONLY.has(sec.title) && (!linesOn() || look["linesBy"] === "picture")) return [];
      return [sec];
    });
  const usual = (s: Setting): SettingValue => defaultLook(first)[s.k]!;
  const rows = mountSettings(rowsEl, {
    sections,
    get: (k) => (k === "clip" ? String(look[k]) : look[k]!),
    set: (k, v) => {
      look = { ...look, [k]: k === "clip" ? Number(v) : v };
      // Lines alone or on a fill would not show on the usual dark ground: paper, until a ground is chosen.
      if (k === "linesShow" && (v === "only" || v === "flat") && look["bg"] === defaultLook(first)["bg"]) look = { ...look, bg: "#ffffff" };
      changed();
      if (SHAPERS.has(k)) build(); // (what it shows or hides, the length of the time)
    },
    reset: (keys) => {
      look = { ...look, ...Object.fromEntries(keys.map((s) => [s.k, usual(s)])) };
      changed();
    },
    idPrefix: "model-n-",
  });
  const build = (): void => rows.build();
  const showTab = (id: string): void => {
    tab = id;
    for (const b of side.querySelectorAll<HTMLElement>("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset["tab"] === id));
    build();
  };
  side.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]");
    if (b) showTab(b.dataset["tab"]!);
  });
  /** The numbers of the camera shown, after a drag. */
  const showCamera = (): void => {
    for (const k of ["yaw", "pitch", "zoom", "panX", "panY"]) for (const i of rowsEl.querySelectorAll<HTMLInputElement>(`[data-k="${k}"] input`)) i.value = String(look[k]);
  };
  const wrap = (a: number): number => ((a + 540) % 360) - 180;
  const zoomBy = (k: number): void => void (look = { ...look, zoom: Math.max(0.1, Math.min(10, (look["zoom"] as number) * k)) });
  /** Slides the camera by a move on the screen, in pixels. */
  const slide = (dx: number, dy: number): void => {
    // (mirrored, what is seen moves the other way: a drag still follows the hand)
    const way = look["mirror"] ? -1 : 1;
    const k = 1.6 / (Math.max(1, Math.min(box.clientWidth, box.clientHeight)) * (look["zoom"] as number));
    look = { ...look, panX: (look["panX"] as number) - way * dx * k, panY: (look["panY"] as number) + dy * k };
  };
  // One pointer turns the model (or slides it: Shift, or another button); two pinch to zoom and move together to slide.
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: { pan: boolean } | null = null;
  const settle = (): void => {
    if (pointers.size || !stage.moving) return;
    stage.moving = false;
    paint();
  };
  box.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = { pan: e.shiftKey || e.button !== 0 };
    box.setPointerCapture(e.pointerId);
    box.focus({ preventScroll: true });
    e.preventDefault();
    e.stopPropagation();
  });
  box.addEventListener("pointermove", (e) => {
    const was = pointers.get(e.pointerId);
    if (!drag || !was) return;
    const now = { x: e.clientX, y: e.clientY };
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.entries()].slice(0, 2).map(([id, p]) => (id === e.pointerId ? now : p)) as [{ x: number; y: number }, { x: number; y: number }];
      const [pa, pb] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const before = Math.hypot(pa.x - pb.x, pa.y - pb.y), after = Math.hypot(a.x - b.x, a.y - b.y);
      if (before > 0 && after > 0) zoomBy(after / before);
      slide((a.x + b.x - pa.x - pb.x) / 2, (a.y + b.y - pa.y - pb.y) / 2);
    } else {
      const dx = now.x - was.x, dy = now.y - was.y;
      if (drag.pan) slide(dx, dy);
      else look = { ...look, yaw: Math.round(wrap((look["yaw"] as number) - (look["mirror"] ? -dx : dx) * 0.4) * 10) / 10, pitch: Math.round(Math.max(-89, Math.min(89, (look["pitch"] as number) + dy * 0.4)) * 10) / 10 };
    }
    pointers.set(e.pointerId, now);
    stage.moving = true;
    showCamera();
    changed();
  });
  for (const type of ["pointerup", "pointercancel"])
    box.addEventListener(type, (e) => {
      pointers.delete((e as PointerEvent).pointerId);
      if (!pointers.size) drag = null;
      settle();
    });
  box.addEventListener("contextmenu", (e) => e.preventDefault());
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  box.addEventListener("wheel", (e) => {
    e.preventDefault();
    e.stopPropagation();
    zoomBy(Math.exp(-e.deltaY * 0.001));
    stage.moving = true;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(settle, 150);
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
  const card = (): CardLook => ({ preview: writeLook(look) || "{}", size: modelCardFit(box.clientWidth / Math.max(1, box.clientHeight)) });
  const say = (text: string): void => {
    deps.session.editor.message = text;
    deps.session.editor.changed();
  };
  const showOnCard = (): void => {
    const c = card();
    place.setPreview?.(c.preview, c.size);
    say("This view now shows on the card.");
  };
  const toggleMark = async (): Promise<void> => {
    state = toggledMark({ ...state, at: writeLook(look) }, here(), () => 0);
    markBtn.setAttribute("aria-pressed", String(state.marks.some((m) => m.at === state.at)));
    keep();
    await place.refresh();
  };
  /** A line style on this view: its lines, its fill and its ground; the Lines tab shows what it set. */
  const useLineStyle = (style: ModelLook, name: string): void => {
    look = withLineStyle(look, style);
    showTab("lines");
    changed();
    say(`Lines: ${name}.`);
  };
  /** This view's line art, as exact lines: from the model's edges, or followed along the middles of what the picture shows (off the page either way). */
  const drawingNow = async (look: ModelLook): Promise<{ drawing: Drawing; dropped: number } | null> => {
    const { w: cw, h: ch } = stage.pixels;
    // (finer than the screen: a line's path is then smoother than its pixels)
    const k = Math.min(LINES_MAX_EDGE / Math.max(cw, ch), Math.max(1, LINES_FINER));
    const w = Math.round(cw * k), h = Math.round(ch * k);
    if (look["linesBy"] !== "picture") {
      const drawing = await stage.inkOf(look, w, h);
      return drawing && { drawing, dropped: 0 };
    }
    const mask = stage.linesMask(look, w, h);
    if (!mask) return null;
    const { lines, dropped } = await linesInWorker({ mask, w, h, shortest: (look["linesShortest"] as number) * k, simplify: 0.8, most: MAX_LINES });
    return { drawing: drawingOfLines(lines, w, h, Math.max(0.5, ((look["linesWidth"] as number) * h) / 800)), dropped };
  };
  /** Finds this view's lines (even when they are not shown: as the Lines tab has them), then does something with them. */
  const withLines = async (doing: string, then: (d: Drawing, dropped: number, l: ModelLook) => void | Promise<void>): Promise<void> => {
    const l: ModelLook = linesOn() ? look : { ...look, linesShow: "only" };
    say(doing);
    try {
      const got = await drawingNow(l);
      if (closed) return;
      if (!got || !lineCount(got.drawing)) return say("No lines were found in this view.");
      await then(got.drawing, got.dropped, l);
    } catch (e) {
      say(`The lines could not be found: ${(e as Error).message}.`);
    }
  };
  const placeLines = (): Promise<void> =>
    withLines("Finding the lines of this view…", (d, dropped, l) => {
      // (on the canvas: the lines and their fill, with no ground and no picture of the model, and turned as the view shows it)
      place.placeLines?.(inkSvg(d, ModelStage.inkStyle(l, d.h, true), { mirror: !!l["mirror"] }), { w: d.w, h: d.h });
      const n = lineCount(d);
      say(`Placed ${plural(n, "line")}${dropped ? `; the ${dropped.toLocaleString("en")} shortest left out` : ""}.`);
    });
  const saveSvg = (): Promise<void> =>
    withLines("Making an SVG of this view's lines…", async (d, _dropped, l) => {
      // (the file has the ground and, over the model, the picture of it under its lines)
      const raster = l["linesShow"] === "over" ? stage.canvas.toDataURL("image/png") : undefined;
      const svg = inkSvg(d, ModelStage.inkStyle(l, d.h, true), { background: (l["bg"] as string) || undefined, raster, mirror: !!l["mirror"] });
      const name = `${file.name.replace(/\.[^.]+$/, "")} lines.svg`;
      if (await saveFile(name, new Blob([svg], { type: "image/svg+xml" }))) say(`Saved ${name}.`);
    });
  const styleMenu = (b: HTMLElement): void => {
    const saved = deps.session.styles.of(LINE_STYLE_KIND.id);
    const items: MenuItem[] = [
      ...LINE_PRESETS.map((p) => ({ label: p.label, hint: p.hint, icon: ICONS.draftingCompass, id: `line-${p.id}`, run: () => useLineStyle(p.look, p.label) })),
      ...saved.map((s, i) => ({ label: s.name, hint: LINE_STYLE_KIND.summary(s.data), icon: ICONS.draftingCompass, sep: i === 0, run: () => useLineStyle(s.data as ModelLook, s.name) })),
      {
        label: "Save these lines as a style",
        hint: "Kept in Styles, for any model",
        icon: ICONS.save,
        sep: true,
        run: () =>
          void deps.session.styles.add(LINE_STYLE_KIND.id, "", cleanLineStyle(look)).then((made) => say(made ? `Saved the line style “${made.name}” in Styles.` : "The line style could not be saved.")),
      },
    ];
    openMoreMenu(b, items, "Line styles");
  };
  /** What a narrow view keeps in its More menu: the bar's own buttons, by their names. */
  const moreMenu = (b: HTMLElement): void =>
    openMoreMenu(
      b,
      [...root.querySelectorAll<HTMLButtonElement>(".view-bar [data-minor]")].map((x): MenuItem => ({ label: x.getAttribute("aria-label")!, hint: x.dataset["hint"] ?? x.title, icon: x.innerHTML, ...(x.getAttribute("aria-pressed") === "true" ? { checked: true } : {}), run: () => x.click() })),
      "More of this view",
    );
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
          showTab("light");
          changed();
        } })), "Lighting");
      case "styles": return styleMenu(b);
      case "more": return moreMenu(b);
      case "mark": return void toggleMark();
      case "marks":
        return openMoreMenu(b, state.marks.length ? state.marks.map((m) => ({ label: m.label, hint: "A bookmarked view", icon: ICONS.bookmark, run: () => go(m.at), more: markActions(m, changeMarks) })) : [{ label: "No bookmarks yet", hint: "Bookmark a view with the button beside this", icon: ICONS.bookmark, run: () => undefined }], "Go to");
      case "turn": {
        const fit = modelCardFit(box.clientWidth / Math.max(1, box.clientHeight));
        return place.placeViews?.(Array.from({ length: TURNAROUND }, (_, i) => ({ preview: writeLook({ ...look, yaw: wrap((look["yaw"] as number) + (360 * i) / TURNAROUND) }) || "{}", size: fit })));
      }
      case "lines": return void placeLines();
      case "svg": return void saveSvg();
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
  const front = { useLineStyle };
  setModelViewInFront(front);
  root.addEventListener("pointerdown", () => setModelViewInFront(front), true);
  return {
    hash,
    leave: async () => true,
    close: () => {
      closed = true;
      if (modelViewInFront() === front) setModelViewInFront(null);
      cancelAnimationFrame(frame);
      clearTimeout(keepTimer);
      clearTimeout(wheelTimer);
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
    card,
  };
}
