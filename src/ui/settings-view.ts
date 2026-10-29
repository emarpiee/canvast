import { DOCK_PANEL_IDS } from "../settings/panels";
import type { SettingKey, SettingValue, SettingsStore } from "../settings/settings";
import { openColourPopover } from "./colour-popover";
import { swatchBackground } from "../render/ink";
import { NAME_STYLES } from "../app/screenshot";
import { SETTINGS } from "../settings/settings";
import { FIXED_SHORTCUTS } from "../settings/shortcuts";
import { KEY_COMMANDS, type Keymap, type KeyCommand, comboOfEvent, displayCombo, judge } from "../settings/keymap";
import { esc } from "./format";
import { bindContextMenu } from "./context-menu";
import type { MenuItem } from "./more-menu";
import { syncScroll } from "./bar";
declare const __CANVAST_VERSION__: string;
import NOTICES from "../../THIRD_PARTY_NOTICES.md";
import { capabilities, clearErrorLog, diagnosticReport, errorLog, onErrorLog } from "../app/diagnostics";
import { ICONS } from "./icons";
import { logoSvg } from "./brand";
import { desktopBridge } from "../storage/desktop-bridge";
import { openWorkspaceSwitcher } from "./workspace-switch";

/** The desktop build (ADR 0177): the workspace is a folder, so what Settings says about storage, privacy and the page differs. */
const DESKTOP = !!desktopBridge();
/** A setting's words as the desktop build needs them (it has an app window, not a tab or an address). */
const forDesktop = (text: string): string =>
  DESKTOP ? text.replace(/until the tab closes/g, "until the app closes").replace(/until this tab is closed or reloaded/g, "until the app is closed or reloaded").replace(/ An address ending in #debug turns it on for one session\./g, "") : text;

/**
 * The Settings view (ADR 0048, engineering plan §14.40): a tabbed page, one of the three top-level views. Every row is one declared
 * setting (settings/settings.ts): its label, a control that fits its type, where it applies (scope), and a reset to the default.
 * Rows read and write the same store the toolbars use, so a change made here shows there and the other way round.
 */
type Control =
  | { kind: "toggle" }
  | { kind: "range"; min: number; max: number; step: number; unit?: string; /** A hue slider (rainbow track) with named presets, applied while dragging. */ hue?: ReadonlyArray<[name: string, degrees: number]>; /** A setting that makes the hue follow the canvas background instead (one more chip after the presets). */ adaptive?: SettingKey; /** Applied while dragging, not on release. */ live?: boolean }
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
  "shape.initialPaint": "Shapes",
  "eraser.diameterPx": "Eraser",
  "assets.edgeWidth": "The library viewer",
  "media.volume": "Players",
  "frame.format": "Extracted frames",
  "edit.format": "Edited pictures",
  "export.folder": "Exported pictures",
  "pattern.folder": "Saved patterns",
  "svg.folder": "Saved shapes",
  "shot.format": "The picture",
  "shot.folder": "Where it goes and its name",
  "shot.tagShot": "Tags",
  "ui.theme": "Colour",
  "ui.info": "Canvas and info bar",
  "ui.density": "Size and comfort",
  "ui.zen": "Focus",
  "quality.auto": "Drawing quality",
  "ui.motion": "Animation",
  "nav.travel": "Camera travel",
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
/** The icon of each tab (Screenshot shares the camera of the Screenshot button). */
const TAB_ICON: Record<string, keyof typeof ICONS> = { drawing: "tabDrawing", navigation: "tabNavigation", shortcuts: "tabShortcuts", media: "tabMedia", screenshot: "camera", appearance: "tabAppearance", panels: "tabPanels", performance: "tabPerformance", storage: "tabStorage", privacy: "tabPrivacy", about: "tabAbout", develop: "tabDevelop" };

const TAB_GROUPS: ReadonlyArray<readonly [title: string, ids: readonly string[]]> = [
  ["Working", ["drawing", "navigation", "shortcuts"]],
  ["Media", ["media", "screenshot"]],
  ["Interface", ["appearance", "panels", "performance"]],
  ["App", ["storage", "privacy", "about", "develop"]],
];

const SCOPE_LABEL = { device: "This device", workspace: "This workspace", board: "This board" } as const;

export const SETTINGS_TABS: readonly Tab[] = [
  {
    id: "drawing",
    label: "Drawing and selection",
    rows: [
      { key: "pen.kind", label: "Pen", help: "The pen new strokes are drawn with.", control: { kind: "select", options: [["fine", "Fine"], ["pencil", "Pencil"], ["ink", "Ink"], ["marker", "Marker"]] } },
      { key: "pen.color", label: "Pen colour", help: "Opens the colour picker. The colours you picked lately are under the picker.", control: { kind: "colour" } },
      { key: "colour.model", label: "Colour picker model", help: "OKHSL and OKHSV keep every slider inside the colours a screen can show; OKLCH is OKLab's own lightness, chroma and hue, as CSS oklch() writes them, and stops chroma where a screen cannot show more. All three are even to the eye: the same step looks like the same change of colour.", control: { kind: "select", options: [["okhsv", "OKHSV (hue, saturation, value)"], ["okhsl", "OKHSL (hue, saturation, lightness)"], ["oklch", "OKLCH (hue, chroma, lightness)"]] } },
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
      { key: "shape.gapClosePx", label: "Fill gaps: close openings up to", help: "Fill gaps and Fill a gap also fill a place left open by a slit up to this wide on the screen (at the zoom you are at); the fill stops at the slit. 0: only places closed in all round.", control: { kind: "range", min: 0, max: 24, step: 1, unit: "px" } },
      { key: "shape.initialPaint", label: "Initial state keeps the fill and outline", help: "When you Set or Update a shape's initial state, its fill, outline and its options, opacity and blend are saved with it (the shape, its size, rotation, points, ratio, radius and smoothing always are), and Reset puts them back. Off: only the geometry is saved and Reset leaves the paint as it is. A state saved while this was off has no paint until you Update it.", control: { kind: "toggle" } },
      { key: "eraser.diameterPx", label: "Eraser size", control: { kind: "range", min: 4, max: 128, step: 1, unit: "px" } },
      { key: "eraser.wholeGroups", label: "Eraser takes whole groups", control: { kind: "toggle" } },
    ],
  },
  {
    id: "media",
    label: "Media and playback",
    rows: [
      { key: "assets.edgeWidth", label: "Viewer edges", help: "Click this much of the viewer's left or right side to go to the previous or next item (invisible). 0 turns it off.", control: { kind: "range", min: 0, max: 40, step: 1, unit: "%" } },
      { key: "assets.playerHideSeconds", label: "Hide the player", help: "Seconds the viewer's video and GIF player stays after the pointer stops moving, playing or paused; it comes back with any move.", control: { kind: "range", min: 0.5, max: 10, step: 0.5, unit: "s", live: true } },
      { key: "assets.slideSeconds", label: "Slideshow", help: "Seconds each item stays in the library slideshow (a video or audio file plays to its end first).", control: { kind: "range", min: 1, max: 60, step: 1, unit: "s", live: true } },
      { key: "media.volume", label: "Starting volume", help: "Where each player starts. A player's own volume slider changes only that player.", control: { kind: "range", min: 0, max: 100, step: 1, unit: "%" } },
      { key: "media.step.video", label: "Video step", help: "Seconds the step buttons move a video.", control: { kind: "range", min: 0.5, max: 60, step: 0.5, unit: "s" } },
      { key: "media.step.audio", label: "Audio step", help: "Seconds the step buttons move an audio file.", control: { kind: "range", min: 0.5, max: 60, step: 0.5, unit: "s" } },
      { key: "media.step.gif", label: "GIF step", help: "Frames the step buttons move an animated GIF.", control: { kind: "range", min: 1, max: 100, step: 1, unit: "frames" } },
      { key: "frame.format", label: "Extracted frame format", help: "The picture file made by Extract frame. PNG is lossless; WebP and JPEG are smaller (JPEG has no transparency).", control: { kind: "select", options: [["png", "PNG"], ["webp", "WebP"], ["jpeg", "JPEG"]] } },
      { key: "frame.quality", label: "Extracted frame quality", help: "For WebP and JPEG.", control: { kind: "range", min: 10, max: 100, step: 1, unit: "%" } },
      { key: "frame.place", label: "Place extracted frames on the canvas", help: "When a frame is extracted in the library viewer: also put it on the open canvas (off by default). (From a player on the canvas it is always placed beside the video.)", control: { kind: "toggle" } },
      { key: "frame.folder", label: "Extracted frames: library folder", help: "Frames are filed in this folder of the library (made the first time). Leave it empty to file them in no folder.", control: { kind: "text", max: 60, placeholder: "Extracted frames" } },
      { key: "frame.name", label: "Extracted frames: file name", help: "Words in braces are replaced: {name} the video's name, {position} where in it (0m03s, or frame12 for a GIF), {board} {canvas} {workspace} {ddmmyyyy} {yyyymmdd} {hhmmss} {hhmm}. The extension is added.", control: { kind: "text", max: 120, placeholder: "{name}-{position}" } },
      { key: "frame.nameStyle", label: "Extracted frames: name words", help: "How the video's name and the board and canvas names are written in the file name.", control: { kind: "select", options: NAME_STYLES.map(([v, l]) => [v, l] as [string, string]) } },
      { key: "frame.tagFrame", label: "Extracted frames: tag “extracted-frame”", control: { kind: "toggle" } },
      { key: "frame.tagSource", label: "Extracted frames: tag with the video's name", control: { kind: "toggle" } },
      { key: "frame.tagInherit", label: "Extracted frames: the video's own tags", help: "Copy the library tags of the video (or GIF) onto each frame.", control: { kind: "toggle" } },
      { key: "frame.tagsCustom", label: "Extracted frames: your own tags", help: "Tags you choose, put on every extracted frame. Separate them with commas.", control: { kind: "text", max: 200, placeholder: "reference, still" } },
      { key: "edit.format", label: "Edited picture format", help: "The picture file made by Make a new picture (a picture with its crop and adjustments baked in). PNG is lossless; WebP and JPEG are smaller (JPEG has no transparency).", control: { kind: "select", options: [["png", "PNG"], ["webp", "WebP"], ["jpeg", "JPEG"]] } },
      { key: "edit.quality", label: "Edited picture quality", help: "For WebP and JPEG.", control: { kind: "range", min: 10, max: 100, step: 1, unit: "%" } },
      { key: "edit.folder", label: "Edited pictures: library folder", help: "Edited pictures are filed in this folder of the library (made the first time). Leave it empty to file them in no folder.", control: { kind: "text", max: 60, placeholder: "Edited pictures" } },
      { key: "edit.name", label: "Edited pictures: file name", help: "Words in braces are replaced: {name} the file's name, {board} {canvas} {workspace} {ddmmyyyy} {yyyymmdd} {hhmmss} {hhmm}. The extension is added.", control: { kind: "text", max: 120, placeholder: "{name}-edited" } },
      { key: "edit.nameStyle", label: "Edited pictures: name words", help: "How the file's name and the board and canvas names are written in the file name.", control: { kind: "select", options: NAME_STYLES.map(([v, l]) => [v, l] as [string, string]) } },
      { key: "edit.tagEdited", label: "Edited pictures: tag “edited-picture”", control: { kind: "toggle" } },
      { key: "edit.tagSource", label: "Edited pictures: tag with the file's name", control: { kind: "toggle" } },
      { key: "edit.tagInherit", label: "Edited pictures: the file's own tags", help: "Copy the library tags of the file onto the new picture.", control: { kind: "toggle" } },
      { key: "edit.tagsCustom", label: "Edited pictures: your own tags", help: "Tags you choose, put on every edited picture. Separate them with commas.", control: { kind: "text", max: 200, placeholder: "edited, final" } },
      { key: "export.folder", label: "Exports: library folder", help: "A picture saved to the library from Export… is filed in this folder (made the first time). Leave it empty to file it in no folder.", control: { kind: "text", max: 60, placeholder: "Exports" } },
      { key: "export.tags", label: "Exports: tags", help: "Tags put on every picture saved to the library from Export…. Separate them with commas; leave it empty for none.", control: { kind: "text", max: 200, placeholder: "export" } },
      { key: "pattern.folder", label: "Patterns: library folder", help: "A pattern made by the Pattern panel (a sheet or selection that holds one) saved to the library, from Export… or as SVG, is filed in this folder instead of the one for exports. Leave it empty to file it in no folder.", control: { kind: "text", max: 60, placeholder: "Patterns" } },
      { key: "pattern.tags", label: "Patterns: tags", help: "Tags put on every saved pattern. Separate them with commas; leave it empty for none.", control: { kind: "text", max: 200, placeholder: "pattern" } },
      { key: "svg.folder", label: "Shapes: library folder", help: "Selected shapes saved to the library as an SVG are filed in this folder (made the first time). Leave it empty to file them in no folder.", control: { kind: "text", max: 60, placeholder: "Shapes" } },
      { key: "svg.tags", label: "Shapes: tags", help: "Tags put on every SVG saved from selected shapes. Separate them with commas; leave it empty for none.", control: { kind: "text", max: 200, placeholder: "shape" } },
    ],
  },
  {
    id: "navigation",
    label: "Navigation",
    rows: [
      { key: "nav.mode", label: "Next item (W A S D)", help: "How the step keys (W A S D, changeable in Shortcuts) step from the selected item to the next. Nearest in view: the nearest item you can see at this zoom (items too small or far larger than the window are skipped). Nearest anywhere: the nearest by position, at any zoom or depth. By layer: up and down the stacking order, top-most first. By name A to Z: in the order of the names the Layers list shows. W and A go back, S and D on; in view: only the items in the window.", control: { kind: "select", options: [["view", "Nearest in view"], ["anywhere", "Nearest anywhere"], ["layer-view", "By layer, in view"], ["layer", "By layer, anywhere"], ["az-view", "By name A to Z, in view"], ["az", "By name A to Z, anywhere"]] } },
      { key: "nav.arrive", label: "On arriving at an item", help: "What the view does when a step key (or a search) takes you to an item. Focus on it: zoom so the item fills the window. Keep the zoom level: only move the view so the item is in the middle.", control: { kind: "select", options: [["focus", "Focus on the item"], ["keep", "Keep the zoom level"]] } },
      { key: "nav.travel", label: "Travel to a bookmark", help: "How the view gets to a bookmark or a previous view. Fly: glide to near places and, for far ones (another depth or frame), zoom out from here and in to there. Near only: glide to near places, cut straight to far ones. Cut: always arrive at once. Animation set to None always cuts.", control: { kind: "select", options: [["fly", "Fly (glide near, dive to far)"], ["near", "Glide near only"], ["cut", "Cut"]] } },
      { key: "nav.baseSeconds", label: "Travel time (base)", help: "How long a short trip takes. Far trips take longer when the time grows with distance (up to the longest trip below).", control: { kind: "range", min: 0.1, max: 3, step: 0.1, unit: "s" } },
      { key: "nav.respectMotion", label: "Follow the system's reduced motion", help: "When your operating system asks for reduced motion (Animation set to System), trips cut instead of gliding. Turn this off to glide anyway; Animation set to None always cuts.", control: { kind: "toggle" } },
      { key: "nav.speed", label: "Travel time", help: "Distance-aware: a short hop takes the base time (Animation speed), a long trip takes longer, up to the limit below. Fixed: every trip takes the base time.", control: { kind: "select", options: [["distance", "Grows with distance"], ["fixed", "Fixed"]] } },
      { key: "nav.maxSeconds", label: "Longest trip", help: "The most a trip may take with distance-aware time.", control: { kind: "range", min: 0.5, max: 6, step: 0.5, unit: "s" } },
      { key: "nav.ease", label: "Travel easing", help: "Smooth starts and ends slowly. Linear moves at one pace. Ease-out starts fast and settles.", control: { kind: "select", options: [["smooth", "Smooth"], ["linear", "Linear"], ["out", "Ease-out"]] } },
      { key: "nav.fade", label: "Fade at the switch of a far trip", help: "A far trip zooms out from here and in to there; the switch happens in the middle. On: the canvas dips dark for a moment around it, so the switch is not seen as a cut.", control: { kind: "toggle" } },
      { key: "tour.speed", label: "Tour: travel speed", help: "How fast a tour moves between stops, on top of the travel time. A tour always glides at least slowly enough to follow.", control: { kind: "select", options: [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]] } },
      { key: "tour.pause", label: "Tour: wait at each stop", help: "A tour of the bookmarks moves on by itself after this many seconds at a stop. 0: you step with the arrow keys.", control: { kind: "range", min: 0, max: 10, step: 1, unit: "s" } },
    ],
  },
  {
    id: "screenshot",
    label: "Screenshot",
    rows: [
      { key: "shot.format", label: "Picture format", help: "WebP is small and keeps transparency; PNG is lossless and bigger; JPEG is small but has no transparency. If the browser cannot write WebP, PNG is used.", control: { kind: "select", options: [["webp", "WebP"], ["png", "PNG"], ["jpeg", "JPEG"]] } },
      { key: "shot.quality", label: "Quality", help: "For WebP and JPEG. Higher is sharper and bigger.", control: { kind: "range", min: 10, max: 100, step: 1, unit: "%" } },
      { key: "shot.pattern", label: "Include the canvas pattern", help: "The grid or dots behind the content.", control: { kind: "toggle" } },
      { key: "shot.transparent", label: "Transparent background", help: "No background colour behind the content (WebP and PNG; JPEG is filled white). Turn the pattern off too for a clean cut-out.", control: { kind: "toggle" } },
      { key: "shot.interface", label: "Include the interface", help: "The floating bars and panels over the canvas (the toolbar, panels, info bar). Off by default: a clean picture of the canvas.", control: { kind: "toggle" } },
      { key: "shot.copy", label: "Also copy it to the clipboard", help: "As a PNG, ready to paste into another app.", control: { kind: "toggle" } },
      { key: "shot.folder", label: "Library folder", help: "Screenshots are filed in this folder of the library (made the first time). Leave it empty to file them in no folder.", control: { kind: "text", max: 60, placeholder: "Screenshots" } },
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
    id: "panels",
    label: "Panels",
    rows: [
      { key: "panel.autoFold", label: "Minimize inactive panels", help: "The panels stacked on a side fold to their title bar when you use another one. Off: they stay as you left them. Only the active one: just the panel on top of each stack stays open. The latest few: the panels you used last stay open (set how many below). Floating panels are never folded.", control: { kind: "select", options: [["off", "Off"], ["all", "Keep only the active panel open"], ["latest", "Keep the latest few open"]] } },
      { key: "panel.keep", label: "Panels kept open", help: `How many stacked panels stay open with "Keep the latest few open", counting the active one; up to the ${DOCK_PANEL_IDS.length} panels the app has. Press a title bar to open or fold a panel yourself; drag it to float it or to stack it on the other side.`, control: { kind: "range", min: 1, max: DOCK_PANEL_IDS.length, step: 1, unit: "panels" } },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    rows: [
      { key: "quality.auto", label: "Adaptive quality", help: "Lower the canvas resolution when frames are slow.", control: { kind: "toggle" } },
      { key: "quality.level", label: "Quality when adaptive quality is off", help: "The quality the canvas is held at. Full: every device pixel, nothing simplified. Balanced: at most 1.5 pixels per screen pixel and a zoom preview for busy scenes. Fast: 1 pixel per screen pixel and the preview more often. A big canvas on a slow or very sharp screen draws faster at Balanced or Fast.", control: { kind: "select", options: [["full", "Full"], ["balanced", "Balanced"], ["fast", "Fast"]] } },
      { key: "cache.decodedMb", label: "Memory for pictures", help: "How much memory the pictures that are on screen may take once decoded. Over it, the ones nothing has asked for lately are let go and decoded again when needed (the files stay stored). More keeps more pictures ready; less is kinder to a small machine.", control: { kind: "select", options: [["128", "128 MB"], ["256", "256 MB"], ["384", "384 MB"], ["768", "768 MB"], ["1536", "1.5 GB"]] } },
      { key: "ui.motion", label: "Animation", help: "How the interface moves: panels and menus fade and rise in, the floating bars fade in Zen mode, buttons change colour smoothly. System follows your operating system's reduce-motion setting (the choice that most often makes everything instant). Subtle fades only, and shorter. None changes everything at once.", control: { kind: "select", options: [["system", "System"], ["full", "Full"], ["subtle", "Subtle"], ["reduce", "None"]] } },
      { key: "ui.animSpeed", label: "Animation speed", help: "How long each animation takes. It has no effect when Animation is None.", control: { kind: "select", options: [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]] } },
    ],
  },
  {
    id: "appearance",
    label: "Appearance",
    rows: [
      { key: "ui.theme", label: "Theme", help: "System follows your operating system.", control: { kind: "select", options: [["system", "System"], ["light", "Light"], ["dark", "Dark"]] } },
      { key: "ui.hue", label: "Theme colour", help: "The hue of the accent and of every tint. Brightness and contrast do not change with it.", control: { kind: "range", min: 0, max: 360, step: 1, unit: "°", live: true, hue: [["Viridian", 178], ["Ultramarine", 265], ["Violet", 310], ["Madder", 15], ["Ochre", 80]], adaptive: "ui.hueAdaptive" } },
      { key: "ui.vivid", label: "Colourfulness", help: "From grey to vivid; brightness stays the same.", control: { kind: "range", min: 0, max: 150, step: 5, unit: "%", live: true } },
      { key: "ui.info", label: "Information shown", help: "The info bar at the bottom left; the button at the bottom right cycles through these.", control: { kind: "select", options: [["simple", "Simple"], ["more", "Simple, with more"], ["technical", "Technical"], ["hidden", "Hidden"]] } },
      { key: "ui.hints", label: "Hints and tooltips", help: "The line at the bottom that says what the tool does and what each button is, and the browser's own tooltips. All: both. Line only: no browser tooltips. None: neither.", control: { kind: "select", options: [["all", "All"], ["bar", "Line only"], ["off", "None"]] } },
      { key: "ui.pattern", label: "Canvas pattern", help: "What is drawn behind your content. The button at the bottom right cycles through these.", control: { kind: "select", options: [["grid", "Grid"], ["dots", "Dots"], ["scale", "Multi-scale grid"], ["none", "None"]] } },
      { key: "ui.actions", label: "Actions bar", help: "Where the bar of actions for the selected things sits. At the bottom: always in the same place. Follows the selection: just under the selected things (above them when there is no room below).", control: { kind: "select", options: [["bottom", "At the bottom"], ["follow", "Follows the selection"]] } },
      { key: "ui.names", label: "Item names", help: "The name above a sheet, picture or file card (and above any item that is selected). Always: every one. When selected: only the selected ones. Hidden: none. The button at the bottom right cycles through these.", control: { kind: "select", options: [["all", "Always"], ["picked", "When selected"], ["off", "Hidden"]] } },
      { key: "ui.density", label: "Density", help: "Compact (the default): smaller controls and tighter spacing, so more of the canvas shows. Dense: the smallest controls, fields, menus and spacing, for the most canvas. Comfortable: larger, roomier controls.", control: { kind: "select", options: [["dense", "Dense"], ["compact", "Compact"], ["comfortable", "Comfortable"]] } },
      { key: "ui.corners", label: "Corners", help: "The shape of every corner of the interface: buttons, fields, panels, menus, chips and dots, in every view. Round (the default) or sharp.", control: { kind: "select", options: [["round", "Round"], ["sharp", "Sharp"]] } },
      { key: "ui.zen", label: "Zen mode", help: "Fade the floating bars and panels out; each shows again while the pointer is over it. Also the leaf button beside Home, or the Zen key (Settings > Shortcuts).", control: { kind: "toggle" } },
    ],
  },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "storage", label: "Storage" },
  {
    id: "privacy",
    label: "Privacy",
    rows: [
      { key: "library.hiddenWord", label: "Word that opens the Hidden items", help: "Type this in the library's search box to open the items you hid (it asks for the password first, if you set one). The list is not shown anywhere else. Leave it empty to turn this off. Select something that is not a word you would search for.", control: { kind: "text", max: 40, placeholder: "hidden:" } },
      ...(DESKTOP
        ? [{ key: "library.hiddenNamesOff", label: "Keep hidden items' names off this device while locked", help: "On: when the Hidden items are locked (and when the app starts), this device's own copy of their names, tags and notes, and of hidden folders' names, is cleared; the encrypted files keep them, and opening the Hidden items brings them back. Off (the default): this device keeps them, so the Hidden list opens at once.", control: { kind: "toggle" } } as Row]
        : []),
      { key: "library.hiddenRemember", label: "Keep the Hidden items open until the tab closes", help: "Off (the default): the Hidden list closes when you choose another list or leave the library, and asks for the password again. On: after the password is given once, the list stays open, and opens without the password again, until this tab is closed or reloaded. Exporting hidden items always asks.", control: { kind: "toggle" } },
    ],
  },
  { id: "about", label: "About and diagnostics" },
  {
    id: "develop",
    label: "Develop",
    rows: [
      { key: "dev.tools", label: "Developer tools", help: "Shows the developer panel (camera numbers, frame times, jump and auto-zoom buttons) and the diagnostics under the frame-rate counter, and keeps the adaptive quality from changing so measurements stay the same. Applies after reloading. An address ending in #debug turns it on for one session.", control: { kind: "toggle" } },
    ],
  },
];

/** The desktop app's one setting of the Storage tab, shown as a row of the Workspace folder card. */
const DELETE_TO_ROW: Row = {
  key: "storage.deleteTo",
  label: "Deleted files go",
  help: "A library item once undo no longer needs it, a deleted canvas or board. Files in .trash travel with the folder and can be put back by hand.",
  control: { kind: "select", options: [["trash", "To .trash in the folder"], ["system", "To the system trash"], ["erase", "Deleted for good"]] },
};

/** The desktop app: a library file goes as soon as it is deleted instead of when undo no longer needs it. */
const DELETE_AT_ONCE_ROW: Row = {
  key: "storage.deleteAtOnce",
  label: "Delete library files at once",
  help: "A file deleted from the library leaves the folder at once (where the setting above sends it), even while undo on the open canvas could still put a picture of it back. Undoing then shows the picture as missing until its file is back in the library folder.",
  control: { kind: "toggle" },
};

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

function controlHtml(row: Row, id: string): string {
  const c = row.control;
  // The control is named by the label alone; the help text describes it.
  const a = `aria-labelledby="${id}-l"${row.help ? ` aria-describedby="${id}-h"` : ""}`;
  if (c.kind === "toggle") return `<input type="checkbox" id="${id}" data-set="${row.key}" ${a}>`;
  if (c.kind === "colour") return `<button type="button" class="set-colour" id="${id}" data-set="${row.key}" data-colour="${row.key}" aria-haspopup="dialog" ${a}><span class="set-colour-dot"></span><span class="set-colour-hex"></span></button>`;
  if (c.kind === "text") return `<input type="text" class="set-text" id="${id}" data-set="${row.key}" maxlength="${c.max}" placeholder="${esc(c.placeholder ?? "")}" autocomplete="off" spellcheck="false" ${a}>`;
  if (c.kind === "select") return `<select id="${id}" data-set="${row.key}" ${a}>${c.options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>`;
  const presets = c.hue ? `<span class="set-presets" role="group" aria-label="Theme colour presets">${c.hue.map(([n, d]) => `<button type="button" class="set-preset" data-preset="${row.key}" data-value="${d}" style="--p:${d}" aria-label="${esc(n)}" title="${esc(n)}"></button>`).join("")}${c.adaptive ? `<button type="button" class="set-preset set-adaptive" data-adaptive="${c.adaptive}" aria-pressed="false" aria-label="Adaptive" title="Adaptive: the theme colour takes the hue of the canvas background colour (it stays as set above while the background is the app's own or grey)">${ICONS.wandSparkles}</button>` : ""}</span>` : "";
  return `<input type="range" id="${id}" data-set="${row.key}" min="${c.min}" max="${c.max}" step="${c.step}" ${c.hue ? 'class="set-hue"' : ""} ${a}><output for="${id}"></output>${presets}`;
}

/** Mount the view into `root`; returns what main needs to show and hide it. */
/** What the Storage tab needs: the save state, the library folder, and backups (the same ones the workspace menu has). */
export interface BackupHooks {
  last(): Promise<{ at: number; kind: "full" | "incremental"; fileName: string; bytes: number } | null>;
  exportFull(): Promise<void>;
  exportChanges(): Promise<void>;
  exportFiles(): Promise<void>;
  importFiles(files: File[]): Promise<void>;
  readOnly(): boolean;
  /** How saving is going, in plain words, for the Saving card. */
  saving(): { state: string; error: string; lastVerified: string; role: string };
  /** Call `fn` when the save state changes. */
  onSaving(fn: () => void): void;
  /** Draw the library folder card into `host` (once), and again whenever called. */
  folder(host: HTMLElement): Promise<void>;
  /** Ask the browser to keep the data under storage pressure. */
  persist(): Promise<void>;
  /** Start from scratch: the warning, the suggestions before it, and the deletion. */
  reset(): Promise<void>;
  /** A password (of the Hidden items or of the whole workspace): whether there is one, and change it (null removes it). Resolves with a sentence to show. */
  password(kind: "hidden" | "workspace", action: "status" | "set" | "remove"): Promise<{ has: boolean; text: string }>;
}

const pwCard = (kind: "hidden" | "workspace", title: string, help: string): string => `<div class="set-info set-card" data-pw-card="${kind}"><h3>${esc(title)}</h3>
             <p class="set-help">${esc(help)}</p>
             <p data-pw-state role="status">…</p>
             <div class="storage-actions"><button type="button" data-pw="set" data-kind="${kind}" data-testid="${kind}-pw-set">Set a password…</button><button type="button" data-pw="remove" data-kind="${kind}" data-testid="${kind}-pw-remove" hidden>Remove the password…</button></div></div>`;

export function mountSettingsView(root: HTMLElement, settings: SettingsStore, keymap: Keymap, onClose: () => void, backup?: BackupHooks): { show(tab?: string): void; hide(): void } {
  const tabButton = (t: Tab): string => `<button type="button" role="tab" id="set-tab-${t.id}" aria-controls="set-panel-${t.id}" data-tab="${t.id}"><span class="set-tab-icon" aria-hidden="true">${ICONS[TAB_ICON[t.id] ?? "tabAbout"]}</span><span class="set-tab-label">${esc(t.label)}</span><span class="set-hits" aria-hidden="true"></span></button>`;
  const tabsHtml = TAB_GROUPS.map(
    ([title, ids]) => `<div class="set-tabs-h" role="presentation">${esc(title)}</div>${ids.map((id) => tabButton(SETTINGS_TABS.find((t) => t.id === id)!)).join("")}`,
  ).join("");
  const panelsHtml = SETTINGS_TABS.map((t) => {
    const rowHtml = (r: Row): string => {
      const id = `set-${r.key.replace(/\./g, "-")}`;
      const scope = SCOPE_LABEL[SETTINGS[r.key].scope];
      return `<div class="set-row" data-row="${r.key}"><label for="${id}"><span class="set-label" id="${id}-l">${esc(forDesktop(r.label))}</span>${r.help ? `<span class="set-help" id="${id}-h">${esc(forDesktop(r.help))}</span>` : ""}</label>
              <div class="set-control">${controlHtml(r, id)}</div><span class="set-scope" title="Where this setting is kept">${scope}</span>
              <button type="button" class="set-reset" data-reset="${r.key}" aria-label="Reset ${esc(r.label)} to its default" title="Reset to the default">${ICONS.settingReset}</button></div>`;
    };
    const body = t.rows
      ? cardsOf(t.rows)
          .map((c) => `<div class="set-card">${c.title ? `<h3>${esc(c.title)}</h3>` : ""}${c.rows.map(rowHtml).join("")}</div>`)
          .join("") +
        (t.id === "privacy"
          ? (DESKTOP
              ? pwCard("workspace", "Password for the workspace", "Asked when the app opens: nothing of the workspace is shown until it is given. It keeps people at your screen out; it does not encrypt your data, so someone who can open the workspace folder, or an exported file, is not stopped. It cannot be recovered: to change or remove it you enter the old one.") +
                pwCard("hidden", "Password for the Hidden items", "Hidden items are encrypted with it in the workspace folder: their files, names, tags and notes cannot be read without it. It is asked before the Hidden items open and before an export that includes them (an exported file is not encrypted). It cannot be recovered: if it is lost, so are the hidden items. It cannot be removed while items are hidden.")
              : pwCard("workspace", "Password for the workspace", "Asked when the app opens: nothing of the workspace is read or shown until it is given. It keeps people at your screen out; it does not encrypt your data, so someone with access to this browser's storage or to an exported file is not stopped. It cannot be recovered: to change or remove it you enter the old one.") +
                pwCard("hidden", "Password for the Hidden items", "A password asked before the Hidden items open and before an export that includes them. The same limits apply: it does not encrypt the files. It cannot be recovered either."))
          : t.id === "develop"
          ? `<div class="set-info set-card" data-develop><dl><dt>Version</dt><dd>${esc(document.documentElement.dataset["version"] ?? "")}</dd><dt>Build</dt><dd>${DESKTOP ? "The desktop app runs the same single file as the browser build." : "One file: this page. There is no separate debug build."}</dd></dl>
             <p class="set-note" data-dev-note role="status" hidden>Reload to apply the change. <button type="button" class="set-done" data-reload>Reload now</button></p></div>`
          : "")
      : t.id === "shortcuts"
        ? `<div class="set-info set-keys"><p>Every shortcut can be changed, to one key or to several together (Ctrl+Shift+F, Alt+Q). Press <strong>Change</strong>, then the keys you want; <strong>Add</strong> gives the command another key; the <strong>×</strong> takes a key away; Escape cancels. You are warned when a key is already used, or when the browser or the system may take it.</p>
           <p><button type="button" class="set-reset" data-keys-reset-all>Reset every shortcut</button></p>
           <div data-tool-keys></div><div class="set-note" data-key-note role="status" aria-live="polite"></div><h3 class="set-sub">Fixed shortcuts</h3>${FIXED_SHORTCUTS.map((g) => `<div class="set-card"><h4>${esc(g.group)}</h4><dl>${g.items.map((i) => `<dt><kbd>${esc(i.keys)}</kbd></dt><dd>${esc(i.does)}</dd>`).join("")}</dl></div>`).join("")}</div>`
      : t.id === "storage"
        ? (DESKTOP
            ? `<div class="set-info set-card" data-folder-card><h3>Workspace folder</h3><div data-folder-host></div>
             <p class="set-help">Your boards, canvases and library are files in this folder: back it up, sync it or copy it like any folder.</p>
             <div class="storage-actions"><button type="button" data-switch-workspace data-testid="set-switch-workspace" aria-haspopup="menu">${ICONS.arrowLeftRight}<span>Switch workspace…</span></button></div>
             ${rowHtml(DELETE_TO_ROW)}${rowHtml(DELETE_AT_ONCE_ROW)}</div>
           <div class="set-info set-card" data-storage><h3>Working copy</h3><p>The app also keeps a working copy of the workspace on this device, so every change is safe at once; the folder follows a moment after editing pauses.</p>
             <dl><dt>Used</dt><dd data-used>…</dd></dl></div>`
            : `<div class="set-info set-card" data-storage><h3>Space</h3><p>Your canvases are kept in this browser's storage, on this device, unless you keep the files in a library folder (next card).</p>
             <dl><dt>Used</dt><dd data-used>…</dd><dt>Available</dt><dd data-quota>…</dd><dt>Protected from clearing</dt><dd><span data-persisted>…</span> <button type="button" data-persist hidden>Ask the browser to keep it</button></dd></dl>
             <p><strong>Browser storage is not a backup.</strong> Clearing site data, or the browser's own clean-up, removes it. Keep a copy (Backup, below).</p></div>
           <div class="set-info set-card" data-folder-card><h3>Library folder</h3><div data-folder-host></div></div>`) +
          `<div class="set-info set-card" data-saving><h3>Saving</h3>
             <dl><dt>Status</dt><dd data-testid="storage-save-state" data-save-state>…</dd><dt>Last verified save</dt><dd data-save-verified>…</dd><dt>${DESKTOP ? "This window" : "This tab"}</dt><dd data-testid="storage-role" data-save-role>…</dd></dl>
             <p class="set-help">Every change is saved within a fraction of a second and read back to check${DESKTOP ? "; the workspace folder is written about 2 seconds after editing pauses, and when the app closes" : ""}. The indicator at the bottom shows the state; pressing it brings you here.</p></div>
           <div class="set-info set-card" data-backup><h3>Backup</h3>
             <p data-testid="set-last-backup" data-last-backup>…</p>
             <div class="action-rows">
               <div class="action-row"><button type="button" data-backup-action="full" data-testid="set-export-full">Export backup</button><span>One <code>.canvast</code> file with everything, including the files. Checked before it is handed over.</span></div>
               <div class="action-row"><button type="button" data-backup-action="changes" data-testid="set-export-changes">Export changes</button><span>Only what changed since the last backup: small. Keep it with the full backup and the earlier ones; restoring takes them all together. Needs a full backup first.</span></div>
               <div class="action-row"><button type="button" data-backup-action="files" data-testid="set-export-files">Export files</button><span>Just your original files as a ZIP, sorted by type or by your folders.</span></div>
               <div class="action-row"><button type="button" data-backup-action="import" data-testid="set-import">Import backup…</button><span>Add a backup (or a full one with its incremental ones, picked together) to this workspace; nothing existing is replaced.</span></div>
               <input type="file" multiple accept=".canvast,.zip,application/zip" hidden data-testid="set-import-input">
             </div>
             <p class="set-help">${DESKTOP ? "Each export asks where to save the file." : "The browser does not report whether a download finished, so keep the file somewhere safe."}</p></div>` +
          (DESKTOP
            ? `<div class="set-info set-card" data-reset-card><h3>Rebuild from the folder</h3>
             <p>Clears this device's working copy and reads the workspace again from its folder, for when something looks wrong. The files in the folder are not touched, and settings stay. (To delete a workspace, delete its folder.)</p>
             <div class="storage-actions"><button type="button" data-reset-all data-testid="reset-all">Rebuild from the folder…</button></div></div>`
            : `<div class="set-info set-card set-danger" data-reset-card><h3>Start from scratch</h3>
             <p>Deletes everything canvast keeps in this browser: all boards and canvases, the library, saved styles and settings. You are asked first, and offered a backup.</p>
             <div class="storage-actions"><button type="button" class="is-danger" data-reset-all data-testid="reset-all">Delete all data…</button></div></div>`)
        : t.id === "about"
          ? `<div class="set-info set-card"><h3 class="about-title"><span class="about-logo">${logoSvg()}</span>canvast <span data-testid="about-version">${esc(typeof __CANVAST_VERSION__ === "string" ? __CANVAST_VERSION__ : "dev")}</span></h3><p>${DESKTOP ? "An endless canvas that works offline: the desktop app, on a workspace folder. Drawing uses Canvas 2D." : "An endless canvas that works offline, in one file. Drawing uses the browser's Canvas 2D (the browser decides whether the graphics card helps)."}</p></div>
             <div class="set-info set-card"><h3>${DESKTOP ? "What this app can use" : "This browser"}</h3><dl data-testid="about-capabilities">${capabilities().map((c) => `<dt>${c.ok ? "✓" : "✗"} ${esc(c.name)}</dt><dd>${esc(c.note)}</dd>`).join("")}</dl></div>
             <div class="set-info set-card"><h3>Errors this session</h3><ul class="set-errors" data-testid="about-errors"></ul>
               <div class="storage-actions"><button type="button" data-about="report" data-testid="about-report">Save a diagnostic report</button><button type="button" data-about="clear" data-testid="about-clear">Clear the list</button></div>
               <p class="set-help">The report is a text file with the version, this browser, the numbers above and the errors. It holds no canvas content. canvast sends nothing: you send the file if you choose to.</p></div>
             <div class="set-info set-card"><h3>Licences</h3><details><summary>Software this app is built from</summary><pre class="set-licences" data-testid="about-licences">${esc(NOTICES)}</pre></details></div>`
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
    if (id === "privacy") for (const k of ["workspace", "hidden"] as const) void passwordCard(k, "status");
    if (id === "about") showErrors();
  };
  const showErrors = (): void => {
    const ul = root.querySelector<HTMLElement>("[data-testid=about-errors]");
    if (!ul) return;
    ul.innerHTML = errorLog().length ? errorLog().map((e) => `<li><time>${new Date(e.at).toLocaleTimeString()}</time> ${esc(e.what)}</li>`).join("") : "<li>none</li>";
  };
  onErrorLog(showErrors);
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-about]");
    if (!b) return;
    if (b.dataset["about"] === "clear") clearErrorLog();
    else {
      const blob = new Blob([diagnosticReport(backup ? { "Settings changed from the defaults": settings.changedKeys() } : {})], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `canvast-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    }
  });

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

  /** The Saving card: how saving is going. */
  const saving = (): void => {
    if (!backup) return;
    const v = backup.saving();
    const set = (sel: string, text: string): void => {
      const el = root.querySelector<HTMLElement>(sel);
      if (el) el.textContent = text;
    };
    set("[data-save-state]", v.error ? `${v.state}: ${v.error}` : v.state);
    set("[data-save-verified]", v.lastVerified);
    set("[data-save-role]", v.role);
  };
  backup?.onSaving(saving);

  const storage = async (): Promise<void> => {
    const set = (sel: string, text: string): void => {
      const el = root.querySelector<HTMLElement>(sel);
      if (el) el.textContent = text;
    };
    const mb = (n: number | undefined): string => (n === undefined ? "unknown" : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
    try {
      const est = await navigator.storage?.estimate?.();
      set("[data-used]", mb(est?.usage));
      set("[data-quota]", est?.quota !== undefined && est.usage !== undefined ? `${mb(est.quota)} (${Math.round((est.usage / est.quota) * 100)}% used)` : mb(est?.quota));
      const persisted = await navigator.storage?.persisted?.();
      set("[data-persisted]", persisted === undefined ? "unknown" : persisted ? "Yes" : "No (the browser may clear it when space is short)");
      const ask = root.querySelector<HTMLButtonElement>("[data-persist]");
      if (ask) ask.hidden = persisted !== false || !backup;
    } catch {
      set("[data-used]", "unknown");
      set("[data-quota]", "unknown");
      set("[data-persisted]", "unknown");
    }
    if (backup) {
      saving();
      const host = root.querySelector<HTMLElement>("[data-folder-host]");
      if (host) void backup.folder(host);
      const last = await backup.last();
      set("[data-last-backup]", last ? `Last backup: ${new Date(last.at).toLocaleString()} (${last.kind === "incremental" ? "incremental" : "full"}), ${last.fileName}, ${mb(last.bytes)}.` : "No backup made yet.");
      const ro = backup.readOnly();
      for (const b of root.querySelectorAll<HTMLButtonElement>("[data-backup-action]")) {
        const a = b.dataset["backupAction"];
        b.disabled = (ro && a === "import") || (!last && a === "changes"); // (changes go on from a backup: none yet, none to go on from)
      }
    }
  };
  /** A password card of Privacy: show whether there is a password, or change it and show the result. */
  const passwordCard = async (kind: "hidden" | "workspace", action: "status" | "set" | "remove"): Promise<void> => {
    if (!backup) return;
    const r = await backup.password(kind, action);
    const card = root.querySelector<HTMLElement>(`[data-pw-card="${kind}"]`)!;
    card.querySelector<HTMLElement>("[data-pw-state]")!.textContent = r.text;
    card.querySelector<HTMLElement>('[data-pw="set"]')!.textContent = r.has ? "Change the password…" : "Set a password…";
    card.querySelector<HTMLElement>('[data-pw="remove"]')!.hidden = !r.has;
  };
  root.addEventListener("click", (e) => {
    const pw = (e.target as HTMLElement).closest<HTMLElement>("[data-pw]");
    if (pw && backup) {
      void passwordCard(pw.dataset["kind"] as "hidden" | "workspace", pw.dataset["pw"] as "set" | "remove");
      return;
    }
    if (backup && (e.target as HTMLElement).closest("[data-reset-all]")) {
      void backup.reset();
      return;
    }
    if (backup && (e.target as HTMLElement).closest("[data-persist]")) {
      void backup.persist().then(() => storage());
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-backup-action]");
    if (!b || !backup) return;
    const a = b.dataset["backupAction"];
    if (a === "import") root.querySelector<HTMLInputElement>("[data-testid=set-import-input]")!.click();
    else void (a === "full" ? backup.exportFull() : a === "changes" ? backup.exportChanges() : backup.exportFiles()).then(() => storage());
  });
  root.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset["testid"] !== "set-import-input" || !backup) return;
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length) void backup.importFiles(files).then(() => storage());
  });

  /** The command waiting for its keys (Change replaces what it has, Add puts another beside it). */
  let capturing: { id: string; mode: "replace" | "add" } | null = null;
  /** A choice that needs a word from the person first: a warning, or a key another command has. */
  let pending: { id: string; mode: "replace" | "add"; combo: string; owners: KeyCommand[]; why: string } | null = null;
  const nameOf = (id: string): string => KEY_COMMANDS.find((c) => c.id === id)!.name;
  const renderKeys = (): void => {
    const host = root.querySelector<HTMLElement>("[data-tool-keys]");
    if (!host) return;
    let group = "";
    host.innerHTML = KEY_COMMANDS.map((c) => {
      const head = c.group !== group ? `${group ? "</div>" : ""}<div class="set-card"><h3>${esc(c.group)}</h3>` : "";
      group = c.group;
      const chips = keymap.bindings(c.id).length
        ? keymap.bindings(c.id).map((b) => `<span class="set-chip"><kbd class="set-key">${esc(displayCombo(b))}</kbd><button type="button" class="set-chip-x" data-key-remove="${c.id}" data-combo="${esc(b)}" aria-label="Take ${esc(displayCombo(b))} away from ${esc(c.name)}">×</button></span>`).join("")
        : `<span class="set-none">no key</span>`;
      const waiting = capturing?.id === c.id ? `<kbd class="set-key is-waiting">press the keys…</kbd>` : "";
      return `${head}<div class="set-row set-keyrow" data-key-row="${c.id}"><span class="set-label">${esc(c.name)}</span>
        <div class="set-control">${chips}${waiting}<button type="button" class="set-reset" data-change-key="${c.id}" data-mode="replace" aria-label="Change the keys for ${esc(c.name)}">Change</button><button type="button" class="set-reset" data-change-key="${c.id}" data-mode="add" aria-label="Add a key for ${esc(c.name)}">Add</button>
        <span class="set-scope">This device</span><button type="button" class="set-reset" data-key-reset="${c.id}" aria-label="Reset the keys for ${esc(c.name)} to their default"${keymap.isDefault(c.id) ? " disabled" : ""}>Reset</button></div></div>`;
    }).join("") + "</div>";
  };
  const keyNote = (text: string): void => {
    const n = root.querySelector<HTMLElement>("[data-key-note]");
    if (n) n.textContent = text;
    pending = null;
  };
  /** Give `combo` to a command (replacing its keys, or beside them), taking it from the commands in `owners`. */
  const bind = (id: string, mode: "replace" | "add", combo: string, owners: readonly KeyCommand[]): void => {
    for (const o of owners) keymap.set(o.id, keymap.bindings(o.id).filter((c) => c !== combo));
    keymap.set(id, mode === "replace" ? [combo] : [...keymap.bindings(id), combo]);
  };
  const askNote = (text: string, yes: string): void => {
    const n = root.querySelector<HTMLElement>("[data-key-note]");
    if (!n) return;
    n.innerHTML = `<span>${esc(text)}</span> <button type="button" class="set-reset" data-key-yes>${esc(yes)}</button> <button type="button" class="set-reset" data-key-no>Cancel</button>`;
  };
  const all = [...SETTINGS_TABS.flatMap((t) => t.rows ?? []), ...(DESKTOP ? [DELETE_TO_ROW, DELETE_AT_ONCE_ROW] : [])];
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
      if (r.control.kind === "range" && r.control.adaptive) {
        const on = settings.get(r.control.adaptive) === true;
        root.querySelector(`[data-adaptive="${r.control.adaptive}"]`)?.setAttribute("aria-pressed", String(on));
        (el as HTMLInputElement).disabled = on;
      }
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
    const adaptive = t.closest<HTMLElement>("[data-adaptive]");
    if (adaptive) return void settings.set(adaptive.dataset["adaptive"] as SettingKey, !settings.get(adaptive.dataset["adaptive"] as SettingKey) as never);
    const preset = t.closest<HTMLElement>("[data-preset]");
    if (preset) return void settings.set(preset.dataset["preset"] as SettingKey, Number(preset.dataset["value"]) as never);
    const change = t.closest<HTMLElement>("[data-change-key]");
    if (change) {
      capturing = { id: change.dataset["changeKey"]!, mode: change.dataset["mode"] === "add" ? "add" : "replace" };
      keymap.capturing = true;
      keyNote("");
      renderKeys();
      root.querySelector<HTMLElement>(`[data-change-key="${capturing.id}"][data-mode="${capturing.mode}"]`)?.focus();
      return;
    }
    const drop = t.closest<HTMLElement>("[data-key-remove]");
    if (drop) {
      const id = drop.dataset["keyRemove"]!;
      keymap.set(id, keymap.bindings(id).filter((c) => c !== drop.dataset["combo"]));
      return keyNote(`${nameOf(id)}: ${drop.dataset["combo"]} taken away.${keymap.bindings(id).length ? "" : " It has no key now."}`);
    }
    const resetKey = t.closest<HTMLElement>("[data-key-reset]");
    if (resetKey) {
      keymap.reset(resetKey.dataset["keyReset"]!);
      return keyNote(`${nameOf(resetKey.dataset["keyReset"]!)}: back to its own keys.`);
    }
    if (t.closest("[data-keys-reset-all]")) {
      settings.reset("keys.custom" as SettingKey);
      return keyNote("Every shortcut is back to its own keys.");
    }
    if (t.closest("[data-key-yes]") && pending) {
      const p = pending;
      bind(p.id, p.mode, p.combo, p.owners);
      return keyNote(`${nameOf(p.id)}: ${displayCombo(p.combo)}.${p.owners.length ? ` ${p.owners.map((o) => o.name).join(" and ")} has no longer that key.` : ""}`);
    }
    if (t.closest("[data-key-no]")) return keyNote("Cancelled: nothing changed.");
    const reset = t.closest<HTMLElement>("[data-reset]");
    if (reset) return settings.reset(reset.dataset["reset"] as SettingKey);
    if (t.closest("[data-reload]")) location.reload();
    const sw = t.closest<HTMLElement>("[data-switch-workspace]");
    if (sw) void openWorkspaceSwitcher(sw);
    if (t.closest("[data-done]")) onClose();
  });
  /** Stop waiting for keys (focus moved away, another tab, or the view closed): nothing changes. */
  const cancelCapture = (): void => {
    if (!capturing) return;
    capturing = null;
    keymap.capturing = false;
    renderKeys();
  };
  root.addEventListener("pointerdown", (e) => {
    if (capturing && !(e.target as HTMLElement).closest(`[data-change-key="${capturing.id}"]`)) cancelCapture();
  });
  // While waiting for keys every key press is for the command being changed, wherever the focus is (a click elsewhere cancels).
  window.addEventListener(
    "keydown",
    (e) => {
      if (!capturing || root.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        cancelCapture();
        keyNote("Cancelled: nothing changed.");
        return;
      }
      const combo = comboOfEvent(e);
      if (!combo) return; // (a modifier alone: wait for the key it goes with)
      const { id, mode } = capturing;
      capturing = null;
      keymap.capturing = false;
      const v = judge(combo, id);
      const owners = keymap.owners(combo, id);
      const shown = displayCombo(combo);
      if (v.level === "refuse") keyNote(v.why);
      else if (v.level === "warn" || owners.length) {
        keyNote("");
        const why = [v.level === "warn" ? v.why : "", owners.length ? `${shown} is already the key for ${owners.map((o) => o.name).join(" and ")}.` : ""].filter(Boolean).join(" ");
        pending = { id, mode, combo, owners, why };
        askNote(why, owners.length ? `Use ${shown} for ${nameOf(id)}, not for ${owners.map((o) => o.name).join(" and ")}` : `Use ${shown} anyway`);
      } else {
        bind(id, mode, combo, []);
        keyNote(`${nameOf(id)}: ${shown}.${v.level === "note" ? " " + v.why : ""}`);
      }
      renderKeys();
      root.querySelector<HTMLElement>(`[data-change-key="${id}"]`)?.focus();
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
  const tabRow = root.querySelector<HTMLElement>(".set-tabs")!;
  window.addEventListener("resize", () => syncScroll(tabRow));
  // The context menu (right click, long touch): on a setting its reset, on a shortcut its key actions: the row's own buttons, pressed.
  const ROW_ACTIONS: ReadonlyArray<readonly [selector: string, label: string, icon?: string]> = [
    ["[data-reset]", "Reset to the default", ICONS.settingReset],
    ['[data-change-key][data-mode="replace"]', "Change the keys…"],
    ['[data-change-key][data-mode="add"]', "Add a key…"],
    ["[data-key-reset]", "Reset the keys", ICONS.settingReset],
  ];
  bindContextMenu(root, {
    label: "Setting actions",
    active: () => !root.hidden,
    build: ({ target }) => {
      const row = target.closest<HTMLElement>(".set-row");
      if (!row) return null;
      const items = ROW_ACTIONS.flatMap(([sel, label, icon]): MenuItem[] => {
        const b = row.querySelector<HTMLButtonElement>(sel);
        return b ? [{ label, ...(icon ? { icon } : {}), disabled: b.disabled, run: () => b.click() }] : [];
      });
      return items.length ? items : null;
    },
  });

  return {
    show(tab?: string) {
      root.hidden = false;
      refresh();
      select(tab && tabs.some((t) => t.dataset["tab"] === tab) ? tab : current);
      root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
      syncScroll(tabRow);
    },
    hide() {
      cancelCapture();
      root.hidden = true;
    },
  };
}
