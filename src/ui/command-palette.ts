/**
 * The command palette (ADR 0117): Ctrl+K (or Ctrl+Shift+P) opens a box that finds any command by words, shows its key, and runs it. The
 * list of commands comes from the app (what is possible now: `enabled`), so the palette has no list of its own to keep up to date.
 */
import { esc } from "./format";
import type { Command } from "../commands/types";
import type { CommandRegistry } from "../commands/registry";
import { findCommands, parseQuery } from "../commands/registry";

// The commands and the way they are found live in src/commands (ADR 0129); the palette is only the box that shows them.
export type { Command };
export { findCommands };

const MAX_SHOWN = 60;

/** One row of the palette: a command, or (while a kind is being typed after `@`) a kind to choose. */
type Row = { kind: "command"; command: Command } | { kind: "filter"; word: string; count: number };

export function mountCommandPalette(registry: CommandRegistry): { open(): void; close(): void } {
  const root = document.createElement("div");
  root.className = "palette";
  root.dataset["testid"] = "command-palette";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Commands");
  root.hidden = true;
  root.innerHTML = `<input class="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" placeholder="Type a command (select, zoom, export…); @ narrows it to a kind (@settings, @toolbar, @tool…)" autocomplete="off" spellcheck="false" aria-label="Command">
    <ul class="palette-list" id="palette-list" role="listbox" aria-label="Commands"></ul>`;
  document.body.appendChild(root);
  const input = root.querySelector<HTMLInputElement>(".palette-input")!;
  const list = root.querySelector<HTMLUListElement>(".palette-list")!;
  let shown: Row[] = [];
  let active = 0;
  let before: HTMLElement | null = null;

  const rowsFor = (query: string): Row[] => {
    const parsed = parseQuery(query);
    if (parsed.kind !== null && parsed.choosing) {
      // "@" or "@set": the kinds there are, to choose from.
      return registry.kinds().filter((k) => k.kind.startsWith(parsed.kind!)).map((k): Row => ({ kind: "filter", word: k.kind, count: k.count }));
    }
    return findCommands(registry.all(), query).map((command): Row => ({ kind: "command", command }));
  };
  const render = (): void => {
    shown = rowsFor(input.value).slice(0, MAX_SHOWN);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length
      ? shown
          .map((r, i) => {
            const open = `<li role="option" id="palette-${i}" data-i="${i}" aria-selected="${i === active}" class="${i === active ? "is-active" : ""}">`;
            if (r.kind === "filter") return `${open}<span class="palette-group">Filter</span><span class="palette-title">@${esc(r.word)}</span><span class="palette-keys">${r.count}</span></li>`;
            const c = r.command;
            return `${open}<span class="palette-group">${esc(c.group)}</span><span class="palette-title">${esc(c.title)}</span>${c.keys ? `<kbd>${esc(c.keys)}</kbd>` : ""}</li>`;
          })
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
  const run = (r: Row | undefined): void => {
    if (!r) return;
    if (r.kind === "filter") {
      // Choosing a kind completes it in the box and goes on typing.
      input.value = `@${r.word} `;
      active = 0;
      render();
      return;
    }
    close();
    r.command.run();
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
