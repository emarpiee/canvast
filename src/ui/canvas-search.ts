import type { EditorState } from "../app/editor-state";
import { searchHelpButton, wireSearchHelp } from "./search-help";
import { evalQuery, parseQuery } from "../search/query";
import type { BookmarkList } from "../app/bookmarks";
import type { DocumentStore } from "../doc/document-store";
import type { CanvasObject } from "../doc/model";
import { esc } from "./format";
import { ICONS } from "./icons";
import { labelOf } from "./layers-panel";

/**
 * Search on the open canvas (ADR 0060). Press "/" to look for an item by its file name, layer name or text, "#" to look for pictures by
 * the tags of their original, "@" to look for a bookmark; the first character of the box chooses the way, so it can be changed while
 * typing. Enter goes to the highlighted result (select it and bring it into view), Shift+Enter selects every match, Escape closes.
 */
export interface SearchDeps {
  doc: DocumentStore;
  editor: EditorState;
  bookmarks: BookmarkList;
  /** The file name and tags of an original (undefined when unknown). */
  entry(hash: string): Promise<{ name: string; tags: readonly string[] } | undefined>;
  /** Bring these objects into view. */
  focus(ids: readonly string[]): void;
}

interface Result {
  key: string;
  icon: string;
  label: string;
  note: string;
  /** Objects to select, or a bookmark to go to. */
  ids?: string[];
  bookmark?: string;
  /** For picking the group a result is inside. */
  entered?: string[];
}

const MAX_RESULTS = 50;
type Mode = "name" | "tag" | "bookmark";

export function mountCanvasSearch(host: HTMLElement, deps: SearchDeps): { open(prefix?: string): void; close(): void; isOpen(): boolean } {
  const root = document.createElement("div");
  root.className = "cs";
  root.dataset["testid"] = "canvas-search";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Search the canvas");
  root.hidden = true;
  root.innerHTML = `
    <div class="cs-box">${ICONS.search}<input type="text" role="combobox" aria-expanded="true" aria-controls="cs-list" aria-label="Search the canvas" autocomplete="off" spellcheck="false">${searchHelpButton()}</div>
    <div class="cs-modes" role="tablist" aria-label="Search by">
      <button type="button" role="tab" data-m="name"><kbd>/</kbd>Name</button>
      <button type="button" role="tab" data-m="tag"><kbd>#</kbd>Tag</button>
      <button type="button" role="tab" data-m="bookmark"><kbd>@</kbd>Bookmark</button>
    </div>
    <ul id="cs-list" role="listbox" aria-label="Results"></ul>
    <p class="cs-hint"><kbd>Enter</kbd> go to it · <kbd>Shift+Enter</kbd> select all · <kbd>Esc</kbd> close</p>`;
  host.appendChild(root);
  const input = root.querySelector<HTMLInputElement>("input")!;
  wireSearchHelp(root.querySelector<HTMLElement>(".search-help-btn")!, input, "Type the operators in capitals. Works after / # or @.");
  const list = root.querySelector<HTMLElement>("ul")!;
  const PLACEHOLDER: Record<Mode, string> = { name: "File, layer or text name", tag: "Tag of an item", bookmark: "Bookmark name" };
  const EMPTY: Record<Mode, string> = { name: "Type a name to search this canvas.", tag: "Type a tag to find items with it (their own tags, and the tags of a picture's original).", bookmark: "Type a bookmark name, or leave it empty to list them." };
  let mode: Mode = "name";
  const setMode = (m: Mode): void => {
    mode = m;
    input.placeholder = PLACEHOLDER[m];
    for (const t of root.querySelectorAll<HTMLElement>("[data-m]")) t.setAttribute("aria-selected", String(t.dataset["m"] === m));
  };
  let results: Result[] = [];
  let active = 0;
  let names = new Map<string, string>();
  let tags = new Map<string, readonly string[]>();
  let token = 0;

  const compute = (): void => {
    const q = parseQuery(input.value).query;
    const out: Result[] = [];
    if (mode === "bookmark") {
      for (const b of deps.bookmarks.items) {
        const bn = b.name.toLowerCase();
        if (!evalQuery(q, (t) => bn.includes(t.text.replace(/^#/, "")))) continue;
        out.push({ key: `b:${b.id}`, icon: ICONS.bookmark, label: b.name, note: "Bookmark", bookmark: b.id });
      }
    } else {
      const objs = [...deps.doc.ordered()].filter((o) => !o.hidden).sort((a, b) => b.z - a.z);
      for (const o of objs) {
        const lab = labelOf(o, names);
        if (mode === "tag") {
          // The item's own in-canvas tags, and (for a picture) the tags of its original in the library.
          const t = [...(o.tags ?? []), ...(o.kind === "image" ? (tags.get(o.assetId) ?? []) : [])];
          const all = [...new Map(t.map((x) => [x.toLowerCase(), x] as const)).values()];
          // A term matches when some tag contains it; NOT and XOR then apply to the item's whole tag list.
          if (!all.length || !evalQuery(q, (term) => all.some((x) => x.toLowerCase().includes(term.text.replace(/^#/, ""))))) continue;
          const hit = all;
          out.push({ key: o.id, icon: lab.icon, label: lab.text, note: hit.map((x) => `#${x}`).join(" "), ids: [o.id], entered: [...(o.groups ?? [])] });
        } else {
          const groupName = (o.groups ?? []).map((g) => o.groupNames?.[g] ?? "").join(" ");
          const hay = `${lab.text} ${groupName}`.toLowerCase();
          if (!evalQuery(q, (t) => hay.includes(t.text))) continue;
          out.push({ key: o.id, icon: lab.icon, label: lab.text, note: noteOf(o), ids: [o.id], entered: [...(o.groups ?? [])] });
        }
        if (out.length >= MAX_RESULTS) break;
      }
    }
    results = out.slice(0, MAX_RESULTS);
    active = Math.min(active, Math.max(0, results.length - 1));
    paint();
  };
  const noteOf = (o: CanvasObject): string => (o.kind === "image" ? "Picture" : o.kind === "text" ? "Text" : "Stroke") + (o.groups?.length ? " · in a group" : "");

  const paint = (): void => {
    list.innerHTML = results.length
      ? results
          .map((r, i) => `<li role="option" id="cs-${i}" data-i="${i}" aria-selected="${i === active}" class="cs-row${i === active ? " is-active" : ""}"><span class="cs-icon">${r.icon}</span><span class="cs-label">${esc(r.label)}</span><span class="cs-note">${esc(r.note)}</span></li>`)
          .join("")
      : `<li class="cs-empty" role="presentation">${input.value.trim() ? "Nothing matches." : EMPTY[mode]}</li>`;
    if (results.length) input.setAttribute("aria-activedescendant", `cs-${active}`);
    else input.removeAttribute("aria-activedescendant");
    list.querySelector<HTMLElement>(".is-active")?.scrollIntoView({ block: "nearest" });
  };

  const close = (): void => {
    if (root.hidden) return;
    input.blur(); // a hidden box can keep the focus until the next frame, and it would swallow the next key
    root.hidden = true;
    token++;
  };
  const go = (r: Result | undefined, all = false): void => {
    if (!r) return;
    if (r.bookmark) {
      deps.bookmarks.go(r.bookmark);
      close();
      return;
    }
    const picked = all ? results.flatMap((x) => x.ids ?? []) : (r.ids ?? []);
    if (!picked.length) return;
    deps.editor.entered = all ? [] : (r.entered ?? []);
    deps.editor.select(picked);
    deps.focus(picked);
    close();
  };

  input.addEventListener("input", () => {
    // A first character of "/", "#" or "@" chooses the way and is not part of the search.
    const c = input.value[0];
    if (c === "/" || c === "#" || c === "@") {
      setMode(c === "#" ? "tag" : c === "@" ? "bookmark" : "name");
      input.value = input.value.slice(1);
    }
    active = 0;
    compute();
  });
  root.querySelector(".cs-modes")!.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-m]");
    if (!t) return;
    setMode(t.dataset["m"] as Mode);
    active = 0;
    compute();
    input.focus();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (results.length) active = (active + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length;
      paint();
      e.preventDefault();
    } else if (e.key === "Enter") {
      go(results[active], e.shiftKey);
      e.preventDefault();
    } else if (e.key === "Backspace" && !input.value && mode !== "name") {
      setMode("name"); // nothing left to delete: back to the plain name search
      compute();
      e.preventDefault();
    }
    e.stopPropagation(); // typing here never reaches the canvas shortcuts
  });
  list.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (li) go(results[Number(li.dataset["i"])]);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!root.hidden && !root.contains(e.target as Node) && !(e.target as HTMLElement).closest(".search-help")) close();
  });

  return {
    open(prefix = "/") {
      root.hidden = false;
      setMode(prefix === "#" ? "tag" : prefix === "@" ? "bookmark" : "name");
      input.value = "";
      active = 0;
      const my = ++token;
      names = new Map();
      tags = new Map();
      compute();
      input.focus();
      // The file names and tags live in the library; they are read once per original and the list is redrawn when they arrive.
      const hashes = new Set<string>();
      for (const o of deps.doc.ordered()) if (o.kind === "image") hashes.add(o.assetId);
      void Promise.all(
        [...hashes].map(async (h) => {
          const e = await deps.entry(h).catch(() => undefined);
          if (e) {
            names.set(h, e.name);
            tags.set(h, e.tags);
          }
        }),
      ).then(() => {
        if (my === token && !root.hidden) compute();
      });
    },
    close,
    isOpen: () => !root.hidden,
  };
}
