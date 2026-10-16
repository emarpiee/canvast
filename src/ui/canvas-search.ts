import type { EditorState } from "../app/editor-state";
import { mountSuggest } from "./search-suggest";
import { extOf } from "../assets/file-kind";
import { CANVAS_RECENT, rememberSearch } from "../search/history";
import { paintRecent, wireRecent } from "./search-recent";
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
type Mode = "all" | "name" | "tag" | "bookmark";

export function mountCanvasSearch(host: HTMLElement, deps: SearchDeps): { open(prefix?: string): void; close(): void; isOpen(): boolean } {
  const root = document.createElement("div");
  root.className = "cs";
  root.dataset["testid"] = "canvas-search";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Search the canvas");
  root.hidden = true;
  root.innerHTML = `
    <div class="cs-box">${ICONS.search}<input type="text" role="combobox" aria-expanded="true" aria-controls="cs-list" aria-label="Search the canvas" autocomplete="off" spellcheck="false"><button type="button" class="cs-clear" aria-label="Clear the search" title="Clear the search" hidden>${ICONS.x}</button>${searchHelpButton()}</div>
    <div class="cs-modes" role="tablist" aria-label="Search by">
      <button type="button" role="tab" data-m="all">All</button>
      <button type="button" role="tab" data-m="name"><kbd>/</kbd>Name</button>
      <button type="button" role="tab" data-m="tag"><kbd>#</kbd>Tag</button>
      <button type="button" role="tab" data-m="bookmark"><kbd>@</kbd>Bookmark</button>
    </div>
    <div class="search-suggest" data-testid="search-suggest" hidden></div>
    <div class="cs-recent" data-testid="search-recent" hidden></div>
    <div class="cs-bar" hidden><label><input type="checkbox" class="cs-check" data-all> <span>Select all shown</span></label><span class="cs-count" aria-live="polite"></span></div>
    <ul id="cs-list" role="listbox" aria-label="Results" aria-multiselectable="true"></ul>
    <p class="cs-hint"><kbd>Enter</kbd> go to it · <kbd>Ctrl+Enter</kbd> check · <kbd>Shift+Enter</kbd> check all · <kbd>Esc</kbd> close</p>`;
  host.appendChild(root);
  const input = root.querySelector<HTMLInputElement>("input")!;
  wireSearchHelp(root.querySelector<HTMLElement>(".search-help-btn")!, input, "Type the operators in capitals. Works after / # or @.");
  const list = root.querySelector<HTMLElement>("ul")!;
  const PLACEHOLDER: Record<Mode, string> = { all: "Search", name: "Name", tag: "Tag", bookmark: "Bookmark" };
  const EMPTY: Record<Mode, string> = { all: "Type a name, tag, group or bookmark to search this canvas. / # @ narrow it to one.", name: "Type a name to search this canvas.", tag: "Type a tag to find items with it (their own tags, and the tags of a picture's original).", bookmark: "Type a bookmark name, or leave it empty to list them." };
  let mode: Mode = "all";
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
        if (mode === "all") {
          // Every kind at once: a word matches the name, a group's name, the kind, or any tag; `#word` matches tags only.
          const t = [...(o.tags ?? []), ...(o.kind === "image" ? (tags.get(o.assetId) ?? []) : [])];
          const own = [...new Map(t.map((x) => [x.toLowerCase(), x] as const)).values()];
          const groupName = (o.groups ?? []).map((g) => o.groupNames?.[g] ?? "").join(" ");
          const hay = `${lab.text} ${groupName} ${noteOf(o)}`.toLowerCase();
          const tagHit = (w: string): boolean => own.some((x) => x.toLowerCase().includes(w));
          const exact = (w: string): boolean => own.some((x) => x.toLowerCase() === w);
          if (!evalQuery(q, (term) => (term.text.startsWith("#") ? exact(term.text.slice(1)) : term.text.length > 1 && term.text.startsWith(".") ? lab.text.toLowerCase().endsWith(term.text) : hay.includes(term.text) || tagHit(term.text)))) continue;
          out.push({ key: o.id, icon: lab.icon, label: lab.text, note: own.length ? own.map((x) => `#${x}`).join(" ") : noteOf(o), ids: [o.id], entered: [...(o.groups ?? [])] });
        } else if (mode === "tag") {
          // The item's own in-canvas tags, and (for a picture) the tags of its original in the library.
          const t = [...(o.tags ?? []), ...(o.kind === "image" ? (tags.get(o.assetId) ?? []) : [])];
          const all = [...new Map(t.map((x) => [x.toLowerCase(), x] as const)).values()];
          // A term matches when some tag contains it; NOT and XOR then apply to the item's whole tag list.
          // A `#word` is an exact tag; a plain word is part of a tag (the same as in the library).
          if (!all.length || !evalQuery(q, (term) => all.some((x) => (term.text.startsWith("#") ? x.toLowerCase() === term.text.slice(1) : x.toLowerCase().includes(term.text))))) continue;
          const hit = all;
          out.push({ key: o.id, icon: lab.icon, label: lab.text, note: hit.map((x) => `#${x}`).join(" "), ids: [o.id], entered: [...(o.groups ?? [])] });
        } else {
          const groupName = (o.groups ?? []).map((g) => o.groupNames?.[g] ?? "").join(" ");
          const hay = `${lab.text} ${groupName}`.toLowerCase();
          if (!evalQuery(q, (t) => (t.text.length > 1 && t.text.startsWith(".") ? lab.text.toLowerCase().endsWith(t.text) : hay.includes(t.text)))) continue;
          out.push({ key: o.id, icon: lab.icon, label: lab.text, note: noteOf(o), ids: [o.id], entered: [...(o.groups ?? [])] });
        }
        if (out.length >= MAX_RESULTS) break;
      }
    }
    results = out.slice(0, MAX_RESULTS);
    if (mode === "all" && q) {
      // Bookmarks whose name matches follow the items (a `#tag` word is about tags, so it never matches a bookmark).
      for (const b of deps.bookmarks.items) {
        const bn = b.name.toLowerCase();
        if (evalQuery(q, (t) => !t.text.startsWith("#") && bn.includes(t.text))) results.push({ key: `b:${b.id}`, icon: ICONS.bookmark, label: b.name, note: "Bookmark", bookmark: b.id });
      }
    }
    active = Math.min(active, Math.max(0, results.length - 1));
    paint();
  };
  const noteOf = (o: CanvasObject): string => (o.kind === "image" ? "Picture" : o.kind === "text" ? "Text" : "Stroke") + (o.groups?.length ? " · in a group" : "");

  mountSuggest(root.querySelector<HTMLElement>(".search-suggest")!, input, () => {
    // What the canvas has: in-canvas tags and the tags of the pictures' originals, and the file types of the items' names.
    const tagN = new Map<string, { label: string; n: number }>();
    const typeN = new Map<string, number>();
    for (const o of deps.doc.ordered()) {
      const t = [...(o.tags ?? []), ...(o.kind === "image" ? (tags.get(o.assetId) ?? []) : [])];
      for (const x of new Set(t.map((y) => y.toLowerCase()))) {
        const label = t.find((y) => y.toLowerCase() === x)!;
        const c = tagN.get(x);
        if (c) c.n++;
        else tagN.set(x, { label, n: 1 });
      }
      const ext = extOf(labelOf(o, names).text).toLowerCase();
      if (ext) typeN.set(ext, (typeN.get(ext) ?? 0) + 1);
    }
    return { tags: [...tagN.values()], types: [...typeN].map(([ext, n]) => ({ ext, n })) };
  });
  const clearBtn = root.querySelector<HTMLButtonElement>(".cs-clear")!;
  const recentBox = root.querySelector<HTMLElement>(".cs-recent")!;
  const bar = root.querySelector<HTMLElement>(".cs-bar")!;
  const allBox = bar.querySelector<HTMLInputElement>("[data-all]")!;
  const count = bar.querySelector<HTMLElement>(".cs-count")!;

  const remember = (): void => {
    if (results.length) rememberSearch(CANVAS_RECENT, input.value, mode);
  };

  const idsOf = (r: Result): string[] => r.ids ?? [];
  const isChecked = (r: Result): boolean => idsOf(r).length > 0 && idsOf(r).every((id) => deps.editor.selection.has(id));

  const paintRecentBox = (): void => paintRecent(recentBox, CANVAS_RECENT, !input.value.trim());

  const paint = (): void => {
    clearBtn.hidden = !input.value;
    paintRecentBox();
    const pickable = results.filter((r) => idsOf(r).length);
    bar.hidden = !pickable.length;
    allBox.checked = pickable.length > 0 && pickable.every(isChecked);
    allBox.indeterminate = !allBox.checked && pickable.some(isChecked);
    count.textContent = deps.editor.selection.size ? `${deps.editor.selection.size} selected` : "";
    list.innerHTML = results.length
      ? results
          .map((r, i) => `<li role="option" id="cs-${i}" data-i="${i}" aria-selected="${isChecked(r)}" class="cs-row${i === active ? " is-active" : ""}">${idsOf(r).length ? `<input type="checkbox" class="cs-check" tabindex="-1" data-check aria-label="Select ${esc(r.label)}"${isChecked(r) ? " checked" : ""}>` : ""}<span class="cs-icon">${r.icon}</span><span class="cs-label">${esc(r.label)}</span><span class="cs-note">${esc(r.note)}</span></li>`)
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
  /** Go to a result: select just it and bring it into view. The search stays open (it closes only on a press outside or Escape). */
  const go = (r: Result | undefined): void => {
    if (!r) return;
    remember();
    if (r.bookmark) {
      deps.bookmarks.go(r.bookmark);
      paint();
      return;
    }
    const picked = idsOf(r);
    if (!picked.length) return;
    deps.editor.entered = r.entered ?? [];
    deps.editor.select(picked);
    deps.focus(picked);
    paint();
  };
  /** Check or uncheck results: the checked results are the canvas selection, so a box adds or takes off one item and nothing moves. */
  const toggle = (rs: readonly Result[], on: boolean): void => {
    const ids = rs.flatMap(idsOf);
    if (!ids.length) return;
    const now = new Set(deps.editor.selection);
    for (const id of ids) on ? now.add(id) : now.delete(id);
    deps.editor.entered = [];
    deps.editor.select(now);
    if (on) remember();
    paint();
  };
  /** Bring everything checked into view. */
  const showChecked = (): void => {
    const ids = [...deps.editor.selection];
    if (!ids.length) return;
    remember();
    deps.focus(ids);
  };

  input.addEventListener("input", () => {
    // A first "/" or "@" chooses the way and is not part of the search. A "#" stays: it is a search word (`#tag`, `-#tag`).
    const c = input.value[0];
    if (c === "/" || c === "@") {
      setMode(c === "@" ? "bookmark" : "name");
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
      if (e.shiftKey) {
        toggle(results, true); // check every result
        showChecked();
      } else if (e.ctrlKey || e.metaKey) {
        const r = results[active];
        if (r) toggle([r], !isChecked(r));
      } else if (deps.editor.selection.size > 1 && results.some(isChecked)) showChecked();
      else go(results[active]);
      e.preventDefault();
    } else if (e.key === "Backspace" && !input.value && mode !== "all") {
      setMode("all"); // nothing left to delete: back to searching everything
      compute();
      e.preventDefault();
    }
    e.stopPropagation(); // typing here never reaches the canvas shortcuts
  });
  list.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (!li) return;
    const r = results[Number(li.dataset["i"])];
    active = Number(li.dataset["i"]);
    if ((e.target as HTMLElement).closest("[data-check]")) {
      if (r) toggle([r], !isChecked(r));
    } else go(r);
    input.focus();
  });
  allBox.addEventListener("change", () => {
    toggle(results, allBox.checked);
    input.focus();
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    active = 0;
    compute();
    input.focus();
  });
  wireRecent(
    recentBox,
    CANVAS_RECENT,
    (r) => {
      setMode(r.m);
      input.value = r.q;
      active = 0;
      compute();
      input.focus();
    },
    () => {
      paintRecentBox();
      input.focus();
    },
  );
  // A press outside closes the search. If it lands on the canvas while items are selected (the ones just picked here), that first press
  // only closes the search: it does not also clear the selection. The next press works as usual.
  document.addEventListener(
    "pointerdown",
    (e) => {
      const t = e.target as HTMLElement;
      if (root.hidden || root.contains(t) || t.closest(".search-help")) return;
      close();
      if (t.id === "canvas" && deps.editor.selection.size > 0) {
        e.stopPropagation();
        e.preventDefault();
        t.focus();
      }
    },
    true,
  );

  return {
    open(prefix = "") {
      root.hidden = false;
      // The last search stays as it was (the person clears it); a key like "/" only changes the way.
      if (prefix) setMode(prefix === "#" ? "tag" : prefix === "@" ? "bookmark" : "name");
      active = 0;
      const my = ++token;
      names = new Map();
      tags = new Map();
      compute();
      input.focus();
      input.select(); // typing replaces the kept search; an arrow key keeps it
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
