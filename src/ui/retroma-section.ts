// Settings › Retroma: the theme's customisation. A Basics card with what most people change; each group of the rest (the demo's full list,
// ui/retroma-controls.ts) is a row that opens it in a dialog, so the page keeps a fixed size. Every control is a shared row (ui/setting-rows.ts),
// colours open the app's colour picker. Changes are kept as what differs from Retroma's defaults (settings key retroma.look).
import { mountSettings, type SettingValue } from "./setting-rows";
import { makeModal } from "./modal";
import { esc } from "./format";
import { TABS as TABS_ } from "./retroma-controls";
import { BASE, PRESETS as PRESETS_, accentFromHex, presetSettings } from "../theme/retroma/engine";
import { retromaChanges, retromaSettings } from "../theme/retroma/apply";
import type { Section, Setting } from "../gen/types";
import type { SettingsStore } from "../settings/settings";
import { importRetromaPresets } from "../theme/retroma/import";
import { confirmDialog } from "./confirm";
import type { SettingRow } from "./share-panel";

/** Theme presets kept with the workspace (saved styles of the kind "retroma"): listed, saved and added from Retroma's presets file. */
export interface ThemePresets {
  list(): Array<{ id: string; name: string; hex: string; changes: string }>;
  /** Asks for a name and keeps these changes as a preset; resolves when done (or cancelled). */
  save(changes: string, hex: string): Promise<void>;
  add(name: string, changes: string, hex: string): Promise<void>;
}

type Loose = Record<string, unknown>;
type Control = { t: string; k?: string; label?: string; min?: number; max?: number; step?: number; opts?: Array<[string, string]>; dropdown?: boolean; auto?: number | boolean };
type Group = { title: string; items: Control[]; note?: string };
const TABS = TABS_ as unknown as Array<[string, Group[]]>;
const PRESETS = PRESETS_ as unknown as Array<[string, string, unknown]>;

/** The settings that pick what a scoped key reads: the mode and state of the light, the heading level, the kind of callout or checkbox, the folder. */
const SCOPES = ["em", "es", "hl", "ct", "at", "fi"];
const segs = (S: Loose, k: string): string[] => k.split(".").map((s) => (s.startsWith("$") ? String(S[s.slice(1)]) : s));
/** A setting's value: "@@x" of the light's mode, "@x" of its mode and state, "a.$b.c" a path, else the setting itself. */
function getK(S: Loose, k: string): unknown {
  const at = (o: unknown, p: string[]): unknown => p.reduce<unknown>((x, s) => (x && typeof x === "object" ? (x as Loose)[s] : undefined), o);
  if (k.startsWith("@@")) return at(S, [String(S["em"]), k.slice(2)]);
  if (k.startsWith("@")) return at(S, [String(S["em"]), String(S["es"]), k.slice(1)]);
  if (k.includes(".")) return at(S, segs(S, k)) ?? "";
  return S[k];
}
function putK(S: Loose, k: string, v: unknown): void {
  const p = k.startsWith("@@") ? [String(S["em"]), k.slice(2)] : k.startsWith("@") ? [String(S["em"]), String(S["es"]), k.slice(1)] : k.includes(".") ? segs(S, k) : [k];
  let o = S;
  for (const s of p.slice(0, -1)) o = (o[s] ??= {}) as Loose;
  o[p[p.length - 1]!] = v;
}

/** A control of the demo's list as a shared row's setting, its default read from Retroma's (in the scope picked now). */
/** Settings the app keeps in one place for every theme (Settings › Appearance): not repeated here. */
const APP_OWNED = new Set(["mode", "dens", "motion", "zen", "grid"]);
/** The demo's fading of the bars while panning is left out: the app's Zen mode is the one way the bars fade. */
const LEFT_OUT_KEYS = new Set(["fadeOnPan", "fadeSpeed", "fadeOut", "fadeIn", "mat", "cCardCover"]); /* (and the picture mat: the owner removed it, pictures have no mat) */
/** Settings not shown here: the app's own, and those left out. */
const notHere = (k: string): boolean => APP_OWNED.has(k) || LEFT_OUT_KEYS.has(k);
/** Groups of the demo left out: Zen mode is the app's own (Settings › Appearance), and the note editor's groups (notes keep the app's own editor look in every theme). */
const LEFT_OUT = new Set(["Zen mode", "Editor", "Editor frame", "Each heading", "Headings", "Text", "Links and lists", "Blockquotes and callouts", "More text and pictures", "Code", "Checkboxes and tables"]); /* (and the note editor's groups: notes look as in Legacy, in every theme) */
const shownGroups = (groups: readonly Group[]): Group[] => groups.filter((g) => !LEFT_OUT.has(g.title) && g.items.some((c) => c.k && c.label && !notHere(c.k)));

function toSetting(c: Control, S: Loose): Setting | null {
  if (!c.k || !c.label || notHere(c.k)) return null;
  const scoped = { ...(JSON.parse(JSON.stringify(BASE)) as Loose), ...Object.fromEntries(SCOPES.map((s) => [s, S[s]])) };
  const def = getK(scoped, c.k);
  if (c.t === "range") return { t: "range", k: c.k, label: c.label, min: c.min!, max: c.max!, step: c.step!, def: typeof def === "number" ? def : c.min!, usual: [c.min!, c.max!] };
  if (c.t === "choice") return { t: "choice", k: c.k, label: c.label, opts: c.opts!, def: String(def ?? ""), ...(c.dropdown ? { dropdown: true as const } : {}) };
  if (c.t === "toggle") return { t: "toggle", k: c.k, label: c.label, def: !!def };
  if (c.t === "colour") return { t: "colour", k: c.k, label: c.label, def: "", auto: true };
  if (c.t === "select") return { t: "choice", k: c.k, label: c.label, opts: PRESETS.map(([n]) => [n, n] as [string, string]), def: String(def ?? ""), dropdown: true };
  return null;
}

const find = (k: string): Control | undefined => TABS.flatMap(([, groups]) => groups.flatMap((g) => g.items)).find((c) => c.k === k);
/** What the Basics card holds: the accent, the scheme, the keys' look and light, the font and corners, how the Library shows its items. */
const BASICS = ["hue", "chroma", "accentL", "scheme", "btn", "@@angle", "corner", "font", "libItems", "paneOut", "paneIn", "cf", "cfDark", "lDark"];

export function mountRetromaSection(host: HTMLElement, settings: SettingsStore, openAppearance: () => void, rowHtml: SettingRow, presets?: ThemePresets): void {
  let S = retromaSettings(settings.get("retroma.look"));
  const save = (): void => void settings.set("retroma.look", retromaChanges(S));
  const builds: Array<() => void> = [];
  const get = (k: string): SettingValue => {
    if (k === "preset") return String(S["preset"] ?? "");
    if (k === "hex") return String(S["hex"] ?? "#8a5cf5");
    const v = getK(S, k);
    return typeof v === "number" || typeof v === "boolean" ? v : String(v ?? "");
  };
  const set = (k: string, v: SettingValue): void => {
    if (k === "preset" && String(v).startsWith("saved:")) {
      const saved = presets?.list().find((x) => `saved:${x.id}` === String(v));
      if (!saved) return;
      const keep = Object.fromEntries(SCOPES.map((s) => [s, S[s]]));
      S = { ...retromaSettings(saved.changes), ...keep, preset: String(v) };
      save();
      for (const b of builds) b();
      return;
    }
    if (k === "preset") {
      const p = presetSettings(String(v));
      if (!p) return;
      const keep = Object.fromEntries(SCOPES.map((s) => [s, S[s]]));
      S = { ...p, ...keep, preset: String(v) };
      save();
      for (const b of builds) b();
      return;
    }
    if (k === "hex") Object.assign(S, accentFromHex(String(v)));
    else {
      const was = getK(JSON.parse(JSON.stringify(BASE)) as Loose, k.replace(/\$\w+/g, (m) => String(S[m.slice(1)])));
      putK(S, k, typeof was === "number" && typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v);
    }
    S["preset"] = "";
    save();
    if (SCOPES.includes(k)) for (const b of builds) b();
  };
  const reset = (items: readonly Setting[]): void => {
    for (const s of items) {
      if (s.k === "preset") continue;
      if (s.k === "hex") { Object.assign(S, accentFromHex("#8a5cf5")); continue; }
      putK(S, s.k, s.t === "colour" ? "" : s.def);
    }
    save();
    for (const b of builds) b();
  };
  const presetNames = (): Array<[string, string]> => [...PRESETS.map(([n]) => [n, n] as [string, string]), ...(presets?.list() ?? []).map((p) => [`saved:${p.id}`, p.name] as [string, string])];
  const presetRow = (): Setting => ({ t: "choice", k: "preset", label: "Preset", opts: [["", "Your own"], ...presetNames()], def: "", dropdown: true });
  const accentRow: Setting = { t: "colour", k: "hex", label: "Accent colour", def: "#8a5cf5" };
  host.innerHTML = `
    <div class="set-card rt-basics"><h3>Basics</h3><p class="set-help">A preset, your accent colour and the look of keys and corners. Light or dark, Density, Zen mode, Animation and the canvas pattern are in <button type="button" class="set-link" data-rt-appearance>Appearance</button>, for every theme.</p><div class="rt-rows" data-rt-basics></div>
      <div class="storage-actions"><button type="button" data-rt-save>Save as preset…</button><button type="button" data-rt-import>Import Retroma presets…</button><button type="button" data-rt-reset-all data-testid="retroma-reset-all">Reset all of Retroma…</button><input type="file" accept=".json,application/json" hidden data-rt-file></div><p class="set-help" data-rt-note role="status"></p></div>
    ${TABS.map(([name, groups]) => {
      const shown = shownGroups(groups);
      return shown.length ? `<div class="set-card rt-advanced"><h3 class="rt-card-head"><span>${esc(name)} <span class="set-help">Advanced</span></span><button type="button" class="set-reset" data-rt-reset-tab="${esc(name)}" aria-label="Reset every ${esc(name)} setting of Retroma">Reset</button></h3>${shown.map((g) => rowHtml({ label: esc(g.title.replace(/<[^>]*>/g, "")), help: g.note ? esc(g.note) : "", control: `<button type="button" class="rt-open" data-rt-group="${esc(name)}|${esc(g.title)}">Change…</button>` })).join("")}</div>` : "";
    }).join("")}`;
  const basics = mountSettings(host.querySelector<HTMLElement>("[data-rt-basics]")!, {
    sections: () => [{ title: "Retroma", items: [presetRow(), accentRow, ...BASICS.map((k) => find(k)).flatMap((c) => (c ? [toSetting(c, S)!] : []))] } as Section],
    get, set, reset, idPrefix: "rt-basic-",
  });
  builds.push(() => basics.build());
  basics.build();
  host.querySelector("[data-rt-appearance]")!.addEventListener("click", openAppearance);
  const note = host.querySelector<HTMLElement>("[data-rt-note]")!;
  const saveBtn = host.querySelector<HTMLButtonElement>("[data-rt-save]")!, importBtn = host.querySelector<HTMLButtonElement>("[data-rt-import]")!;
  saveBtn.hidden = importBtn.hidden = !presets;
  saveBtn.addEventListener("click", () => void presets?.save(retromaChanges(S), String(S["hex"] ?? "#8a5cf5")).then(() => basics.build()));
  importBtn.addEventListener("click", () => host.querySelector<HTMLInputElement>("[data-rt-file]")!.click());
  host.querySelector<HTMLInputElement>("[data-rt-file]")!.addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = "";
    if (!f || !presets) return;
    try {
      const found = importRetromaPresets(JSON.parse(await f.text()));
      for (const p of found) await presets.add(p.name, retromaChanges(retromaSettings(JSON.stringify(p.over))), p.hex);
      note.textContent = found.length ? `${found.length} ${found.length === 1 ? "preset" : "presets"} added to the Preset list.` : "That file holds no Retroma presets.";
      basics.build();
    } catch {
      note.textContent = "That file is not a Style Manager presets file.";
    }
  });
  /** Every setting of these groups back to Retroma's own, in every light mode and state, heading level, kind and folder it can point at. */
  const resetGroups = (groups: readonly Group[]): void => {
    const fresh = JSON.parse(JSON.stringify(BASE)) as Loose;
    const copy = (v: unknown): unknown => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    const branch = (o: Loose, k: string): Loose => (o[k] && typeof o[k] === "object" ? (o[k] as Loose) : (o[k] = {}) as Loose);
    for (const k of new Set(groups.flatMap((g) => g.items.flatMap((c) => (c.k && !notHere(c.k) ? [c.k] : []))))) {
      if (k.startsWith("@@")) {
        for (const m of ["lt", "dk"]) branch(S, m)[k.slice(2)] = copy((fresh[m] as Loose)[k.slice(2)]);
      } else if (k.startsWith("@")) {
        for (const m of ["lt", "dk"]) for (const [st, v] of Object.entries(fresh[m] as Loose)) if (v && typeof v === "object") branch(branch(S, m), st)[k.slice(1)] = copy((v as Loose)[k.slice(1)]);
      } else {
        const root = k.split(".")[0]!;
        if (root in fresh) S[root] = copy(fresh[root]);
        else delete S[root];
      }
    }
    S["preset"] = "";
    save();
    for (const b of builds) b();
  };
  host.querySelector("[data-rt-reset-all]")!.addEventListener("click", () => void confirmDialog({
    title: "Reset all of Retroma?",
    lines: ["Every Retroma setting, the Basics and every Advanced group, goes back to Retroma's own. Your saved presets are kept."],
    confirmLabel: "Reset all",
  }).then((yes) => {
    if (!yes) return;
    const keep = Object.fromEntries(SCOPES.map((sc) => [sc, S[sc]]));
    S = { ...retromaSettings(""), ...keep, preset: "" };
    save();
    for (const b of builds) b();
    note.textContent = "Retroma is back to its own settings.";
  }));
  host.addEventListener("click", (e) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>("[data-rt-reset-tab]");
    if (r) {
      const tab = TABS.find(([n]) => n === r.dataset["rtResetTab"]);
      if (tab) resetGroups(shownGroups(tab[1]));
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-rt-group]");
    if (!b) return;
    const [tabName, title] = b.dataset["rtGroup"]!.split("|") as [string, string];
    const group = (TABS.find(([n]) => n === tabName)?.[1] ?? []).find((g) => g.title === title);
    if (group) openGroup(group);
  });
  function openGroup(g: Group): void {
    const titleId = "rt-dlg-title";
    const plain = g.title.replace(/<[^>]*>/g, "");
    const dlg = makeModal({ className: "confirm rt-dialog", testid: "retroma-dialog", titleId, html: `<h2 id="${titleId}">${esc(plain)}</h2>${g.note ? `<p class="set-help">${esc(g.note)}</p>` : ""}<div class="rt-rows" data-rt-rows></div><div class="confirm-actions"><button type="button" class="is-primary" value="done" data-testid="retroma-done">Done</button></div>` });
    const rows = mountSettings(dlg.querySelector<HTMLElement>("[data-rt-rows]")!, {
      sections: () => [{ title: plain, items: g.items.flatMap((c) => { const s = toSetting(c, S); return s ? [s] : []; }) } as Section],
      get, set, reset, idPrefix: "rt-adv-",
    });
    const rebuild = (): void => rows.build();
    rows.build();
    builds.push(rebuild);
    const close = (): void => { builds.splice(builds.indexOf(rebuild), 1); dlg.close(); dlg.remove(); };
    dlg.querySelector("[data-testid=retroma-done]")!.addEventListener("click", close);
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    dlg.showModal();
  }
  // (a change made elsewhere, another tab or a reset of the whole setting: read again)
  settings.subscribe((key) => {
    if (key !== "retroma.look") return;
    const fresh = retromaSettings(settings.get("retroma.look"));
    if (retromaChanges(fresh) === retromaChanges(S)) return;
    S = { ...fresh, ...Object.fromEntries(SCOPES.map((s) => [s, S[s]])) };
    for (const b of builds) b();
  });
}
