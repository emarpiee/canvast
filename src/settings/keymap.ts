/**
 * The keymap (ADR 0158): every key shortcut is a command with a binding the person can change in Settings > Shortcuts, as one key or a chord
 * (F, Ctrl+Shift+F, Alt+Q). The code that does the work still listens for one fixed key for each command (its `internal` combo); a small layer
 * in front of it (`installKeymap`) turns the key that is pressed into that internal key, and swallows an internal key whose command was given
 * another binding. So no handler needs to know about the person's choices.
 */
import type { SettingsStore } from "./settings";

/** A key chord as text: modifiers in the order Ctrl, Alt, Shift, then the key ("Ctrl+Shift+F", "Alt+Q", "F", "Space", "ArrowLeft"). Ctrl stands for Cmd too. */
export type Combo = string;

interface Parts {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const NAMED: Record<string, string> = {
  space: "Space", spacebar: "Space", esc: "Escape", escape: "Escape", enter: "Enter", return: "Enter", tab: "Tab", backspace: "Backspace", del: "Delete", delete: "Delete",
  home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown", insert: "Insert", left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown",
  arrowleft: "ArrowLeft", arrowright: "ArrowRight", arrowup: "ArrowUp", arrowdown: "ArrowDown",
};

const isLetterOrDigit = (k: string): boolean => /^[A-Z0-9]$/.test(k);

/** A combo as its parts, or null when the text is not one. */
export function parseCombo(text: string): Parts | null {
  const m = /^((?:(?:ctrl|control|cmd|meta|alt|option|shift)\+)*)(.+)$/i.exec(text.trim());
  if (!m) return null;
  const mods = m[1]!.toLowerCase().split("+").filter(Boolean);
  let key = m[2]!;
  if (/^f([1-9]|1[0-2])$/i.test(key)) key = key.toUpperCase();
  else if (key.length === 1) key = key === " " ? "Space" : key.toUpperCase();
  else key = NAMED[key.toLowerCase()] ?? "";
  if (!key) return null;
  const shiftable = isLetterOrDigit(key) || key.length > 1;
  return {
    ctrl: mods.some((x) => x === "ctrl" || x === "control" || x === "cmd" || x === "meta"),
    alt: mods.some((x) => x === "alt" || x === "option"),
    shift: mods.includes("shift") && shiftable, // (a shifted symbol is the symbol: "+" is "+", not "Shift+=")
    key,
  };
}

export function formatCombo(p: Parts): Combo {
  return [p.ctrl ? "Ctrl" : "", p.alt ? "Alt" : "", p.shift ? "Shift" : "", p.key].filter(Boolean).join("+");
}

/** The canonical text of a combo (null when it is not one). */
export function normalizeCombo(text: string): Combo | null {
  const p = parseCombo(text);
  return p ? formatCombo(p) : null;
}

/** The combo of a key event (null for a press of a modifier alone). */
export function comboOfEvent(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): Combo | null {
  const k = e.key;
  if (k === "Control" || k === "Shift" || k === "Alt" || k === "Meta" || k === "AltGraph" || k === "CapsLock" || k === "Dead" || k === "Unidentified") return null;
  let key: string;
  if (e.altKey && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3); // (Alt changes the letter on some systems: the key itself is meant)
  else if (e.altKey && /^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (k === " ") key = "Space";
  else if (k.length === 1) key = k.toUpperCase();
  else key = /^F([1-9]|1[0-2])$/.test(k) ? k : (NAMED[k.toLowerCase()] ?? k);
  return formatCombo({ ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey && (isLetterOrDigit(key) || key.length > 1), key });
}

/** What to dispatch so that the handlers see this combo pressed. */
export function eventInit(combo: Combo, repeat = false): KeyboardEventInit {
  const p = parseCombo(combo)!;
  const letter = /^[A-Z]$/.test(p.key);
  return {
    key: p.key === "Space" ? " " : letter ? (p.shift ? p.key : p.key.toLowerCase()) : p.key,
    code: p.key === "Space" ? "Space" : letter ? `Key${p.key}` : /^[0-9]$/.test(p.key) ? `Digit${p.key}` : p.key,
    ctrlKey: p.ctrl,
    altKey: p.alt,
    shiftKey: p.shift,
    repeat,
    bubbles: true,
    cancelable: true,
  };
}

/** How a combo reads in the interface ("Ctrl+Shift+F"; a bare letter as itself). */
export const displayCombo = (c: Combo): string => c.replace("ArrowLeft", "Left").replace("ArrowRight", "Right").replace("ArrowUp", "Up").replace("ArrowDown", "Down");

/** `canvas`: on the canvas only; `paint`: in the Painting view only; `both`: on the canvas and in the Painting view (its vector tools are the
 * canvas's, ADR 0168); `global`: also in the Library. */
export type KeyScope = "canvas" | "paint" | "both" | "global";
/** The view a key is pressed in, as commands are scoped. */
export type KeyView = "canvas" | "paint" | "global" | "none";
/** Whether a command works in a view. */
export const inView = (scope: KeyScope, view: KeyView): boolean =>
  view === "canvas" ? scope !== "paint" : view === "paint" ? scope !== "canvas" : view === "global" && scope === "global";

export interface KeyCommand {
  readonly id: string;
  readonly name: string;
  readonly group: string;
  /** The combos the handlers listen for; the first is the one a binding is turned into. */
  readonly internal: readonly Combo[];
  /** What the command is bound to at first. */
  readonly defaults: readonly Combo[];
  /** Where the command works (the Library and Settings have their own keys). */
  readonly scope: KeyScope;
}

const cmd = (id: string, name: string, group: string, internal: Combo | readonly Combo[], defaults?: Combo | readonly Combo[], scope: KeyScope = "canvas"): KeyCommand => {
  const i = typeof internal === "string" ? [internal] : internal;
  const d = defaults === undefined ? i : typeof defaults === "string" ? [defaults] : defaults;
  return { id, name, group, internal: i, defaults: d, scope };
};

export const TOOLS_GROUP = "Tools";
export const STEP_GROUP = "Step to the next item";
export const VIEW_GROUP = "View";
export const FIND_GROUP = "Find and commands";
export const EDIT_GROUP = "Editing";
export const BOOKMARK_GROUP = "Bookmarks";

/** Every command that has a key, in the order Settings lists them. */
export const KEY_COMMANDS: readonly KeyCommand[] = [
  cmd("tool.hand", "Hand (pan)", TOOLS_GROUP, "H", undefined, "both"),
  cmd("tool.select", "Select", TOOLS_GROUP, "V", undefined, "both"),
  cmd("tool.node", "Edit nodes", TOOLS_GROUP, "N", undefined, "both"),
  cmd("tool.pen", "Pen", TOOLS_GROUP, "P", undefined, "both"),
  cmd("tool.shape", "Shape", TOOLS_GROUP, "U", undefined, "both"),
  // (in the Painting view B is the Brush, as in painting programs; on the canvas it stays the Path tool: the first command a key is bound to in a view has it)
  cmd("tool.brush", "Brush (Painting view)", TOOLS_GROUP, "B", undefined, "paint"),
  cmd("tool.path", "Path (curves)", TOOLS_GROUP, "B"),
  // (Shift+B as in painting programs; the handlers hear Y, a key no command has)
  cmd("tool.pencil", "Pencil (Painting view)", TOOLS_GROUP, "Y", "Shift+B", "paint"),
  cmd("tool.sheet", "Sheet", TOOLS_GROUP, "C"),
  cmd("tool.lasso", "Lasso", TOOLS_GROUP, "L", undefined, "both"),
  cmd("tool.text", "Text", TOOLS_GROUP, "T", undefined, "both"),
  cmd("tool.note", "Note", TOOLS_GROUP, "M"),
  cmd("tool.eyedropper", "Eyedropper", TOOLS_GROUP, "I", undefined, "both"),
  cmd("tool.eraser", "Eraser", TOOLS_GROUP, "E", undefined, "both"),
  cmd("nav.up", "Step up", STEP_GROUP, "W"),
  cmd("nav.left", "Step left", STEP_GROUP, "A"),
  cmd("nav.down", "Step down", STEP_GROUP, "S"),
  cmd("nav.right", "Step right", STEP_GROUP, "D"),
  cmd("view.focus", "Bring the selection into view; again: fit everything visible", VIEW_GROUP, "Ctrl+Space", "F"),
  cmd("view.zen", "Zen mode", VIEW_GROUP, "Z"),
  cmd("view.zoomIn", "Zoom in", VIEW_GROUP, ["+", "="], undefined, "both"),
  cmd("view.zoomOut", "Zoom out", VIEW_GROUP, ["-", "_"], undefined, "both"),
  cmd("view.home", "Return to the origin", VIEW_GROUP, ["0", "Home"]),
  cmd("view.panLeft", "Pan left", VIEW_GROUP, "ArrowLeft"),
  cmd("view.panRight", "Pan right", VIEW_GROUP, "ArrowRight"),
  cmd("view.panUp", "Pan up", VIEW_GROUP, "ArrowUp"),
  cmd("view.panDown", "Pan down", VIEW_GROUP, "ArrowDown"),
  cmd("view.panHold", "Pan with any tool (hold, and drag)", VIEW_GROUP, "Space", undefined, "both"),
  cmd("view.back", "Previous view", VIEW_GROUP, "Alt+Shift+ArrowLeft"),
  cmd("view.forward", "Next view", VIEW_GROUP, "Alt+Shift+ArrowRight"),
  cmd("bookmark.prev", "Go to the previous bookmark", BOOKMARK_GROUP, "["),
  cmd("bookmark.next", "Go to the next bookmark", BOOKMARK_GROUP, "]"),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => cmd(`bookmark.${n}`, `Go to bookmark ${n}`, BOOKMARK_GROUP, `Alt+${n}`)),
  cmd("find.palette", "The command palette", FIND_GROUP, ["Ctrl+K", "Ctrl+Shift+P"], undefined, "global"),
  cmd("find.slash", "The command palette (a plain key)", FIND_GROUP, "/"),
  cmd("find.canvas", "Search the canvas by file or layer name", FIND_GROUP, "Ctrl+F", undefined, "global"),
  cmd("find.library", "Go to the Library and search it", FIND_GROUP, "Ctrl+Shift+F", undefined, "global"),
  cmd("find.tag", "Search the canvas by tag", FIND_GROUP, "#"),
  cmd("find.bookmark", "Search the canvas for a bookmark", FIND_GROUP, "@"),
  cmd("find.help", "Open the shortcut list", FIND_GROUP, "?"),
  cmd("edit.undo", "Undo", EDIT_GROUP, "Ctrl+Z", undefined, "both"),
  cmd("edit.redo", "Redo", EDIT_GROUP, ["Ctrl+Shift+Z", "Ctrl+Y"], undefined, "both"),
  cmd("edit.selectAll", "Select everything", EDIT_GROUP, "Ctrl+A", undefined, "both"),
  cmd("edit.duplicate", "Duplicate", EDIT_GROUP, "Ctrl+D", undefined, "both"),
  cmd("edit.group", "Group", EDIT_GROUP, "Ctrl+G", undefined, "both"),
  cmd("edit.ungroup", "Ungroup", EDIT_GROUP, "Ctrl+Shift+G", undefined, "both"),
  cmd("edit.front", "Bring to front", EDIT_GROUP, "Ctrl+]", undefined, "both"),
  cmd("edit.back", "Send to back", EDIT_GROUP, "Ctrl+[", undefined, "both"),
  cmd("edit.flatten", "Flatten: text to paths, a boolean group to one path", EDIT_GROUP, "Ctrl+E", undefined, "both"),
  cmd("edit.delete", "Delete the selection", EDIT_GROUP, ["Delete", "Backspace"], undefined, "both"),
];

const BY_ID = new Map(KEY_COMMANDS.map((c) => [c.id, c] as const));
export const commandById = (id: string): KeyCommand | undefined => BY_ID.get(id);

/** The tool and step commands, by the setting that held their letter before the keymap (moved over once). */
const LEGACY: ReadonlyArray<readonly [setting: string, id: string]> = [
  ["key.hand", "tool.hand"], ["key.select", "tool.select"], ["key.node", "tool.node"], ["key.pen", "tool.pen"], ["key.shape", "tool.shape"], ["key.path", "tool.path"],
  ["key.sheet", "tool.sheet"], ["key.lasso", "tool.lasso"], ["key.text", "tool.text"], ["key.note", "tool.note"], ["key.eraser", "tool.eraser"],
  ["key.navUp", "nav.up"], ["key.navLeft", "nav.left"], ["key.navDown", "nav.down"], ["key.navRight", "nav.right"], ["key.zen", "view.zen"],
];

// ---- what to warn about ---------------------------------------------------------------------------------------------------------------

export type Verdict =
  | { level: "ok" }
  /** Cannot be used: the combo would never reach the page, or means something that must not change. */
  | { level: "refuse"; why: string }
  /** Can be used, but the person should know (they confirm). */
  | { level: "warn"; why: string }
  /** Said, nothing to confirm. */
  | { level: "note"; why: string };

/** Combos the browser keeps for itself: a page never sees them. */
const BROWSER_KEEPS = new Set(["Ctrl+W", "Ctrl+T", "Ctrl+N", "Ctrl+Shift+N", "Ctrl+Shift+T", "Ctrl+Shift+W", "Ctrl+Tab", "Ctrl+Shift+Tab", "Ctrl+PageUp", "Ctrl+PageDown", "Alt+F4", "Ctrl+Q", "Ctrl+Shift+Q", "Alt+Home", "F11"]);
/** Combos a page can take, but the browser has a job for them that people expect. */
const BROWSER_USES = new Map<string, string>([
  ["Ctrl+S", "save the page"], ["Ctrl+P", "print"], ["Ctrl+R", "reload"], ["Ctrl+Shift+R", "reload"], ["F5", "reload"], ["Ctrl+L", "the address bar"], ["Ctrl+O", "open a file"],
  ["Ctrl+U", "view the source"], ["Ctrl+H", "the history"], ["Ctrl+J", "the downloads"], ["Ctrl+Shift+I", "the developer tools"], ["Ctrl+Shift+J", "the developer tools"],
  ["Ctrl+Shift+C", "the developer tools"], ["F12", "the developer tools"], ["F1", "help"], ["Ctrl+B", "the bookmarks bar"], ["Ctrl+Shift+B", "the bookmarks bar"],
  ["Ctrl++", "the browser's zoom"], ["Ctrl+-", "the browser's zoom"], ["Ctrl+0", "the browser's zoom"], ["Ctrl+=", "the browser's zoom"], ["Alt+ArrowLeft", "Back"], ["Alt+ArrowRight", "Forward"],
  ["Ctrl+Shift+Delete", "clear the browsing data"], ["F6", "the address bar"], ["F7", "caret browsing"], ["F3", "find"], ["Ctrl+G", "find next"], ["Ctrl+D", "bookmark the page"],
]);
/** Combos the system often takes before any program sees them. */
const SYSTEM_USES = new Map<string, string>([
  ["Ctrl+Space", "switching the input method on many systems (IBus, Fcitx, macOS)"], ["Alt+Space", "the window menu"], ["Alt+Tab", "switching windows"],
  ["Alt+Shift", "switching the keyboard layout"], ["Ctrl+Alt+Delete", "the system"], ["Alt+Shift+Tab", "switching windows"], ["F10", "the window menu"],
]);
/** Keys the text editor and text fields use while typing. */
const TYPING_USES = new Map<string, string>([["Ctrl+B", "bold"], ["Ctrl+I", "italic"], ["Ctrl+U", "underline"], ["Ctrl+K", "a link"], ["Ctrl+Z", "undo"], ["Ctrl+A", "select all"], ["Ctrl+C", "copy"], ["Ctrl+X", "cut"], ["Ctrl+V", "paste"]]);

/** What to say about a person choosing `combo` for `commandId` (conflicts with other commands are asked of the keymap). */
export function judge(combo: Combo, commandId: string): Verdict {
  const p = parseCombo(combo);
  if (!p) return { level: "refuse", why: "That is not a key." };
  if (p.key === "Escape") return { level: "refuse", why: "Escape always cancels what is going on: it cannot be given to a command." };
  if (p.key === "Tab" && !p.ctrl && !p.alt) return { level: "refuse", why: "Tab moves between the buttons: it cannot be given to a command." };
  if (p.key === "Enter" && !p.ctrl && !p.alt && !p.shift) return { level: "refuse", why: "Enter finishes what is being edited: it cannot be given to a command." };
  if (BROWSER_KEEPS.has(combo)) return { level: "refuse", why: `The browser keeps ${displayCombo(combo)} for itself: the page never sees it.` };
  if (p.ctrl && p.alt && /^[A-Z0-9]$/.test(p.key)) return { level: "warn", why: `${displayCombo(combo)} is how some keyboards (and Windows) type another character with AltGr: it may not arrive as you press it.` };
  const sys = SYSTEM_USES.get(combo);
  if (sys) return { level: "warn", why: `${displayCombo(combo)} is used for ${sys}: it may never reach the page.` };
  const web = BROWSER_USES.get(combo);
  if (web) return { level: "warn", why: `${displayCombo(combo)} is the browser's key to ${web}. Canvast takes it while the canvas is in front, so that does not work here.` };
  if (p.alt && !p.ctrl && /^[A-Z]$/.test(p.key)) return { level: "warn", why: `${displayCombo(combo)} can open a menu of the browser or the system on some computers (Alt and a letter).` };
  const typing = TYPING_USES.get(combo);
  const bare = !p.ctrl && !p.alt;
  if (typing && commandId !== "edit.undo") return { level: "note", why: `${displayCombo(combo)} is also ${typing} while a text is typed or edited: there it keeps that job.` };
  if (bare && p.key.length === 1) return { level: "note", why: "A key on its own does nothing while you type in a field or edit a text." };
  return { level: "ok" };
}

// ---- the keymap ---------------------------------------------------------------------------------------------------------------------------

const CUSTOM_KEY = "keys.custom";

export class Keymap {
  /** Set while Settings waits for a key to give to a command: nothing is turned into anything then. */
  capturing = false;
  private custom: Record<string, Combo[]> = {};
  private readonly listeners = new Set<() => void>();

  constructor(private readonly settings: SettingsStore) {
    this.load();
    this.migrate();
    settings.subscribe((k) => {
      if (k === CUSTOM_KEY) {
        this.load();
        for (const fn of this.listeners) fn();
      }
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private load(): void {
    this.custom = {};
    try {
      const raw = JSON.parse(String(this.settings.get(CUSTOM_KEY as never) ?? "{}")) as unknown;
      if (raw && typeof raw === "object") {
        for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
          if (!BY_ID.has(id) || !Array.isArray(list)) continue;
          this.custom[id] = list.map((c) => (typeof c === "string" ? normalizeCombo(c) : null)).filter((c): c is Combo => c !== null);
        }
      }
    } catch {
      this.custom = {};
    }
  }

  /** The letters chosen in Settings before the keymap existed become bindings of the same commands. */
  private migrate(): void {
    let changed = false;
    for (const [setting, id] of LEGACY) {
      const letter = this.settings.get(setting as never) as unknown;
      const def = BY_ID.get(id)!.defaults[0]!;
      if (typeof letter === "string" && letter.toUpperCase() !== def && this.custom[id] === undefined) {
        this.custom[id] = [letter.toUpperCase()];
        changed = true;
      }
      if (typeof letter === "string" && letter.toUpperCase() !== def) this.settings.reset(setting as never);
    }
    if (changed) this.save();
  }

  private save(): void {
    const out: Record<string, Combo[]> = {};
    for (const [id, list] of Object.entries(this.custom)) {
      const def = BY_ID.get(id)!.defaults;
      if (list.length !== def.length || list.some((c, i) => c !== def[i])) out[id] = list;
    }
    this.settings.set(CUSTOM_KEY as never, JSON.stringify(out) as never);
  }

  /** What a command is bound to now (empty: nothing). */
  bindings(id: string): readonly Combo[] {
    return this.custom[id] ?? BY_ID.get(id)?.defaults ?? [];
  }

  isDefault(id: string): boolean {
    const b = this.bindings(id);
    const d = BY_ID.get(id)!.defaults;
    return b.length === d.length && b.every((c, i) => c === d[i]);
  }

  set(id: string, combos: readonly Combo[]): void {
    this.custom[id] = [...new Set(combos)];
    this.save();
  }

  reset(id: string): void {
    delete this.custom[id];
    this.save();
  }

  /** How the first binding of a command reads ("Ctrl+Z", "F"), or "" when it has none. */
  display(id: string): string {
    const b = this.bindings(id)[0];
    return b ? displayCombo(b) : "";
  }

  /** The commands `combo` is bound to now, apart from `except` (and, with `except`, only those that work in a view it works in too). */
  owners(combo: Combo, except?: string): KeyCommand[] {
    const mine = except ? BY_ID.get(except)?.scope : undefined;
    const meet = (c: KeyCommand): boolean => !mine || (["canvas", "paint", "global"] as const).some((v) => inView(mine, v) && inView(c.scope, v));
    return KEY_COMMANDS.filter((c) => c.id !== except && meet(c) && this.bindings(c.id).includes(combo));
  }

  /** What to do with a key press: leave it, swallow it, or let the handlers see `to` instead. */
  resolve(combo: Combo, view: KeyView): { kind: "pass" } | { kind: "swallow" } | { kind: "to"; combo: Combo } {
    const allowed = (c: KeyCommand): boolean => inView(c.scope, view);
    const owner = KEY_COMMANDS.find((c) => allowed(c) && this.bindings(c.id).includes(combo));
    if (owner) return owner.internal.includes(combo) ? { kind: "pass" } : { kind: "to", combo: owner.internal[0]! };
    // an internal key of a command that has been given other keys no longer works
    const lost = KEY_COMMANDS.find((c) => allowed(c) && c.internal.includes(combo));
    return lost ? { kind: "swallow" } : { kind: "pass" };
  }

  /** The key a handler should listen for to do a command (its internal one). */
  internalOf(id: string): Combo {
    return BY_ID.get(id)!.internal[0]!;
  }
}

/**
 * Put the keymap in front of every key handler (call it before any of them is added). A key pressed that is bound to a command is sent on as
 * the key that command's handler listens for; a key that was a command's own and has been given up is dropped. The key up follows its key down.
 */
export function installKeymap(map: Keymap, win: Window = window): void {
  let sending = false;
  const held = new Map<string, Combo>(); // event.code → the key sent on, so that its key up is sent on too
  const scopeOf = (e: KeyboardEvent): KeyView => {
    if (map.capturing) return "none";
    const t = e.target as HTMLElement | null;
    const view = document.body.dataset["view"] ?? "canvas";
    const modified = e.ctrlKey || e.metaKey || e.altKey;
    const typing = !!t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === "INPUT" && !/^(range|checkbox|radio|button|color)$/.test((t as HTMLInputElement).type)));
    if (typing && !modified) return "none";
    if (t?.closest?.("dialog") && !modified) return "none";
    if (view === "canvas" || view === "paint") return view;
    return view === "assets" ? "global" : "none";
  };
  const onDown = (e: KeyboardEvent): void => {
    if (sending) return;
    const combo = comboOfEvent(e);
    if (!combo) return;
    const r = map.resolve(combo, scopeOf(e));
    if (r.kind === "pass") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (r.kind === "swallow") return;
    held.set(e.code, r.combo);
    sending = true;
    try {
      (e.target ?? win).dispatchEvent(new KeyboardEvent("keydown", eventInit(r.combo, e.repeat)));
    } finally {
      sending = false;
    }
  };
  const onUp = (e: KeyboardEvent): void => {
    if (sending) return;
    const sent = held.get(e.code);
    if (sent === undefined) return;
    held.delete(e.code);
    e.stopImmediatePropagation();
    sending = true;
    try {
      (e.target ?? win).dispatchEvent(new KeyboardEvent("keyup", eventInit(sent)));
    } finally {
      sending = false;
    }
  };
  win.addEventListener("keydown", onDown, true);
  win.addEventListener("keyup", onUp, true);
}
