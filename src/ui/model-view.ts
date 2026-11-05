import { MAX_MODEL_BYTES, ModelStage, firstLook, modelCardFit, readModel } from "../assets/model-engine";
import { LIGHT_PRESETS, MODEL_SECTIONS, defaultLook, readLook, writeLook } from "../assets/model-look";
import type { ModelLook } from "../assets/model-look";
import type { FileFacts, OpenView, ViewDeps, ViewPlace } from "./file-views";
import { esc } from "./format";
import { ICONS } from "./icons";
import { openMoreMenu } from "./more-menu";
import { bindSettingRow, settingRowHtml } from "./setting-rows";
import { keepViewState, toggledMark, viewStateOf } from "./view-state";
import type { ViewState } from "./view-state";

const KEEP_MS = 600;
const SETTINGS = MODEL_SECTIONS.flatMap((s) => s.items);

/** A 3D model in its view: turned, zoomed and lit by hand; what it shows can be kept (its place is kept by itself), bookmarked, or shown on a card on a canvas. */
export async function openModelView(el: HTMLElement, file: FileFacts, deps: ViewDeps, place: ViewPlace): Promise<OpenView> {
  if (file.blob.size > MAX_MODEL_BYTES) throw new Error("it is too large to open here");
  const model = await readModel(new Uint8Array(await file.blob.arrayBuffer()), file.name);
  el.innerHTML = `<div class="model-view" data-testid="model-view">
    <div class="view-bar">
      <button type="button" class="layer-btn" data-m="fit" data-testid="model-fit" aria-label="Back to the first view" title="The camera back at the first view (or double-click the model)">${ICONS.maximize}</button>
      <button type="button" class="layer-btn" data-m="lights" data-testid="model-lights" aria-haspopup="menu" aria-label="Lighting" title="Lighting: a classic setup">${ICONS.lightbulb}</button>
      <span class="view-gap"></span>
      <button type="button" class="layer-btn" data-m="mark" data-testid="model-mark" aria-label="Bookmark this view" aria-pressed="false" title="Bookmark this view, or take its bookmark off">${ICONS.bookmark}</button>
      <button type="button" class="layer-btn" data-m="marks" data-testid="model-marks" aria-haspopup="menu" aria-label="Go to" title="Bookmarked views">${ICONS.list}</button>
      ${place.setPreview ? `<button type="button" class="layer-btn" data-m="card" data-testid="model-card" aria-label="Show this view on the card" title="Show this view on the card on the canvas (this copy only)">${ICONS.image}</button>` : ""}
      <span class="view-gap"></span>
      <button type="button" class="layer-btn" data-m="side" data-testid="model-side-toggle" aria-pressed="true" aria-label="Settings" title="Show or hide the settings">${ICONS.slidersHorizontal}</button>
    </div>
    <div class="model-main">
      <div class="model-stage is-checker" data-testid="model-stage"><canvas></canvas></div>
      <div class="model-side" data-testid="model-side"></div>
    </div>
  </div>`;
  const root = el.querySelector<HTMLElement>(".model-view")!;
  const box = root.querySelector<HTMLElement>(".model-stage")!;
  const side = root.querySelector<HTMLElement>(".model-side")!;
  const markBtn = root.querySelector<HTMLElement>('[data-m="mark"]')!;
  const stage = await ModelStage.make(root.querySelector("canvas")!);
  if (!stage) {
    el.replaceChildren();
    throw new Error("this browser or machine has no 3D graphics");
  }
  stage.setModel(model);
  const hash = file.hash;
  const first = firstLook(file.name);
  let state: ViewState = viewStateOf(await deps.session.catalog?.entry(hash).catch(() => undefined));
  let look: ModelLook = readLook(state.at, first);
  let closed = false;
  let frame = 0;
  const paint = (): void => {
    if (closed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (closed) return;
      stage.draw(look, Math.max(1, box.clientWidth), Math.max(1, box.clientHeight), Math.min(devicePixelRatio || 1, 2));
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
  const build = (): void => {
    side.innerHTML = MODEL_SECTIONS.map((sec) => `<div class="adj-group"><h4>${esc(sec.title)}</h4>${sec.items.map((s) => settingRowHtml(s, look[s.k]!)).join("")}</div>`).join("");
    for (const r of side.querySelectorAll<HTMLElement>("[data-k]")) {
      const s = SETTINGS.find((x) => x.k === r.dataset["k"])!;
      bindSettingRow(r, s, (k) => look[k]!, (k, v) => {
        look = { ...look, [k]: v };
        changed();
      }, () => {
        look = { ...look, [s.k]: defaultLook(first)[s.k]! };
        build();
        changed();
      });
    }
  };
  /** The numbers of the camera shown, after a drag. */
  const showCamera = (): void => {
    for (const k of ["yaw", "pitch", "zoom", "panX", "panY"]) for (const i of side.querySelectorAll<HTMLInputElement>(`[data-k="${k}"] input`)) i.value = String(look[k]);
  };
  const wrap = (a: number): number => ((a + 540) % 360) - 180;
  let drag: { x: number; y: number; pan: boolean } | null = null;
  box.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button !== 0 };
    box.setPointerCapture(e.pointerId);
    box.closest<HTMLElement>("[tabindex]")?.focus({ preventScroll: true });
    e.preventDefault();
    e.stopPropagation();
  });
  box.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.pan) {
      const k = 1.6 / (Math.max(1, Math.min(box.clientWidth, box.clientHeight)) * (look["zoom"] as number));
      look = { ...look, panX: (look["panX"] as number) - dx * k, panY: (look["panY"] as number) + dy * k };
    } else look = { ...look, yaw: Math.round(wrap((look["yaw"] as number) - dx * 0.4) * 10) / 10, pitch: Math.round(Math.max(-89, Math.min(89, (look["pitch"] as number) + dy * 0.4)) * 10) / 10 };
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
  const toggleMark = async (): Promise<void> => {
    state = toggledMark({ ...state, at: writeLook(look) }, here(), () => 0);
    markBtn.setAttribute("aria-pressed", String(state.marks.some((m) => m.at === state.at)));
    keep();
    await place.refresh();
  };
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-m]");
    switch (b?.dataset["m"]) {
      case "fit": return toFirst();
      case "lights":
        return openMoreMenu(b, LIGHT_PRESETS.map((p) => ({ label: p.label, hint: p.hint, icon: ICONS.lightbulb, run: () => {
          look = { ...look, ...p.look };
          build();
          changed();
        } })), "Lighting");
      case "mark": return void toggleMark();
      case "marks":
        return openMoreMenu(b, state.marks.length ? state.marks.map((m) => ({ label: m.label, hint: "A bookmarked view", icon: ICONS.bookmark, run: () => go(m.at) })) : [{ label: "No bookmarks yet", hint: "Bookmark a view with the button beside this", icon: ICONS.bookmark, run: () => undefined }], "Go to");
      case "card": return place.setPreview?.(writeLook(look) || "{}", modelCardFit(box.clientWidth / Math.max(1, box.clientHeight)));
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
    goTo: go,
    toggleMark,
    here,
  };
}
