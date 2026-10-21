import { curveCanvas, wireCurve } from "./curve-editor";
import { ICONS } from "./icons";
import { esc } from "./format";
import { panelHtml } from "./panel";
import { moreButton, openMoreMenu } from "./more-menu";
import { confirmDialog, promptDialog } from "./confirm";
import { saveFile } from "./file-actions";
import { scrubNumbers } from "../colour-picker/scrub";
import { settingRow, wireSettingRow } from "./setting-rows";
import type { DockSpec } from "./panel-dock";
import { newObjectId } from "../doc/model";
import { deflate, hashOf, inflate } from "../paint/codec";
import type { BrushEngine } from "../paint/engine";
import type { TipBitmap } from "../paint/engine-protocol";
import type { PaintStore } from "../paint/store";
import type { ToolId, Values } from "../paint/tools";
import { BRUSH_SECTIONS, MAX_BRUSHES, MAX_BRUSH_NAME, PATTERN_STYLES, brushOf, cleanBrushes, lockOf, pickedBrush, presetBitmaps, engineValue, flatScale, getPath, isFlat, pickedValues, setPath, shown, tipsOf, withKeys, type Brush, type BrushPreset, type BrushSetting } from "../paint/brushes";

/**
 * The Brushes panel and the Brush Settings panel of the Paint view (ADR 0169), both in the panel dock (ADR 0123) like the canvas's panels.
 * Brushes: the presets of the library, in groups and folders, with a picture of each tip; a press picks one for the painting tool in use;
 * Save, Rename, Delete, Import (.abr, canvast brush files) and Export. Brush Settings: the tool's brush, one section per section of the
 * engine, built from `BRUSH_SECTIONS`. Both change the tool's brush (its values, its brush, the preset it came from), which paint-view keeps.
 */
export interface BrushPanelDeps {
  readonly store: PaintStore | null;
  /** The brush engine (started when a painting is opened); null when it did not start. */
  engine(): Promise<BrushEngine | null>;
  readOnly(): boolean;
  tell(text: string): void;
  /** The painting tool in use, whose brush the panels show; null when the rail's tool does not paint. */
  tool(): ToolId | null;
  values(t: ToolId): Values;
  brush(t: ToolId): Brush;
  preset(t: ToolId): string;
  setTool(t: ToolId, patch: { values?: Values; brush?: Brush; preset?: string }): void;
  /** How the Brushes panel lists the presets (a device setting). */
  view(): "list" | "grid";
  setView(v: "list" | "grid"): void;
  /** Put a panel in the dock (the left stack, beside the tools). */
  dock(el: HTMLElement, spec: DockSpec): void;
}

export type BrushPanelId = "brushes" | "settings";

export interface BrushPanels {
  toggle(which: BrushPanelId): void;
  isOpen(which: BrushPanelId): boolean;
  /** The view was shown or hidden, or the rail's tool changed: the panels follow (nothing is done when neither changed). */
  sync(visible: boolean): void;
  /** The tool's values, brush or preset changed (the options bar, a key): the panels show it. */
  changed(): void;
  /** The presets (loaded, with the built-in ones the first time). */
  presets(): Promise<readonly BrushPreset[]>;
  /** The name of the preset the tool's brush came from, or "". */
  presetName(t: ToolId): string;
}

/** A canvast brush file: presets and the bitmaps they name (u16 samples, deflated, base64). */
const FILE_KIND = "canvast-brushes";
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

const b64 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const tipBytes = (t: TipBitmap): Uint8Array => new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength);
const stem = (name: string): string => name.replace(/\.[^.]+$/, "").trim().slice(0, MAX_BRUSH_NAME) || "Imported";

/** A preset as the engine gives it (a file's, the built-in ones), with its bitmaps' "#n" keys made their hashes. */
const fromEngine = (raw: object, hashes: readonly string[]): unknown => {
  const r = raw as Record<string, unknown>;
  return { id: newObjectId(), name: r["name"] || "Brush", group: r["group"], folder: r["folder"], brush: withKeys((r["brush"] ?? {}) as Brush, hashes), captures: r["captures"] };
};

export function mountBrushPanels(deps: BrushPanelDeps): BrushPanels {
  const open = { brushes: false, settings: false };
  let visible = false;
  let list: BrushPreset[] = [];
  let loading: Promise<void> | null = null;
  let filter = "";
  let defaults: Brush = {};

  // ---- the presets: in memory, stored after every change ---------------------------------------------------------------------------

  const tipBlobs = (tips: readonly TipBitmap[]) => Promise.all(tips.map(async (t) => ({ hash: t.key, data: await deflate(tipBytes(t)) })));
  /** Store a new list (with the bitmaps new to it); false when it could not be stored (a read-only tab, a storage error). */
  const save = async (next: BrushPreset[], tips: readonly TipBitmap[] = []): Promise<boolean> => {
    if (!deps.store || deps.readOnly()) {
      deps.tell("The brushes cannot be changed in this tab: another tab is writing.");
      return false;
    }
    try {
      await deps.store.saveBrushes(next, await tipBlobs(tips));
      list = next;
      renderBrushes();
      return true;
    } catch (e) {
      deps.tell(`The brushes could not be stored (${(e as Error).message}).`);
      return false;
    }
  };
  /** Read the presets (another tab may have changed them); the first time ever, the engine's built-in set. */
  const load = (): Promise<void> =>
    (loading ??= (async () => {
      const raw = await deps.store?.brushes().catch(() => undefined);
      if (raw !== undefined) list = cleanBrushes(raw);
      else {
        const eng = await deps.engine();
        if (eng) {
          const r = await eng.presets();
          const hashes = r.tips.map((t) => t.key);
          const next = cleanBrushes(r.presets.map((p) => fromEngine(p, hashes)));
          if (!(await save(next, r.tips))) list = next; // (shown even when this tab cannot store them)
        }
      }
      if (!Object.keys(defaults).length) defaults = ((await (await deps.engine())?.defaultBrush()) ?? {}) as Brush;
      loading = null;
    })());

  // ---- the Brushes panel -------------------------------------------------------------------------------------------------------------

  const brushesEl = document.createElement("aside");
  brushesEl.className = "layers-panel brushes-panel";
  brushesEl.setAttribute("aria-label", "Brushes");
  brushesEl.dataset["testid"] = "brushes-panel";
  brushesEl.dataset["only"] = "paint";
  brushesEl.hidden = true;
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".abr,.json,application/json";
  fileInput.multiple = true;
  fileInput.hidden = true;
  fileInput.dataset["testid"] = "brushes-import-input";

  const groupKey = (p: BrushPreset): string => [p.group, ...p.folder].join(" / ");
  const renderBrushes = (): void => {
    if (brushesEl.hidden) return;
    const t = deps.tool();
    const current = t ? deps.preset(t) : "";
    const f = filter.toLowerCase();
    const shownList = f ? list.filter((p) => p.name.toLowerCase().includes(f) || groupKey(p).toLowerCase().includes(f)) : list;
    const groups = new Map<string, BrushPreset[]>();
    for (const p of shownList) groups.set(groupKey(p), [...(groups.get(groupKey(p)) ?? []), p]);
    const grid = deps.view() === "grid";
    const cell = (p: BrushPreset): string => `<li role="option" class="brush-cell" aria-selected="${p.id === current}" data-brush="${p.id}" title="${esc(p.name)}" aria-label="${esc(p.name)}"><canvas class="brush-thumb" width="40" height="40" aria-hidden="true"></canvas><span class="brush-size">${typeof p.brush["size"] === "number" ? Math.round(p.brush["size"]) : ""}</span></li>`;
    const row = (p: BrushPreset): string => grid ? cell(p) : `<li role="option" class="layer brush-row" aria-selected="${p.id === current}" data-brush="${p.id}" title="${esc(p.name)}"><canvas class="brush-thumb" width="32" height="32" aria-hidden="true"></canvas><span class="layer-name">${esc(p.name)}</span>${moreButton(`More actions for brush ${p.name}`, `data-brush-more="${p.id}"`)}</li>`;
    brushesEl.innerHTML = panelHtml({
      title: "Brushes",
      count: list.length,
      tools: `<button type="button" class="layer-btn" data-act="save" aria-label="Save the brush" title="Save the brush: the tool's brush as a new preset">${ICONS.save}</button><button type="button" class="layer-btn" data-act="import" aria-label="Import brushes" title="Import brushes: .abr files, or canvast brush files (.json)">${ICONS.arrowDownToLine}</button><button type="button" class="layer-btn" data-act="more" aria-haspopup="menu" aria-expanded="false" aria-label="More brush actions" title="Export all the brushes, or bring back the built-in ones">${ICONS.ellipsis}</button>`,
      sub: `<div class="brush-sub"><input type="search" class="brush-find" data-find placeholder="Find a brush" aria-label="Find a brush" value="${esc(filter)}"><button type="button" class="layer-btn" data-brush-view="grid" aria-pressed="${grid}" aria-label="Thumbnails" title="Thumbnails: the tips in a grid, with their sizes">${ICONS.layoutGrid}</button><button type="button" class="layer-btn" data-brush-view="list" aria-pressed="${!grid}" aria-label="List" title="List: the tips with their names">${ICONS.layoutList}</button></div>${t ? "" : `<p class="adj-note">Pick the Brush or the Eraser to use a preset.</p>`}`,
      body: [...groups].map(([g, ps]) => `<div class="brush-group" data-group="${esc(g)}"><div class="adj-group-head"><h4>${esc(g)}</h4>${moreButton(`More actions for the group ${g}`, `data-group-more="${esc(g)}"`)}</div><ul class="${grid ? "brush-grid" : "paint-layer-list"}" role="listbox" aria-label="${esc(g)}">${ps.map(row).join("")}</ul></div>`).join("") || `<p class="adj-note">${list.length ? "No brush has that name." : "No brushes yet."}</p>`,
    });
    brushesEl.append(fileInput);
    const ink = getComputedStyle(brushesEl).color;
    for (const c of brushesEl.querySelectorAll<HTMLCanvasElement>(".brush-thumb")) {
      const p = list.find((x) => x.id === c.closest<HTMLElement>("[data-brush]")!.dataset["brush"]);
      if (p) drawThumb(c, p.brush, ink);
    }
    brushesEl.querySelector<HTMLInputElement>("[data-find]")!.addEventListener("input", (e) => {
      filter = (e.target as HTMLInputElement).value;
      renderBrushes();
      const box = brushesEl.querySelector<HTMLInputElement>("[data-find]")!;
      box.focus();
      box.setSelectionRange(filter.length, filter.length);
    });
  };

  /** Mark the tool's preset in the list, without building it again. */
  const markCurrent = (): void => {
    const t = deps.tool();
    const current = t ? deps.preset(t) : "";
    for (const r of brushesEl.querySelectorAll<HTMLElement>("[data-brush]")) r.setAttribute("aria-selected", String(r.dataset["brush"] === current));
  };
  const pick = (p: BrushPreset): void => {
    const t = deps.tool();
    if (!t) return deps.tell("Pick the Brush or the Eraser to use a brush preset.");
    deps.setTool(t, { values: pickedValues(p, deps.values(t)), brush: pickedBrush(p.brush, deps.brush(t)), preset: p.id });
    markCurrent();
    updateSettings();
  };
  /** The tool's brush as it paints, without colour: what Save keeps. */
  const toolBrush = (t: ToolId): Brush => {
    const b = brushOf(t, deps.values(t), deps.brush(t), "#000000");
    delete b["color"];
    delete b["erase"];
    return b;
  };
  /** The bitmaps presets name, for a file: from the engine when it has them, else from storage. */
  const bitmapsOf = async (ps: readonly BrushPreset[]): Promise<TipBitmap[]> => {
    const want = new Map(ps.flatMap((p) => tipsOf(p.brush)).map((t) => [t.key, t]));
    const out: TipBitmap[] = [];
    for (const t of want.values()) {
      const b = await deps.store?.tip(t.key, t.w, t.h);
      if (b) out.push(b);
    }
    return out;
  };
  const exportJson = async (ps: readonly BrushPreset[], name: string): Promise<void> => {
    const tips: Record<string, { w: number; h: number; data: string }> = {};
    for (const t of await bitmapsOf(ps)) tips[t.key] = { w: t.w, h: t.h, data: b64(new Uint8Array(await (await deflate(tipBytes(t))).arrayBuffer())) };
    const file = { format: FILE_KIND, version: 1, presets: ps.map(({ name: n, group, folder, brush, captures }) => ({ name: n, group, folder, brush, captures })), tips };
    saveFile(`${name}.json`, new Blob([JSON.stringify(file)], { type: "application/json" }));
  };
  const exportAbr = async (ps: readonly BrushPreset[], name: string): Promise<void> => {
    const eng = await deps.engine();
    if (!eng) return deps.tell("The brush engine is not running, so .abr files cannot be written.");
    eng.putTips(await bitmapsOf(ps.filter((p) => tipsOf(p.brush).some((t) => !eng.hasTip(t.key)))));
    try {
      const bytes = await eng.writeAbr(ps.map((p) => ({ name: p.name, brush: p.brush })));
      saveFile(`${name}.abr`, new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
    } catch (e) {
      deps.tell(`The brushes could not be written as .abr (${(e as Error).message}).`);
    }
  };
  /** Presets from a canvast brush file, their bitmaps checked against their names. */
  const readJson = async (text: string): Promise<{ presets: BrushPreset[]; tips: TipBitmap[] }> => {
    const f = JSON.parse(text) as Record<string, unknown>;
    if (f["format"] !== FILE_KIND || !Array.isArray(f["presets"])) throw new Error("not a canvast brush file");
    const tips: TipBitmap[] = [];
    const raw = (f["tips"] && typeof f["tips"] === "object" ? f["tips"] : {}) as Record<string, { w?: unknown; h?: unknown; data?: unknown }>;
    for (const [key, t] of Object.entries(raw)) {
      const w = Number(t.w), h = Number(t.h);
      if (!(w > 0 && h > 0 && w * h <= 4096 * 4096) || typeof t.data !== "string") continue;
      const bytes = await inflate(new Blob([unb64(t.data) as BlobPart]), w * h * 2);
      if (bytes && (await hashOf(bytes)) === key) tips.push({ key, w, h, data: new Uint16Array(bytes.buffer, bytes.byteOffset, w * h) });
    }
    const have = new Set(tips.map((t) => t.key));
    const presets = cleanBrushes((f["presets"] as unknown[]).map((p) => ({ ...(p as object), id: newObjectId() }))).filter((p) => tipsOf(p.brush).every((t) => have.has(t.key)));
    return { presets, tips };
  };
  const importFiles = async (files: readonly File[]): Promise<void> => {
    await load();
    let added: BrushPreset[] = [];
    const tips: TipBitmap[] = [];
    const notes: string[] = [];
    for (const file of files) {
      try {
        if (file.size > MAX_IMPORT_BYTES) throw new Error("the file is too big");
        if (/\.json$/i.test(file.name) || file.type === "application/json") {
          const r = await readJson(await file.text());
          added = [...added, ...r.presets];
          tips.push(...r.tips);
        } else {
          const eng = await deps.engine();
          if (!eng) throw new Error("the brush engine is not running");
          const r = await eng.presets(new Uint8Array(await file.arrayBuffer()), stem(file.name));
          const hashes = r.tips.map((t) => t.key);
          added = [...added, ...cleanBrushes(r.presets.map((p) => fromEngine(p, hashes)))];
          tips.push(...r.tips);
          if (r.warnings.length) notes.push(`${file.name}: ${r.warnings.length} setting${r.warnings.length === 1 ? "" : "s"} could not be kept`);
        }
      } catch (e) {
        notes.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    const room = MAX_BRUSHES - list.length;
    if (added.length > room) notes.push(`only ${room} of ${added.length} brushes fit (at most ${MAX_BRUSHES})`);
    added = added.slice(0, Math.max(0, room));
    if (added.length && (await save([...list, ...added], tips))) deps.tell(`Imported ${added.length} brush${added.length === 1 ? "" : "es"}.${notes.length ? ` ${notes.join("; ")}.` : ""}`);
    else if (notes.length) deps.tell(`No brushes imported: ${notes.join("; ")}.`);
  };
  fileInput.addEventListener("change", () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    if (files.length) void importFiles(files);
  });

  brushesEl.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    if (el.closest("[data-close]")) return void toggle("brushes");
    const act = el.closest<HTMLElement>("[data-act]");
    if (act?.dataset["act"] === "import") return fileInput.click();
    if (act?.dataset["act"] === "save") {
      const t = deps.tool();
      if (!t) return deps.tell("Pick the Brush or the Eraser to save its brush.");
      const from = list.find((p) => p.id === deps.preset(t));
      return void promptDialog({ title: "Save the brush", lines: ["The tool's brush, as it is now, becomes a new preset in the group Saved."], value: from ? `${from.name} copy` : "Brush", confirmLabel: "Save" }).then(async (n) => {
        const name = n?.trim().slice(0, MAX_BRUSH_NAME);
        if (!name || list.length >= MAX_BRUSHES) return;
        const p: BrushPreset = { id: newObjectId(), name, group: "Saved", folder: [], brush: toolBrush(t), captures: { size: true, toolSettings: true } };
        if (await save([...list, p])) deps.setTool(t, { preset: p.id });
        markCurrent();
      });
    }
    if (act?.dataset["act"] === "more") {
      return openMoreMenu(act, [
        { id: "export-json", label: "Export all (canvast brushes)", hint: "Every setting and tip, for canvast", icon: ICONS.fileOutput, disabled: !list.length, run: () => void exportJson(list, "brushes") },
        { id: "export-abr", label: "Export all (.abr)", hint: "Tips and spacing, for other painting programs", icon: ICONS.fileOutput, disabled: !list.length, run: () => void exportAbr(list, "brushes") },
        { id: "builtin", label: "Add the built-in brushes", icon: ICONS.listRestart, run: () => void (async () => {
          const eng = await deps.engine();
          if (!eng) return;
          const r = await eng.presets();
          const hashes = r.tips.map((t) => t.key);
          await save([...list, ...cleanBrushes(r.presets.map((p) => fromEngine(p, hashes)))].slice(0, MAX_BRUSHES), r.tips);
        })() },
      ], "Brushes");
    }
    const more = el.closest<HTMLElement>("[data-brush-more]");
    if (more) {
      const p = list.find((x) => x.id === more.dataset["brushMore"]);
      if (!p) return;
      return openMoreMenu(more, [
        { id: "rename", label: "Rename", icon: ICONS.textCursorInput, run: () => void promptDialog({ title: "Rename the brush", lines: [], value: p.name, confirmLabel: "Rename" }).then((n) => {
          const name = n?.trim().slice(0, MAX_BRUSH_NAME);
          if (name) void save(list.map((x) => (x.id === p.id ? { ...x, name } : x)));
        }) },
        { id: "delete", label: "Delete", icon: ICONS.trash, danger: true, run: () => void save(list.filter((x) => x.id !== p.id)) },
      ], `Brush ${p.name}`);
    }
    const vb = el.closest<HTMLElement>("[data-brush-view]");
    if (vb) {
      deps.setView(vb.dataset["brushView"] as "list" | "grid");
      return renderBrushes();
    }
    const gmore = el.closest<HTMLElement>("[data-group-more]");
    if (gmore) {
      const g = gmore.dataset["groupMore"]!;
      const ps = list.filter((p) => groupKey(p) === g);
      return openMoreMenu(gmore, [
        { id: "export-json", label: "Export (canvast brushes)", icon: ICONS.fileOutput, run: () => void exportJson(ps, stem(g.replace(/ \/ /g, "-"))) },
        { id: "export-abr", label: "Export (.abr)", icon: ICONS.fileOutput, run: () => void exportAbr(ps, stem(g.replace(/ \/ /g, "-"))) },
        { id: "delete", label: "Delete the group", icon: ICONS.trash, danger: true, run: () => void confirmDialog({ title: `Delete the ${ps.length} brushes of “${g}”?`, lines: ["They are taken out of the library's brushes. This cannot be undone."], confirmLabel: "Delete" }).then((ok) => ok && void save(list.filter((p) => groupKey(p) !== g))) },
      ], `Group ${g}`);
    }
    const b = el.closest<HTMLElement>("[data-brush]");
    const p = b && list.find((x) => x.id === b.dataset["brush"]);
    if (p) pick(p);
  });

  // ---- the Brush Settings panel -----------------------------------------------------------------------------------------------------

  const settingsEl = document.createElement("aside");
  settingsEl.className = "layers-panel adjust-panel brush-settings-panel";
  settingsEl.setAttribute("aria-label", "Brush settings");
  settingsEl.dataset["testid"] = "brush-settings-panel";
  settingsEl.dataset["only"] = "paint";
  settingsEl.hidden = true;
  let builtFor: ToolId | null | undefined;
  const ALL = BRUSH_SECTIONS.flatMap((s) => s.items);

  /** The tool's brush as the panel shows it: its values and brush over the engine's defaults. */
  const effective = (t: ToolId): Brush => brushOf(t, deps.values(t), deps.brush(t), "#000000");
  const valueOf = (t: ToolId, s: BrushSetting): number | string | boolean | undefined => shown(s, effective(t)) ?? shown(s, defaults);
  const set = (t: ToolId, path: string, v: unknown): void => {
    if (isFlat(path)) deps.setTool(t, { values: { ...deps.values(t), [path]: typeof v === "number" ? v * flatScale(path) : (v as boolean) } });
    else deps.setTool(t, { brush: setPath(deps.brush(t), path, v) });
    updateSettings();
  };
  /** A dynamic's response curve: under its control, folded, shown while something controls it. */
  const curveRow = (s: BrushSetting): string => {
    const base = s.k.endsWith(".control") ? s.k.slice(0, -".control".length) : "";
    return base ? `<details class="bs-curve" data-curve-of="${esc(base)}"><summary>${esc(s.label.replace(/ control$/, ""))} curve</summary>${curveCanvas(`${s.label.replace(/ control$/, "")} curve`, "")}</details>` : "";
  };
  const curves = new Map<HTMLElement, { draw(): void }>();
  const curveOf = (t: ToolId, path: string): Array<[number, number]> => {
    const v = getPath(effective(t), path);
    return Array.isArray(v) && v.length >= 2 ? (v as Array<[number, number]>) : [[0, 0], [1, 1]];
  };
  /** What a tip or a texture can be: round, or a procedural pattern, then each bitmap of the presets. */
  const picksOf = (path: string): Array<{ label: string; value: unknown; key: string }> => [
    ...(path === "tip" ? [{ label: "Round", value: "round" as unknown, key: "round" }] : PATTERN_STYLES.map(([style, label]) => ({ label, value: { procedural: { ...(getPath(defaults, "texture.pattern.procedural") as object), style } } as unknown, key: style }))),
    ...presetBitmaps(list).map((b, i) => ({ label: `Picture ${i + 1} (${String(b["width"])} × ${String(b["height"])} px)`, value: { stored: b } as unknown, key: String(b["key"]) })),
  ];
  /** Which pick a tip or texture is (its bitmap's key, its pattern's style, or "round"). */
  const pickKey = (v: unknown): string => (typeof v === "string" ? v : String(getPath(v as Brush, "stored.key") ?? getPath(v as Brush, "procedural.style") ?? ""));
  const fillPicks = (t: ToolId, d: HTMLElement): void => {
    const box = d.querySelector(".bs-picks")!;
    const ink = getComputedStyle(d).color;
    box.innerHTML = picksOf(d.dataset["pick"]!).map((o, i) => `<button type="button" data-pick-i="${i}" data-key="${esc(o.key)}" aria-pressed="false" title="${esc(o.label)}" aria-label="${esc(o.label)}">${typeof o.value === "string" || getPath(o.value as Brush, "stored") ? `<canvas width="32" height="32" aria-hidden="true"></canvas>` : esc(o.label)}</button>`).join("");
    for (const c of box.querySelectorAll("canvas")) {
      const o = picksOf(d.dataset["pick"]!)[Number(c.parentElement!.dataset["pickI"])]!;
      drawThumb(c, typeof o.value === "string" ? {} : { tip: o.value }, ink);
    }
    markPick(t, d);
  };
  const markPick = (t: ToolId, d: HTMLElement): void => {
    const now = pickKey(getPath(effective(t), d.dataset["pick"]!) ?? getPath(defaults, d.dataset["pick"]!));
    for (const b of d.querySelectorAll<HTMLElement>("[data-key]")) b.setAttribute("aria-pressed", String(b.dataset["key"] === now));
  };
  const onOf = (t: ToolId, path: string): boolean => (getPath(effective(t), path) ?? getPath(defaults, path)) === true;

  const buildSettings = (): void => {
    if (settingsEl.hidden) return;
    const t = deps.tool();
    builtFor = t;
    settingsEl.innerHTML = panelHtml({
      title: "Brush settings",
      body: t
        ? BRUSH_SECTIONS.map((sec, i) => `<div class="adj-group" data-section="${i}"><div class="adj-group-head"><h4>${esc(sec.title)}</h4>${lockOf(sec) ? `<button type="button" class="adj-pin" data-lock="${esc(lockOf(sec)!)}" aria-pressed="false" aria-label="Keep ${esc(sec.title.toLowerCase())}" title="Keep these settings when another brush is picked">${ICONS.pin}</button>` : ""}${sec.on ? `<label class="pg-check"><input type="checkbox" data-on="${esc(sec.on)}" aria-label="${esc(sec.title)} on"></label>` : ""}</div>${sec.pick ? `<details class="bs-curve" data-pick="${sec.pick}"><summary>${sec.pick === "tip" ? "Choose a tip" : "Choose a pattern"}</summary><div class="bs-picks" role="group" aria-label="${sec.pick === "tip" ? "Tips" : "Patterns"}"></div></details>` : ""}${sec.items.map((s) => settingRow(s, valueOf(t, s) ?? s.def, `bs-${s.k}`) + curveRow(s)).join("")}</div>`).join("")
        : `<p class="adj-note">Pick the Brush or the Eraser to set its brush.</p>`,
    });
    if (!t) return;
    for (const r of settingsEl.querySelectorAll<HTMLElement>("[data-k]")) {
      const s = ALL.find((x) => x.k === r.dataset["k"])!;
      wireSettingRow(r, s, () => valueOf(t, s) ?? s.def, (v) => set(t, s.k, engineValue(s, v)));
    }
    for (const c of settingsEl.querySelectorAll<HTMLInputElement>("[data-on]")) c.addEventListener("change", () => set(t, c.dataset["on"]!, c.checked));
    curves.clear();
    for (const d of settingsEl.querySelectorAll<HTMLElement>("[data-curve-of]")) {
      const path = `${d.dataset["curveOf"]}.curve`;
      curves.set(d, wireCurve(d.querySelector("canvas")!, {
        points: () => curveOf(t, path).map(([x, y]) => [Math.round(x * 255), Math.round(y * 255)]),
        set: (pts) => set(t, path, pts.map(([x, y]) => [x / 255, y / 255])),
        input: () => {},
        commit: () => {},
      }));
      d.addEventListener("toggle", () => curves.get(d)?.draw());
    }
    for (const d of settingsEl.querySelectorAll<HTMLDetailsElement>("[data-pick]")) {
      const path = d.dataset["pick"]!;
      d.addEventListener("toggle", () => d.open && fillPicks(t, d));
      d.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pick-i]");
        const o = b && picksOf(path)[Number(b.dataset["pickI"])];
        if (o) set(t, path, o.value);
      });
    }
    for (const b of settingsEl.querySelectorAll<HTMLElement>("[data-lock]")) b.addEventListener("click", () => set(t, `locks.${b.dataset["lock"]}`, b.getAttribute("aria-pressed") !== "true"));
    updateSettings();
  };
  /** Show the tool's values in the built rows (a change from elsewhere: the options bar, a preset), without building them again. */
  const updateSettings = (): void => {
    const t = deps.tool();
    if (settingsEl.hidden || !t) return;
    if (t !== builtFor) return buildSettings();
    for (const r of settingsEl.querySelectorAll<HTMLElement>("[data-k]")) {
      const s = ALL.find((x) => x.k === r.dataset["k"])!;
      const v = valueOf(t, s);
      r.hidden = v === undefined; // (a setting the brush does not have: a texture's pattern style when its pattern is a picture)
      if (v === undefined) continue;
      for (const inp of r.querySelectorAll<HTMLInputElement>("input")) {
        if (inp.type === "checkbox") inp.checked = v === true;
        else if (document.activeElement !== inp) inp.value = String(v);
      }
      for (const b of r.querySelectorAll<HTMLElement>("[data-v]")) b.setAttribute("aria-pressed", String(b.dataset["v"] === v));
      const sel = r.querySelector("select");
      if (sel) sel.value = String(v);
    }
    for (const c of settingsEl.querySelectorAll<HTMLInputElement>("[data-on]")) {
      c.checked = onOf(t, c.dataset["on"]!);
      c.closest(".adj-group")!.classList.toggle("is-off", !c.checked);
    }
    for (const d of settingsEl.querySelectorAll<HTMLDetailsElement>("[data-pick]")) if (d.open) markPick(t, d);
    for (const [d, c] of curves) {
      const c0 = `${d.dataset["curveOf"]}.control`;
      d.hidden = (getPath(effective(t), c0) ?? getPath(defaults, c0) ?? "off") === "off";
      if ((d as HTMLDetailsElement).open) c.draw();
    }
    for (const b of settingsEl.querySelectorAll<HTMLElement>("[data-lock]")) b.setAttribute("aria-pressed", String(onOf(t, `locks.${b.dataset["lock"]}`)));
  };
  settingsEl.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-close]")) toggle("settings");
  });
  scrubNumbers(settingsEl);

  deps.dock(brushesEl, { id: "brushes", title: "Brushes", side: "left" });
  deps.dock(settingsEl, { id: "brush-settings", title: "Brush settings", side: "left" });

  const show = (): void => {
    const b = visible && open.brushes, s = visible && open.settings;
    if (brushesEl.hidden !== !b) {
      brushesEl.hidden = !b;
      if (b) void load().then(renderBrushes);
    }
    if (settingsEl.hidden !== !s) {
      settingsEl.hidden = !s;
      builtFor = undefined;
      if (s) void load().then(buildSettings);
    }
  };
  const toggle = (which: BrushPanelId): void => {
    open[which] = !open[which];
    show();
  };

  let lastTool: ToolId | null | undefined;
  return {
    toggle,
    isOpen: (which) => open[which],
    sync: (v) => {
      const t = deps.tool();
      if (v === visible && t === lastTool) return;
      const kind = (x: ToolId | null | undefined): boolean => !!x;
      if (kind(t) !== kind(lastTool)) renderBrushes(); // (the note that asks for a painting tool comes or goes)
      lastTool = t;
      visible = v;
      show();
      markCurrent();
      updateSettings();
    },
    changed: () => {
      markCurrent();
      updateSettings();
    },
    presets: async () => {
      await load();
      return list;
    },
    presetName: (t) => list.find((p) => p.id === deps.preset(t))?.name ?? "",
  };
}

/** A picture of a brush's tip: its preview bitmap, or a round tip drawn from its hardness and roundness. */
export function drawThumb(c: HTMLCanvasElement, b: Brush, ink: string): void {
  const g = c.getContext("2d");
  if (!g) return;
  const tip = getPath(b, "tip.stored") as { preview?: { width: number; height: number; data: string } } | undefined;
  const pv = tip?.preview;
  if (pv && pv.width > 0 && pv.height > 0) {
    const bytes = Uint8Array.from(atob(pv.data), (ch) => ch.charCodeAt(0));
    if (bytes.length !== pv.width * pv.height * 2) return;
    const img = g.createImageData(pv.width, pv.height);
    for (let i = 0; i < pv.width * pv.height; i++) img.data[i * 4 + 3] = bytes[i * 2 + 1]!;
    const tmp = document.createElement("canvas");
    tmp.width = pv.width;
    tmp.height = pv.height;
    const tg = tmp.getContext("2d")!;
    tg.putImageData(img, 0, 0);
    // (the ink is any CSS colour, oklch included: the canvas paints it where the tip has alpha)
    tg.globalCompositeOperation = "source-in";
    tg.fillStyle = ink;
    tg.fillRect(0, 0, pv.width, pv.height);
    const k = Math.min(c.width / pv.width, c.height / pv.height);
    g.drawImage(tmp, (c.width - pv.width * k) / 2, (c.height - pv.height * k) / 2, pv.width * k, pv.height * k);
    return;
  }
  const hard = Math.min(1, Math.max(0, Number(getPath(b, "hardness") ?? 1)));
  const round = Math.min(1, Math.max(0.05, Number(getPath(b, "roundness") ?? 1)));
  const angle = (Number(getPath(b, "angle") ?? 0) * Math.PI) / 180;
  const r = c.width / 2 - 2;
  g.save();
  g.translate(c.width / 2, c.height / 2);
  g.rotate(-angle);
  g.scale(1, round);
  const grad = g.createRadialGradient(0, 0, r * hard * 0.98, 0, 0, r);
  grad.addColorStop(0, ink);
  grad.addColorStop(1, "transparent");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
