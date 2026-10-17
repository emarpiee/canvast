/**
 * The command palette (ADR 0117): Ctrl+K (or Ctrl+Shift+P) opens a box that finds any command by words, shows its key, and runs it. The
 * list of commands comes from the app (what is possible now: `enabled`), so the palette has no list of its own to keep up to date.
 */
import { esc } from "./format";

export interface Command {
  /** What it is called, without the group ("Select", "Zoom in"). */
  title: string;
  /** The kind of command: shown first in the row and matched too ("Tool", "View", "Settings"). */
  group: string;
  /** Its key or shortcut, when it has one. */
  keys?: string;
  /** Extra words that find it ("redo" for "Undo"). */
  words?: string;
  /** False when it cannot be done now: it is not offered. */
  enabled?: () => boolean;
  run(): void;
}

const MAX_SHOWN = 60;

/** The commands that match `query` (every word of it in the group, title or extra words), best first: a title that starts with a word, then shorter titles. */
export function findCommands(all: readonly Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: Array<{ c: Command; score: number }> = [];
  for (const c of all) {
    if (c.enabled && !c.enabled()) continue;
    const title = c.title.toLowerCase();
    const hay = `${c.group} ${c.title} ${c.words ?? ""}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    let score = 0;
    for (const w of words) score += title.startsWith(w) ? 3 : title.includes(` ${w}`) ? 2 : title.includes(w) ? 1 : 0;
    scored.push({ c, score: score * 100 - title.length });
  }
  // without a query, the commands stay in the order the app listed them (grouped)
  return (words.length ? scored.sort((a, b) => b.score - a.score) : scored).map((s) => s.c);
}

export function mountCommandPalette(commands: () => readonly Command[]): { open(): void; close(): void } {
  const root = document.createElement("div");
  root.className = "palette";
  root.dataset["testid"] = "command-palette";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Commands");
  root.hidden = true;
  root.innerHTML = `<input class="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" placeholder="Type a command: select, zoom, export, settings…" autocomplete="off" spellcheck="false" aria-label="Command">
    <ul class="palette-list" id="palette-list" role="listbox" aria-label="Commands"></ul>`;
  document.body.appendChild(root);
  const input = root.querySelector<HTMLInputElement>(".palette-input")!;
  const list = root.querySelector<HTMLUListElement>(".palette-list")!;
  let shown: Command[] = [];
  let active = 0;
  let before: HTMLElement | null = null;

  const render = (): void => {
    shown = findCommands(commands(), input.value).slice(0, MAX_SHOWN);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length
      ? shown
          .map((c, i) => `<li role="option" id="palette-${i}" data-i="${i}" aria-selected="${i === active}" class="${i === active ? "is-active" : ""}"><span class="palette-group">${esc(c.group)}</span><span class="palette-title">${esc(c.title)}</span>${c.keys ? `<kbd>${esc(c.keys)}</kbd>` : ""}</li>`)
          .join("")
      : `<li class="palette-empty" role="presentation">No command matches.</li>`;
    input.setAttribute("aria-activedescendant", shown.length ? `palette-${active}` : "");
    list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  };
  const close = (): void => {
    if (root.hidden) return;
    root.hidden = true;
    before?.focus?.();
    before = null;
  };
  const run = (c: Command | undefined): void => {
    if (!c) return;
    close();
    c.run();
  };
  input.addEventListener("input", () => {
    active = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // typing here is not a shortcut of the canvas
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(1, shown.length);
      render();
    } else if (e.key === "Enter") run(shown[active]);
    else if (e.key === "Escape" || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) close();
    else return;
    e.preventDefault();
  });
  list.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-i]");
    if (li) run(shown[Number(li.dataset["i"])]);
  });
  list.addEventListener("pointermove", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-i]");
    if (li && Number(li.dataset["i"]) !== active) {
      active = Number(li.dataset["i"]);
      for (const x of list.children) x.classList.toggle("is-active", (x as HTMLElement).dataset["i"] === String(active));
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!root.hidden && !root.contains(e.target as Node)) close();
  });
  return {
    open() {
      if (!root.hidden) return;
      before = document.activeElement as HTMLElement | null;
      input.value = "";
      active = 0;
      root.hidden = false;
      render();
      input.focus();
    },
    close,
  };
}
