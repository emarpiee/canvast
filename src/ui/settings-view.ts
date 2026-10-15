import type { SettingKey, SettingValue, SettingsStore } from "../settings/settings";
import { SETTINGS } from "../settings/settings";
import { FIXED_SHORTCUTS, TOOL_KEY_SETTING, TOOL_NAME, TOOL_ORDER, toolKeys, toolUsing } from "../settings/shortcuts";
import { esc } from "./format";

/**
 * The Settings view (ADR 0048, engineering plan §14.40): a tabbed page, one of the three top-level views. Every row is one declared
 * setting (settings/settings.ts): its label, a control that fits its type, where it applies (scope), and a reset to the default.
 * Rows read and write the same store the toolbars use, so a change made here shows there and the other way round.
 */
type Control =
  | { kind: "toggle" }
  | { kind: "range"; min: number; max: number; step: number; unit?: string }
  | { kind: "select"; options: ReadonlyArray<[value: string, label: string]> }
  | { kind: "colour" };

interface Row {
  readonly key: SettingKey;
  readonly label: string;
  readonly help?: string;
  readonly control: Control;
}

interface Tab {
  readonly id: string;
  readonly label: string;
  readonly rows?: readonly Row[];
}

const SCOPE_LABEL = { device: "This device", workspace: "This workspace", board: "This board" } as const;

export const SETTINGS_TABS: readonly Tab[] = [
  {
    id: "drawing",
    label: "Drawing and selection",
    rows: [
      { key: "pen.kind", label: "Pen", help: "The pen new strokes are drawn with.", control: { kind: "select", options: [["fine", "Fine"], ["pencil", "Pencil"], ["ink", "Ink"], ["marker", "Marker"]] } },
      { key: "pen.color", label: "Pen colour", control: { kind: "colour" } },
      { key: "pen.widthPx", label: "Pen width", help: "On screen, in pixels, when you draw.", control: { kind: "range", min: 0.5, max: 128, step: 0.5, unit: "px" } },
      { key: "pen.followZoom", label: "Width follows zoom", help: "Keep the pen's width in the world when you zoom, instead of on the screen.", control: { kind: "toggle" } },
      { key: "pen.stabilizer.on", label: "Stabilizer", help: "Smooth the line while you draw.", control: { kind: "toggle" } },
      { key: "pen.stabilizer.strength", label: "Stabilizer strength", control: { kind: "range", min: 0, max: 100, step: 1, unit: "%" } },
      { key: "lasso.filter", label: "Lasso takes", control: { kind: "select", options: [["strokes", "Strokes only"], ["all", "Everything it contains"]] } },
      { key: "select.ignoreFilling", label: "Ignore filling objects", help: "A click on an image or a text's empty area selects what is behind it.", control: { kind: "toggle" } },
      { key: "select.alignBox", label: "Align to the selection box", help: "Align and distribute against the selection's box, not each item's own bounds.", control: { kind: "toggle" } },
      { key: "snap.enabled", label: "Snap and guides", help: "A moving selection snaps to the edges and centres of other objects.", control: { kind: "toggle" } },
      { key: "eraser.diameterPx", label: "Eraser size", control: { kind: "range", min: 4, max: 128, step: 1, unit: "px" } },
      { key: "eraser.wholeGroups", label: "Eraser takes whole groups", control: { kind: "toggle" } },
    ],
  },
  {
    id: "media",
    label: "Media and playback",
    rows: [
      { key: "media.volume", label: "Volume", help: "Shared by every player.", control: { kind: "range", min: 0, max: 100, step: 1, unit: "%" } },
      { key: "media.step.video", label: "Video step", help: "Seconds the step buttons move a video.", control: { kind: "range", min: 0.5, max: 60, step: 0.5, unit: "s" } },
      { key: "media.step.audio", label: "Audio step", help: "Seconds the step buttons move an audio file.", control: { kind: "range", min: 0.5, max: 60, step: 0.5, unit: "s" } },
      { key: "media.step.gif", label: "GIF step", help: "Frames the step buttons move an animated GIF.", control: { kind: "range", min: 1, max: 100, step: 1, unit: "frames" } },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    rows: [
      { key: "quality.auto", label: "Adaptive quality", help: "Lower the canvas resolution when frames are slow.", control: { kind: "toggle" } },
      { key: "ui.fps", label: "Frame rate counter", help: "Show a live frames-per-second readout.", control: { kind: "toggle" } },
    ],
  },
  {
    id: "appearance",
    label: "Appearance",
    rows: [
      { key: "ui.theme", label: "Theme", help: "System follows your operating system.", control: { kind: "select", options: [["system", "System"], ["light", "Light"], ["dark", "Dark"]] } },
      { key: "ui.textScale", label: "Interface size", help: "Scales the toolbars, panels and views (not the canvas).", control: { kind: "select", options: [["90", "90%"], ["100", "100%"], ["115", "115%"], ["130", "130%"], ["150", "150%"]] } },
      { key: "ui.contrast", label: "Contrast", help: "High contrast: stronger text and borders in the interface.", control: { kind: "select", options: [["normal", "Normal"], ["high", "High"]] } },
      { key: "ui.motion", label: "Motion", help: "System follows your operating system's reduce-motion setting.", control: { kind: "select", options: [["system", "System"], ["reduce", "Reduce"], ["full", "Full"]] } },
    ],
  },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "storage", label: "Storage" },
  { id: "privacy", label: "Privacy" },
];

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

function controlHtml(row: Row, id: string): string {
  const c = row.control;
  // The control is named by the label alone; the help text describes it.
  const a = `aria-labelledby="${id}-l"${row.help ? ` aria-describedby="${id}-h"` : ""}`;
  if (c.kind === "toggle") return `<input type="checkbox" id="${id}" data-set="${row.key}" ${a}>`;
  if (c.kind === "colour") return `<input type="color" id="${id}" data-set="${row.key}" ${a}>`;
  if (c.kind === "select") return `<select id="${id}" data-set="${row.key}" ${a}>${c.options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>`;
  return `<input type="range" id="${id}" data-set="${row.key}" min="${c.min}" max="${c.max}" step="${c.step}" ${a}><output for="${id}"></output>`;
}

/** Mount the view into `root`; returns what main needs to show and hide it. */
export function mountSettingsView(root: HTMLElement, settings: SettingsStore, onClose: () => void): { show(tab?: string): void; hide(): void } {
  const tabsHtml = SETTINGS_TABS.map((t) => `<button type="button" role="tab" id="set-tab-${t.id}" aria-controls="set-panel-${t.id}" data-tab="${t.id}">${esc(t.label)}</button>`).join("");
  const panelsHtml = SETTINGS_TABS.map((t) => {
    const body = t.rows
      ? t.rows
          .map((r) => {
            const id = `set-${r.key.replace(/\./g, "-")}`;
            const scope = SCOPE_LABEL[SETTINGS[r.key].scope];
            return `<div class="set-row" data-row="${r.key}"><label for="${id}"><span class="set-label" id="${id}-l">${esc(r.label)}</span>${r.help ? `<span class="set-help" id="${id}-h">${esc(r.help)}</span>` : ""}</label>
              <div class="set-control">${controlHtml(r, id)}</div><span class="set-scope" title="Where this setting is kept">${scope}</span>
              <button type="button" class="set-reset" data-reset="${r.key}" aria-label="Reset ${esc(r.label)} to its default">Reset</button></div>`;
          })
          .join("")
      : t.id === "shortcuts"
        ? `<div class="set-info set-keys"><p>Tool keys are a single letter and work on the canvas. Press <strong>Change</strong>, then the new letter; Escape cancels.</p>
           <div data-tool-keys></div><p class="set-note" data-key-note role="status"></p><h3>Fixed shortcuts</h3>${FIXED_SHORTCUTS.map((g) => `<h4>${esc(g.group)}</h4><dl>${g.items.map((i) => `<dt><kbd>${esc(i.keys)}</kbd></dt><dd>${esc(i.does)}</dd>`).join("")}</dl>`).join("")}</div>`
      : t.id === "storage"
        ? `<div class="set-info" data-storage><p>Your canvases are kept in this browser's storage, on this device.</p><dl><dt>Used</dt><dd data-used>…</dd><dt>Available</dt><dd data-quota>…</dd><dt>Protected from clearing</dt><dd data-persisted>…</dd></dl>
           <p><strong>Browser storage is not a backup.</strong> Clearing site data, or the browser's own clean-up, removes it. Use an export from the workspace menu to keep a copy.</p></div>`
        : `<div class="set-info"><p>canvast works entirely on this device. It makes no network requests: the page is one file and its security policy refuses every connection.</p>
           <p>Nothing you draw, import or write leaves this browser unless you export it yourself.</p><p>Collaboration is not enabled.</p></div>`;
    return `<section role="tabpanel" id="set-panel-${t.id}" aria-labelledby="set-tab-${t.id}" data-panel="${t.id}" hidden><h2>${esc(t.label)}</h2>${body}</section>`;
  }).join("");
  root.innerHTML = `<div class="set-head"><h1 class="set-title">Settings</h1><button type="button" class="set-done" data-done>Back to canvas</button></div>
    <div class="set-body"><div class="set-tabs" role="tablist" aria-label="Settings" aria-orientation="vertical">${tabsHtml}</div><div class="set-panels">${panelsHtml}</div></div>`;

  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panels = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
  let current = "drawing";
  const select = (id: string, focus = false): void => {
    current = id;
    for (const t of tabs) {
      const on = t.dataset["tab"] === id;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    }
    for (const p of panels) p.hidden = p.dataset["panel"] !== id;
    if (id === "storage") void storage();
  };

  const storage = async (): Promise<void> => {
    const set = (sel: string, text: string): void => {
      const el = root.querySelector<HTMLElement>(sel);
      if (el) el.textContent = text;
    };
    const mb = (n: number | undefined): string => (n === undefined ? "unknown" : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
    try {
      const est = await navigator.storage?.estimate?.();
      set("[data-used]", mb(est?.usage));
      set("[data-quota]", mb(est?.quota));
      const persisted = await navigator.storage?.persisted?.();
      set("[data-persisted]", persisted === undefined ? "unknown" : persisted ? "Yes" : "No (the browser may clear it when space is short)");
    } catch {
      set("[data-used]", "unknown");
      set("[data-quota]", "unknown");
      set("[data-persisted]", "unknown");
    }
  };

  /** The tool whose key is being changed, waiting for a letter. */
  let capturing: (typeof TOOL_ORDER)[number] | null = null;
  const renderKeys = (): void => {
    const host = root.querySelector<HTMLElement>("[data-tool-keys]");
    if (!host) return;
    const keys = toolKeys(settings);
    host.innerHTML = TOOL_ORDER.map((t) => {
      const def = SETTINGS[TOOL_KEY_SETTING[t]].default;
      return `<div class="set-row set-keyrow"><span class="set-label">${esc(TOOL_NAME[t])}</span>
        <div class="set-control"><kbd class="set-key">${capturing === t ? "press a letter…" : esc(keys[t].toUpperCase())}</kbd><button type="button" class="set-reset" data-change-key="${t}" aria-label="Change the key for ${esc(TOOL_NAME[t])}">Change</button></div>
        <span class="set-scope">This device</span><button type="button" class="set-reset" data-reset="${TOOL_KEY_SETTING[t]}" aria-label="Reset the key for ${esc(TOOL_NAME[t])} to its default"${keys[t] === def ? " disabled" : ""}>Reset</button></div>`;
    }).join("");
  };
  const keyNote = (text: string): void => {
    const n = root.querySelector<HTMLElement>("[data-key-note]");
    if (n) n.textContent = text;
  };
  const all = SETTINGS_TABS.flatMap((t) => t.rows ?? []);
  /** Show the stored values in the controls (never while one is being typed into: only called on a change). */
  const refresh = (): void => {
    renderKeys();
    for (const r of all) {
      const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-set="${r.key}"]`);
      if (!el) continue;
      const v = settings.get(r.key) as SettingValue<typeof r.key>;
      if (r.control.kind === "toggle") (el as HTMLInputElement).checked = v === true;
      else el.value = String(v);
      const out = el.parentElement?.querySelector("output");
      if (out && r.control.kind === "range") out.textContent = `${fmt(Number(v))} ${r.control.unit ?? ""}`.trim();
      const reset = root.querySelector<HTMLButtonElement>(`[data-reset="${r.key}"]`);
      if (reset) reset.disabled = v === SETTINGS[r.key].default;
    }
  };

  root.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    const key = t.dataset?.["set"] as SettingKey | undefined;
    if (!key) return;
    const row = all.find((r) => r.key === key)!;
    if (row.control.kind === "range") {
      const out = t.parentElement?.querySelector("output");
      if (out) out.textContent = `${fmt(Number(t.value))} ${row.control.unit ?? ""}`.trim();
    }
  });
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const key = t.dataset?.["set"] as SettingKey | undefined;
    if (!key) return;
    const row = all.find((r) => r.key === key)!;
    const value = row.control.kind === "toggle" ? (t as HTMLInputElement).checked : row.control.kind === "range" ? Number(t.value) : t.value;
    // A value the setting refuses puts the control back to what is stored.
    if (!settings.set(key, value as never)) refresh();
  });
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>("[data-tab]");
    if (tab) return select(tab.dataset["tab"]!);
    const change = t.closest<HTMLElement>("[data-change-key]");
    if (change) {
      capturing = change.dataset["changeKey"] as (typeof TOOL_ORDER)[number];
      keyNote("");
      renderKeys();
      root.querySelector<HTMLElement>(`[data-change-key="${capturing}"]`)?.focus();
      return;
    }
    const reset = t.closest<HTMLElement>("[data-reset]");
    if (reset) return settings.reset(reset.dataset["reset"] as SettingKey);
    if (t.closest("[data-done]")) onClose();
  });
  root.addEventListener("keydown", (e) => {
    if (capturing) {
      // Any key is for the key being chosen: a letter sets it, Escape cancels, everything else is refused with a reason.
      const tool = capturing;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Tab" || e.key === "Shift") return;
      capturing = null;
      const letter = e.key.length === 1 ? e.key.toLowerCase() : "";
      if (e.key === "Escape") keyNote("");
      else if (!/^[a-z]$/.test(letter) || e.ctrlKey || e.metaKey || e.altKey) keyNote("A tool key is one plain letter, a to z.");
      else {
        const other = toolUsing(settings, letter, tool);
        if (other) keyNote(`${letter.toUpperCase()} is already the key for ${TOOL_NAME[other]}. Change that one first.`);
        else {
          settings.set(TOOL_KEY_SETTING[tool], letter);
          keyNote(`${TOOL_NAME[tool]} is now ${letter.toUpperCase()}.`);
        }
      }
      renderKeys();
      root.querySelector<HTMLElement>(`[data-change-key="${tool}"]`)?.focus();
      return;
    }
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (tab && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End")) {
      const i = tabs.indexOf(tab as HTMLButtonElement);
      const n = tabs.length;
      const next = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      select(tabs[next]!.dataset["tab"]!, true);
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  });
  settings.subscribe(refresh);
  select(current);
  refresh();
  return {
    show(tab?: string) {
      root.hidden = false;
      refresh();
      select(tab && tabs.some((t) => t.dataset["tab"] === tab) ? tab : current);
      root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    },
    hide() {
      root.hidden = true;
    },
  };
}
