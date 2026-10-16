import type { SettingKey, SettingValue, SettingsStore } from "../settings/settings";
import { openColourPopover } from "./colour-popover";
import { swatchBackground } from "../render/ink";
import { NAME_STYLES } from "../app/screenshot";
import { SETTINGS } from "../settings/settings";
import { FIXED_SHORTCUTS, KEY_ROWS, keyOwner } from "../settings/shortcuts";
import { esc } from "./format";
import { ICONS } from "./icons";

/**
 * The Settings view (ADR 0048, engineering plan §14.40): a tabbed page, one of the three top-level views. Every row is one declared
 * setting (settings/settings.ts): its label, a control that fits its type, where it applies (scope), and a reset to the default.
 * Rows read and write the same store the toolbars use, so a change made here shows there and the other way round.
 */
type Control =
  | { kind: "toggle" }
  | { kind: "range"; min: number; max: number; step: number; unit?: string; /** A hue slider (rainbow track) with named presets, applied while dragging. */ hue?: ReadonlyArray<[name: string, degrees: number]>; /** Applied while dragging, not on release. */ live?: boolean }
  | { kind: "select"; options: ReadonlyArray<[value: string, label: string]> }
  | { kind: "colour" }
  | { kind: "text"; max: number; placeholder?: string };

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

/** Where a card of rows begins: a row named here starts a new card, titled so, and the rows after it stay in that card. A tab with none is one card. */
const CARD_STARTS: Partial<Record<SettingKey, string>> = {
  "pen.kind": "Drawing",
  "lasso.filter": "Selecting and arranging",
  "eraser.diameterPx": "Eraser",
  "assets.edgeWidth": "The asset viewer",
  "media.volume": "Players",
  "frame.format": "Extracted frames",
  "shot.format": "The picture",
  "shot.folder": "Where it goes and its name",
  "shot.tagShot": "Tags",
  "ui.theme": "Colour",
  "ui.info": "Canvas and readout",
  "ui.density": "Size and comfort",
  "ui.zen": "Focus",
  "quality.auto": "Drawing quality",
  "ui.motion": "Animation",
};
/** Rows into cards (a title on a card only when the tab has more than one). */
function cardsOf(rows: readonly Row[]): Array<{ title: string; rows: Row[] }> {
  const cards: Array<{ title: string; rows: Row[] }> = [];
  for (const r of rows) {
    const start = CARD_STARTS[r.key];
    if (start !== undefined || cards.length === 0) cards.push({ title: start ?? "", rows: [] });
    cards[cards.length - 1]!.rows.push(r);
  }
  return cards.length > 1 ? cards : cards.map((c) => ({ ...c, title: "" }));
}

/** The tabs in the sidebar, in groups. */
const TAB_GROUPS: ReadonlyArray<readonly [title: string, ids: readonly string[]]> = [
  ["Working", ["drawing", "navigation", "shortcuts"]],
  ["Media", ["media", "screenshot"]],
  ["Interface", ["appearance", "performance"]],
  ["App", ["storage", "privacy", "collaboration", "develop"]],
];

const SCOPE_LABEL = { device: "This device", workspace: "This workspace", board: "This board" } as const;

export const SETTINGS_TABS: readonly Tab[] = [
  {
    id: "drawing",
    label: "Drawing and selection",
    rows: [
      { key: "pen.kind", label: "Pen", help: "The pen new strokes are drawn with.", control: { kind: "select", options: [["fine", "Fine"], ["pencil", "Pencil"], ["ink", "Ink"], ["marker", "Marker"]] } },
      { key: "pen.color", label: "Pen colour", help: "Opens the colour picker. The colours you picked lately are in the toolbar.", control: { kind: "colour" } },
      { key: "colour.model", label: "Colour picker model", help: "OKHSL and OKHSV keep every slider inside the colours a screen can show; OKHCL sets lightness and chroma as OKLab does. All three are even to the eye: the same step looks like the same change of colour.", control: { kind: "select", options: [["okhsv", "OKHSV (hue, saturation, value)"], ["okhsl", "OKHSL (hue, saturation, lightness)"], ["okhcl", "OKHCL (hue, chroma, lightness)"]] } },
      { key: "colour.view", label: "Colour picker layout", help: "Ring and box; a plane with a hue bar; sliders; or the ring with sliders under it.", control: { kind: "select", options: [["wheel", "Ring and box"], ["plane", "Plane and bar"], ["sliders", "Sliders"], ["mixer", "Ring and sliders"]] } },
      { key: "colour.format", label: "Colour picker text", help: "How the colour is written in the picker's text field. Any of them can be typed or pasted.", control: { kind: "select", options: [["hex", "Hex (#2563eb)"], ["rgb", "RGB (rgb(37 99 235))"], ["oklch", "OKLCH (oklch(0.55 0.19 262))"]] } },
      { key: "pen.widthPx", label: "Pen width", help: "On screen, in pixels, when you draw.", control: { kind: "range", min: 0.5, max: 128, step: 0.5, unit: "px" } },
      { key: "pen.followZoom", label: "Width follows zoom", help: "Keep the pen's width in the world when you zoom, instead of on the screen.", control: { kind: "toggle" } },
      { key: "pen.stabilizer.on", label: "Stabilizer", help: "Smooth the line while you draw.", control: { kind: "toggle" } },
      { key: "pen.stabilizer.strength", label: "Stabilizer strength", control: { kind: "range", min: 0, max: 100, step: 1, unit: "%" } },
      { key: "lasso.filter", label: "Lasso takes", control: { kind: "select", options: [["strokes", "Strokes only"], ["all", "Everything it contains"]] } },
      { key: "select.ignoreFilling", label: "Ignore filling objects", help: "A click on an image or a text's empty area selects what is behind it.", control: { kind: "toggle" } },
      { key: "select.alignBox", label: "Align to the selection box", help: "Align and distribute against the selection's box, not each item's own bounds.", control: { kind: "toggle" } },
      { key: "arrange.gap", label: "Space between items in a grid", help: "How far apart Arrange in a grid puts the items, as a part of the largest item. Also in the Arrange menu.", control: { kind: "select", options: [["none", "None"], ["tight", "Tight"], ["normal", "Normal"], ["wide", "Wide"], ["wider", "Wider"]] } },
      { key: "snap.enabled", label: "Snap and guides", help: "A moving selection snaps to the edges and centres of other objects.", control: { kind: "toggle" } },
      { key: "eraser.diameterPx", label: "Eraser size", control: { kind: "range", min: 4, max: 128, step: 1, unit: "px" } },
      { key: "eraser.wholeGroups", label: "Eraser takes whole groups", control: { kind: "toggle" } },
    ],
  },
  {
    id: "media",
    label: "Media and playback",
    rows: [
      { key: "assets.edgeWidth", label: "Viewer edges", help: "Click this much of the viewer's left or right side to go to the previous or next asset (invisible). 0 turns it off.", control: { kind: "range", min: 0, max: 40, step: 1, unit: "%" } },
      { key: "assets.slideSeconds", label: "Slideshow", help: "Seconds each asset stays in the Assets slideshow (a video or audio file plays to its end first).", control: { kind: "range", min: 1, max: 60, step: 1, unit: "s", live: true } },
      { key: "media.volume", label: "Volume", help: "Shared by every player.", control: { kind: "range", min: 0, max: 100, step: 1, unit: "%" } },
      { key: "media.step.video", label: "Video step", help: "Seconds the step buttons move a video.", control: { kind: "range", min: 0.5, max: 60, step: 0.5, unit: "s" } },
      { key: "media.step.audio", label: "Audio step", help: "Seconds the step buttons move an audio file.", control: { kind: "range", min: 0.5, max: 60, step: 0.5, unit: "s" } },
      { key: "media.step.gif", label: "GIF step", help: "Frames the step buttons move an animated GIF.", control: { kind: "range", min: 1, max: 100, step: 1, unit: "frames" } },
      { key: "frame.format", label: "Extracted frame format", help: "The picture file made by Extract frame. PNG is lossless; WebP and JPEG are smaller (JPEG has no transparency).", control: { kind: "select", options: [["png", "PNG"], ["webp", "WebP"], ["jpeg", "JPEG"]] } },
      { key: "frame.quality", label: "Extracted frame quality", help: "For WebP and JPEG.", control: { kind: "range", min: 10, max: 100, step: 1, unit: "%" } },
      { key: "frame.place", label: "Place extracted frames on the canvas", help: "When a frame is extracted in the Assets viewer: also put it on the open canvas. (From a player on the canvas it is always placed beside the video.)", control: { kind: "toggle" } },
      { key: "frame.folder", label: "Extracted frames: library folder", help: "Frames are filed in this folder of the Assets library (made the first time). Leave it empty to file them in no folder.", control: { kind: "text", max: 60, placeholder: "Extracted frames" } },
      { key: "frame.name", label: "Extracted frames: file name", help: "Words in braces are replaced: {name} the video's name, {position} where in it (0m03s, or frame12 for a GIF), {board} {canvas} {workspace} {ddmmyyyy} {yyyymmdd} {hhmmss} {hhmm}. The extension is added.", control: { kind: "text", max: 120, placeholder: "{name}-{position}" } },
      { key: "frame.nameStyle", label: "Extracted frames: name words", help: "How the video's name and the board and canvas names are written in the file name.", control: { kind: "select", options: NAME_STYLES.map(([v, l]) => [v, l] as [string, string]) } },
      { key: "frame.tagFrame", label: "Extracted frames: tag “extracted-frame”", control: { kind: "toggle" } },
      { key: "frame.tagSource", label: "Extracted frames: tag with the video's name", control: { kind: "toggle" } },
      { key: "frame.tagInherit", label: "Extracted frames: the video's own tags", help: "Copy the library tags of the video (or GIF) onto each frame.", control: { kind: "toggle" } },
      { key: "frame.tagsCustom", label: "Extracted frames: your own tags", help: "Tags you choose, put on every extracted frame. Separate them with commas.", control: { kind: "text", max: 200, placeholder: "reference, still" } },
    ],
  },
  {
    id: "navigation",
    label: "Navigation",
    rows: [
      { key: "nav.mode", label: "Next item (W A S D)", help: "How the step keys (W A S D, changeable in Shortcuts) step from the selected item to the next. Nearest in view: the nearest item you can see at this zoom (items too small or far larger than the window are skipped). Nearest anywhere: the nearest by position, at any zoom or depth. By layer: up and down the stacking order, top-most first.", control: { kind: "select", options: [["view", "Nearest in view"], ["anywhere", "Nearest anywhere"], ["layer", "By layer"]] } },
      { key: "nav.arrive", label: "On arriving at an item", help: "What the view does when a step key (or a search) takes you to an item. Focus on it: zoom so the item fills the window. Keep the zoom level: only move the view so the item is in the middle.", control: { kind: "select", options: [["focus", "Focus on the item"], ["keep", "Keep the zoom level"]] } },
    ],
  },
  {
    id: "screenshot",
    label: "Screenshot",
    rows: [
      { key: "shot.format", label: "Picture format", help: "WebP is small and keeps transparency; PNG is lossless and bigger; JPEG is small but has no transparency. If the browser cannot write WebP, PNG is used.", control: { kind: "select", options: [["webp", "WebP"], ["png", "PNG"], ["jpeg", "JPEG"]] } },
      { key: "shot.quality", label: "Quality", help: "For WebP and JPEG. Higher is sharper and bigger.", control: { kind: "range", min: 10, max: 100, step: 1, unit: "%" } },
      { key: "shot.area", label: "Area", help: "The whole view, or only the box around the selected items (the whole view when nothing is selected).", control: { kind: "select", options: [["view", "The whole view"], ["selection", "The selection"]] } },
      { key: "shot.pattern", label: "Include the canvas pattern", help: "The grid or dots behind the content.", control: { kind: "toggle" } },
      { key: "shot.transparent", label: "Transparent background", help: "No background colour behind the content (WebP and PNG; JPEG is filled white). Turn the pattern off too for a clean cut-out.", control: { kind: "toggle" } },
      { key: "shot.interface", label: "Include the interface", help: "The floating bars and panels over the canvas (the toolbar, panels, readout). Off by default: a clean picture of the canvas.", control: { kind: "toggle" } },
      { key: "shot.copy", label: "Also copy it to the clipboard", help: "As a PNG, ready to paste into another app.", control: { kind: "toggle" } },
      { key: "shot.folder", label: "Library folder", help: "Screenshots are filed in this folder of the Assets library (made the first time). Leave it empty to file them in no folder.", control: { kind: "text", max: 60, placeholder: "Screenshots" } },
      { key: "shot.name", label: "File name", help: "Words in braces are replaced: {board} {canvas} {workspace} {ddmmyyyy} {yyyymmdd} {hhmmss} {hhmm} {yyyy} {mm} {dd} {hh} {min} {ss}. The extension is added.", control: { kind: "text", max: 120, placeholder: "{board}-{canvas}-{ddmmyyyy}-{hhmmss}" } },
      { key: "shot.nameStyle", label: "Name words", help: "How the board and canvas names are written in the file name.", control: { kind: "select", options: NAME_STYLES.map(([v, l]) => [v, l] as [string, string]) } },
      { key: "shot.tagShot", label: "Tag: screenshot", help: "Put the tag “screenshot” on every screenshot, to find them all.", control: { kind: "toggle" } },
      { key: "shot.tagBoard", label: "Tag: the board's name", control: { kind: "toggle" } },
      { key: "shot.tagCanvas", label: "Tag: the canvas's name", control: { kind: "toggle" } },
      { key: "shot.tagItems", label: "Tags of the items in it", help: "The in-canvas tags of the items in the screenshot (or in the selection).", control: { kind: "toggle" } },
      { key: "shot.tagsCustom", label: "Your own tags", help: "Tags you choose, put on every screenshot. Separate them with commas.", control: { kind: "text", max: 200, placeholder: "client, draft" } },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    rows: [
      { key: "quality.auto", label: "Adaptive quality", help: "Lower the canvas resolution when frames are slow.", control: { kind: "toggle" } },
      { key: "ui.motion", label: "Animation", help: "How the interface moves: panels and menus fade and rise in, the floating bars fade in Zen mode, buttons change colour smoothly. System follows your operating system's reduce-motion setting (the choice that most often makes everything instant). Subtle fades only, and shorter. None changes everything at once.", control: { kind: "select", options: [["system", "System"], ["full", "Full"], ["subtle", "Subtle"], ["reduce", "None"]] } },
      { key: "ui.animSpeed", label: "Animation speed", help: "How long each animation takes. It has no effect when Animation is None.", control: { kind: "select", options: [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]] } },
    ],
  },
  {
    id: "appearance",
    label: "Appearance",
    rows: [
      { key: "ui.theme", label: "Theme", help: "System follows your operating system.", control: { kind: "select", options: [["system", "System"], ["light", "Light"], ["dark", "Dark"]] } },
      { key: "ui.hue", label: "Theme colour", help: "The hue of the accent and of every tint. Brightness and contrast do not change with it.", control: { kind: "range", min: 0, max: 360, step: 1, unit: "°", live: true, hue: [["Viridian", 178], ["Ultramarine", 265], ["Violet", 310], ["Madder", 15], ["Ochre", 80]] } },
      { key: "ui.vivid", label: "Colourfulness", help: "From grey to vivid; brightness stays the same.", control: { kind: "range", min: 0, max: 150, step: 5, unit: "%", live: true } },
      { key: "ui.info", label: "Information shown", help: "The readout at the bottom left; the button at the bottom right cycles through these.", control: { kind: "select", options: [["simple", "Simple"], ["more", "Simple, with more"], ["technical", "Technical"], ["hidden", "Hidden"]] } },
      { key: "ui.pattern", label: "Canvas pattern", help: "What is drawn behind your content. The button at the bottom right cycles through these.", control: { kind: "select", options: [["grid", "Grid"], ["dots", "Dots"], ["scale", "Multi-scale grid"], ["none", "None"]] } },
      { key: "ui.density", label: "Density", help: "Compact (the default): smaller controls and tighter spacing, so more of the canvas shows. Comfortable: larger, roomier controls.", control: { kind: "select", options: [["compact", "Compact"], ["comfortable", "Comfortable"]] } },
      { key: "ui.textScale", label: "Interface size", help: "Scales the toolbars, panels and views (not the canvas).", control: { kind: "select", options: [["90", "90%"], ["100", "100%"], ["115", "115%"], ["130", "130%"], ["150", "150%"]] } },
      { key: "ui.contrast", label: "Contrast", help: "High contrast: stronger text and borders in the interface.", control: { kind: "select", options: [["normal", "Normal"], ["high", "High"]] } },
      { key: "ui.zen", label: "Zen mode", help: "Fade the floating bars and panels out; each shows again while the pointer is over it. Also the leaf button beside Home, or the Zen key (Settings > Shortcuts).", control: { kind: "toggle" } },
    ],
  },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "storage", label: "Storage" },
  { id: "privacy", label: "Privacy" },
  { id: "collaboration", label: "Collaboration" },
  {
    id: "develop",
    label: "Develop",
    rows: [
      { key: "dev.tools", label: "Developer tools", help: "Shows the developer panel (camera numbers, frame times, jump and auto-zoom buttons) and the diagnostics under the frame-rate readout, and keeps the adaptive quality from changing so measurements stay the same. Applies after reloading. An address ending in #debug turns it on for one session.", control: { kind: "toggle" } },
    ],
  },
];

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

function controlHtml(row: Row, id: string): string {
  const c = row.control;
  // The control is named by the label alone; the help text describes it.
  const a = `aria-labelledby="${id}-l"${row.help ? ` aria-describedby="${id}-h"` : ""}`;
  if (c.kind === "toggle") return `<input type="checkbox" id="${id}" data-set="${row.key}" ${a}>`;
  if (c.kind === "colour") return `<button type="button" class="set-colour" id="${id}" data-set="${row.key}" data-colour="${row.key}" aria-haspopup="dialog" ${a}><span class="set-colour-dot"></span><span class="set-colour-hex"></span></button>`;
  if (c.kind === "text") return `<input type="text" class="set-text" id="${id}" data-set="${row.key}" maxlength="${c.max}" placeholder="${esc(c.placeholder ?? "")}" autocomplete="off" spellcheck="false" ${a}>`;
  if (c.kind === "select") return `<select id="${id}" data-set="${row.key}" ${a}>${c.options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>`;
  const presets = c.hue ? `<span class="set-presets" role="group" aria-label="Theme colour presets">${c.hue.map(([n, d]) => `<button type="button" class="set-preset" data-preset="${row.key}" data-value="${d}" style="--p:${d}" aria-label="${esc(n)}" title="${esc(n)}"></button>`).join("")}</span>` : "";
  return `<input type="range" id="${id}" data-set="${row.key}" min="${c.min}" max="${c.max}" step="${c.step}" ${c.hue ? 'class="set-hue"' : ""} ${a}><output for="${id}"></output>${presets}`;
}

/** Mount the view into `root`; returns what main needs to show and hide it. */
export function mountSettingsView(root: HTMLElement, settings: SettingsStore, onClose: () => void): { show(tab?: string): void; hide(): void } {
  const tabButton = (t: Tab): string => `<button type="button" role="tab" id="set-tab-${t.id}" aria-controls="set-panel-${t.id}" data-tab="${t.id}">${esc(t.label)}<span class="set-hits" aria-hidden="true"></span></button>`;
  const tabsHtml = TAB_GROUPS.map(
    ([title, ids]) => `<div class="set-tabs-h" role="presentation">${esc(title)}</div>${ids.map((id) => tabButton(SETTINGS_TABS.find((t) => t.id === id)!)).join("")}`,
  ).join("");
  const panelsHtml = SETTINGS_TABS.map((t) => {
    const rowHtml = (r: Row): string => {
      const id = `set-${r.key.replace(/\./g, "-")}`;
      const scope = SCOPE_LABEL[SETTINGS[r.key].scope];
      return `<div class="set-row" data-row="${r.key}"><label for="${id}"><span class="set-label" id="${id}-l">${esc(r.label)}</span>${r.help ? `<span class="set-help" id="${id}-h">${esc(r.help)}</span>` : ""}</label>
              <div class="set-control">${controlHtml(r, id)}</div><span class="set-scope" title="Where this setting is kept">${scope}</span>
              <button type="button" class="set-reset" data-reset="${r.key}" aria-label="Reset ${esc(r.label)} to its default">Reset</button></div>`;
    };
    const body = t.rows
      ? cardsOf(t.rows)
          .map((c) => `<div class="set-card">${c.title ? `<h3>${esc(c.title)}</h3>` : ""}${c.rows.map(rowHtml).join("")}</div>`)
          .join("") +
        (t.id === "develop"
          ? `<div class="set-info set-card" data-develop><dl><dt>Version</dt><dd>${esc(document.documentElement.dataset["version"] ?? "")}</dd><dt>Build</dt><dd>One file: this page. There is no separate debug build.</dd></dl>
             <p class="set-note" data-dev-note role="status" hidden>Reload to apply the change. <button type="button" class="set-done" data-reload>Reload now</button></p></div>`
          : "")
      : t.id === "shortcuts"
        ? `<div class="set-info set-keys"><p>Tool keys and the keys that step to the next item are a single letter and work on the canvas. Press <strong>Change</strong>, then the new letter; Escape cancels.</p>
           <div data-tool-keys></div><p class="set-note" data-key-note role="status"></p><h3 class="set-sub">Fixed shortcuts</h3>${FIXED_SHORTCUTS.map((g) => `<div class="set-card"><h4>${esc(g.group)}</h4><dl>${g.items.map((i) => `<dt><kbd>${esc(i.keys)}</kbd></dt><dd>${esc(i.does)}</dd>`).join("")}</dl></div>`).join("")}</div>`
      : t.id === "storage"
        ? `<div class="set-info set-card" data-storage><p>Your canvases are kept in this browser's storage, on this device.</p><dl><dt>Used</dt><dd data-used>…</dd><dt>Available</dt><dd data-quota>…</dd><dt>Protected from clearing</dt><dd data-persisted>…</dd></dl>
           <p><strong>Browser storage is not a backup.</strong> Clearing site data, or the browser's own clean-up, removes it. Use an export from the workspace menu to keep a copy.</p></div>`
        : t.id === "collaboration"
          ? `<div class="set-info set-card"><p><strong>Collaboration is off.</strong> This version has no shared or online sessions: nothing can connect to your canvases.</p>
           <p>When it is added it will be opt-in for each workspace, with named roles, and everything will keep working offline. Until then, share work with an export from the workspace menu.</p></div>`
        : `<div class="set-info set-card"><p>canvast works entirely on this device. It makes no network requests: the page is one file and its security policy refuses every connection.</p>
           <p>Nothing you draw, import or write leaves this browser unless you export it yourself.</p></div>`;
    return `<section role="tabpanel" id="set-panel-${t.id}" aria-labelledby="set-tab-${t.id}" data-panel="${t.id}" hidden><h2>${esc(t.label)}</h2>${body}</section>`;
  }).join("");
  root.innerHTML = `<div class="set-head"><h1 class="set-title">Settings</h1>
    <div class="set-searchbox">${ICONS.search}<input type="search" class="set-search" data-testid="settings-search" placeholder="Search settings" aria-label="Search settings" title="Search settings (press / to start)" autocomplete="off" spellcheck="false"><button type="button" class="cs-clear" data-search-clear aria-label="Clear the search" title="Clear the search" hidden>${ICONS.x}</button></div>
    <button type="button" class="set-done" data-done>Back to canvas</button></div>
    <div class="set-body"><div class="set-tabs" role="tablist" aria-label="Settings" aria-orientation="vertical">${tabsHtml}</div><div class="set-panels">${panelsHtml}<p class="set-none" data-testid="settings-none" role="status" hidden></p></div></div>`;

  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const searchEl = root.querySelector<HTMLInputElement>(".set-search")!;
  const clearEl = root.querySelector<HTMLButtonElement>("[data-search-clear]")!;
  const panelsEl = root.querySelector<HTMLElement>(".set-panels")!;
  const noneEl = root.querySelector<HTMLElement>(".set-none")!;
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
    cancelCapture();
    if (id === "storage") void storage();
  };

  /**
   * Search: every word must be somewhere in a row (its name, its help, the key, the card and tab it is on). While a search is on, all the
   * tabs show together with only what matches, and each tab in the list says how many matches it has. An empty search puts it all back.
   */
  const search = (): void => {
    const words = searchEl.value.toLowerCase().split(/\s+/).filter(Boolean);
    clearEl.hidden = words.length === 0;
    panelsEl.classList.toggle("is-searching", words.length > 0);
    root.querySelector(".set-body")!.classList.toggle("is-searching", words.length > 0);
    let total = 0;
    for (const sec of panels) {
      const tabLabel = SETTINGS_TABS.find((t) => t.id === sec.dataset["panel"])!.label.toLowerCase();
      let hits = 0;
      for (const card of sec.querySelectorAll<HTMLElement>(".set-card")) {
        const title = card.querySelector(":scope > h3, :scope > h4")?.textContent?.toLowerCase() ?? "";
        const rows = [...card.querySelectorAll<HTMLElement>(".set-row")];
        const items = rows.length ? rows : [card];
        let cardHits = 0;
        for (const el of items) {
          const hit = words.every((w) => `${el.textContent} ${title} ${tabLabel}`.toLowerCase().includes(w));
          el.classList.toggle("set-miss", words.length > 0 && !hit);
          if (hit) cardHits++;
        }
        card.classList.toggle("set-miss", words.length > 0 && cardHits === 0);
        hits += words.length > 0 ? cardHits : 0;
      }
      for (const h of sec.querySelectorAll<HTMLElement>("h3.set-sub, .set-note")) h.classList.toggle("set-miss", words.length > 0);
      sec.classList.toggle("set-miss", words.length > 0 && hits === 0);
      const badge = root.querySelector<HTMLElement>(`[data-tab="${sec.dataset["panel"]}"] .set-hits`)!;
      badge.textContent = words.length > 0 && hits > 0 ? String(hits) : "";
      total += hits;
    }
    noneEl.hidden = words.length === 0 || total > 0;
    noneEl.textContent = `Nothing in Settings matches "${searchEl.value.trim()}".`;
  };
  searchEl.addEventListener("input", search);
  clearEl.addEventListener("click", () => {
    searchEl.value = "";
    search();
    searchEl.focus();
  });
  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && searchEl.value) {
      e.stopPropagation(); // the first Escape clears the search; the next closes Settings
      searchEl.value = "";
      search();
    }
  });
  // "/" starts a search from anywhere in Settings that is not a field.
  root.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !t.closest("input, select, textarea")) {
      e.preventDefault();
      searchEl.focus();
    }
  });

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

  /** The key being changed, waiting for a letter. */
  let capturing: SettingKey | null = null;
  const renderKeys = (): void => {
    const host = root.querySelector<HTMLElement>("[data-tool-keys]");
    if (!host) return;
    let group = "";
    host.innerHTML = KEY_ROWS.map((r) => {
      const def = SETTINGS[r.setting].default as string;
      const cur = settings.get(r.setting) as string;
      const head = r.group !== group ? `${group ? "</div>" : ""}<div class="set-card"><h3>${esc(r.group)}</h3>` : "";
      group = r.group;
      return `${head}<div class="set-row set-keyrow"><span class="set-label">${esc(r.name)}</span>
        <div class="set-control"><kbd class="set-key">${capturing === r.setting ? "press a letter…" : esc(cur.toUpperCase())}</kbd><button type="button" class="set-reset" data-change-key="${r.setting}" aria-label="Change the key for ${esc(r.name)}">Change</button></div>
        <span class="set-scope">This device</span><button type="button" class="set-reset" data-reset="${r.setting}" aria-label="Reset the key for ${esc(r.name)} to its default"${cur === def ? " disabled" : ""}>Reset</button></div>`;
    }).join("") + (KEY_ROWS.length ? "</div>" : "");
  };
  const keyNote = (text: string): void => {
    const n = root.querySelector<HTMLElement>("[data-key-note]");
    if (n) n.textContent = text;
  };
  const all = SETTINGS_TABS.flatMap((t) => t.rows ?? []);
  /** Show the stored values in the controls (never while one is being typed into: only called on a change). */
  const refresh = (): void => {
    renderKeys();
    search();
    for (const r of all) {
      const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-set="${r.key}"]`);
      if (!el) continue;
      const v = settings.get(r.key) as SettingValue<typeof r.key>;
      if (r.control.kind === "colour") {
        (el.querySelector(".set-colour-dot") as HTMLElement).style.background = swatchBackground(String(v));
        el.querySelector(".set-colour-hex")!.textContent = String(v).toUpperCase();
      } else if (r.control.kind === "toggle") (el as HTMLInputElement).checked = v === true;
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
      if (row.control.live) settings.set(key, Number(t.value) as never);
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
    if (tab) {
      select(tab.dataset["tab"]!);
      // While searching every tab shows: the one chosen scrolls into view.
      if (panelsEl.classList.contains("is-searching")) panels.find((p) => p.dataset["panel"] === tab.dataset["tab"])?.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    const swatch = t.closest<HTMLElement>("[data-colour]");
    if (swatch) {
      const key = swatch.dataset["colour"] as SettingKey;
      const label = all.find((r) => r.key === key)?.label ?? "Colour";
      return openColourPopover(swatch, { name: label, value: String(settings.get(key)), onInput: (hex) => void settings.set(key, hex as never) });
    }
    const preset = t.closest<HTMLElement>("[data-preset]");
    if (preset) return void settings.set(preset.dataset["preset"] as SettingKey, Number(preset.dataset["value"]) as never);
    const change = t.closest<HTMLElement>("[data-change-key]");
    if (change) {
      capturing = change.dataset["changeKey"] as SettingKey;
      keyNote("");
      renderKeys();
      root.querySelector<HTMLElement>(`[data-change-key="${capturing}"]`)?.focus();
      return;
    }
    const reset = t.closest<HTMLElement>("[data-reset]");
    if (reset) return settings.reset(reset.dataset["reset"] as SettingKey);
    if (t.closest("[data-reload]")) location.reload();
    if (t.closest("[data-done]")) onClose();
  });
  /** Stop waiting for a letter (focus moved away, another tab, or the view closed): nothing changes. */
  const cancelCapture = (): void => {
    if (!capturing) return;
    capturing = null;
    renderKeys();
  };
  root.addEventListener("pointerdown", (e) => {
    if (capturing && !(e.target as HTMLElement).closest(`[data-change-key="${capturing}"]`)) cancelCapture();
  });
  // While waiting for a letter every key is for the key being chosen, wherever the focus is (a click elsewhere cancels).
  window.addEventListener(
    "keydown",
    (e) => {
      if (!capturing || root.hidden) return;
      // Any key is for the key being chosen: a letter sets it, Escape cancels, everything else is refused with a reason.
      const setting = capturing;
      const name = KEY_ROWS.find((r) => r.setting === setting)!.name;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Tab" || e.key === "Shift") return;
      capturing = null;
      const letter = e.key.length === 1 ? e.key.toLowerCase() : "";
      if (e.key === "Escape") keyNote("");
      else if (!/^[a-z]$/.test(letter) || e.ctrlKey || e.metaKey || e.altKey) keyNote("A key here is one plain letter, a to z.");
      else {
        const other = keyOwner(settings, letter, setting);
        if (other) keyNote(`${letter.toUpperCase()} is already the key for ${other}. Change that one first.`);
        else {
          settings.set(setting, letter);
          keyNote(`${name} is now ${letter.toUpperCase()}.`);
        }
      }
      renderKeys();
      root.querySelector<HTMLElement>(`[data-change-key="${setting}"]`)?.focus();
    },
    true,
  );
  root.addEventListener("keydown", (e) => {
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
  settings.subscribe((key) => {
    if (key === "dev.tools") root.querySelector<HTMLElement>("[data-dev-note]")!.hidden = false;
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
      cancelCapture();
      root.hidden = true;
    },
  };
}
