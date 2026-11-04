import { esc } from "./format";
import { ICONS } from "./icons";
import { makeModal, showModal } from "./modal";
import { treeGuides, treeSlot, walkTree } from "./tree";

/** How much of the things chosen for has this choice. */
export type ChoiceState = "on" | "off" | "some";
export interface ChoiceNode {
  id: string;
  name: string;
  parent: string | null;
  state: ChoiceState;
  /** Only holds others (a tag `art` that exists only as `art/ink`): not a choice itself. */
  group?: boolean;
  n?: number;
}
export interface ChoiceTab {
  id: string;
  title: string;
  /** A row's icon. */
  icon: string;
  /** Its row's icon while what is under it shows. */
  openIcon?: string;
  /** One choice only (a folder), else any number (tags). */
  one: boolean;
  noun: string;
  nodes: ChoiceNode[];
  /** Words typed that can be made into a new choice: what its name would be, or null when they cannot. A new one goes at the top of the tree or by its path. */
  make?(words: string): ChoiceNode[] | null;
}
export interface ChoiceDone {
  on: string[];
  off: string[];
  /** The new ones among `on`. */
  made: string[];
}
export type ChooserView = "tree" | "inline";
export interface ChooserOptions {
  title: string;
  tabs: ChoiceTab[];
  applyLabel: string;
  view: ChooserView;
  onView(view: ChooserView): void;
}

/**
 * The tree chooser: one dialog for choosing among things in a hierarchy, by tabs. A search box, the shared tree (folded and unfolded) or the same things
 * as a row of chips, and Apply. Resolves with what changed in each tab, or null when cancelled: nothing is done until Apply.
 */
export function openTreeChooser(opts: ChooserOptions): Promise<Map<string, ChoiceDone> | null> {
  const dlg = makeModal({
    className: "confirm choice-dialog",
    testid: "tree-chooser",
    titleId: "choice-title",
    html: `<h2 id="choice-title">${esc(opts.title)}</h2>
      ${opts.tabs.length > 1 ? `<div class="choice-tabs" role="tablist">${opts.tabs.map((t) => `<button type="button" class="assets-btn" role="tab" data-tab="${esc(t.id)}">${t.icon}<span>${esc(t.title)}</span></button>`).join("")}</div>` : ""}
      <div class="choice-bar"><input type="search" class="choice-search" data-testid="choice-search">
        <button type="button" class="assets-btn is-icon" data-view="tree" aria-label="Show as a tree" title="Show as a tree">${ICONS.listTree}</button>
        <button type="button" class="assets-btn is-icon" data-view="inline" aria-label="Show in a row" title="Show in a row">${ICONS.wrapText}</button></div>
      <div class="choice-list" data-testid="choice-list"></div>
      <div class="confirm-actions"><button type="button" value="cancel" data-testid="choice-cancel">Cancel</button><button type="button" class="is-primary" value="ok" data-testid="choice-ok">${esc(opts.applyLabel)}</button></div>`,
  });
  const search = dlg.querySelector<HTMLInputElement>(".choice-search")!;
  const list = dlg.querySelector<HTMLElement>(".choice-list")!;
  let tab = opts.tabs[0]!;
  let view = opts.view;
  const nodes = new Map(opts.tabs.map((t) => [t.id, [...t.nodes]]));
  const first = new Map(opts.tabs.map((t) => [t.id, new Map(t.nodes.map((n) => [n.id, n.state]))]));
  const made = new Map(opts.tabs.map((t) => [t.id, new Set<string>()]));
  const closed = new Map(opts.tabs.map((t) => [t.id, new Set<string>()]));

  const pathOf = (all: readonly ChoiceNode[], n: ChoiceNode): string => {
    const names = [n.name];
    for (let p = n.parent; p !== null; ) {
      const up = all.find((x) => x.id === p);
      if (!up) break;
      names.unshift(up.name);
      p = up.parent;
    }
    return names.join(" / ");
  };
  /** One choice: a tick or a dot, and its name. */
  const choice = (t: ChoiceTab, n: ChoiceNode, label: string, open = false): string =>
    n.group
      ? `<span class="choice-name is-group">${t.icon}<span>${esc(label)}</span></span>`
      : `<label class="choice-name"><input type="${t.one ? "radio" : "checkbox"}" name="choice-${esc(t.id)}" data-id="${esc(n.id)}" data-some="${n.state === "some"}"${n.state === "on" ? " checked" : ""}>${open ? (t.openIcon ?? t.icon) : t.icon}<span>${esc(label)}</span></label>`;
  const count = (n: ChoiceNode): string => (n.n ? `<span class="layer-count">${n.n}</span>` : "");

  const draw = (): void => {
    const all = nodes.get(tab.id)!;
    const q = search.value.trim().toLowerCase();
    search.placeholder = `Search ${tab.noun}`;
    search.setAttribute("aria-label", `Search ${tab.noun}`);
    dlg.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset["tab"] === tab.id)));
    dlg.querySelectorAll<HTMLElement>("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset["view"] === view)));
    const typed = (n: ChoiceNode): string => pathOf(all, n).replaceAll(" / ", "/").toLowerCase(); // (as a path is typed)
    const hits = q ? all.filter((n) => typed(n).includes(q)) : all;
    // With a search: what matches and what leads to it, all open.
    const keep = new Set<string>();
    for (const n of hits) for (let at: ChoiceNode | undefined = n; at && !keep.has(at.id); at = all.find((x) => x.id === at!.parent)) keep.add(at.id);
    const kids = (id: string | null): ChoiceNode[] => all.filter((n) => n.parent === id && keep.has(n.id)).sort((a, b) => Number(b.id === "") - Number(a.id === "") || a.name.localeCompare(b.name));
    const shut = closed.get(tab.id)!;
    const body =
      view === "tree"
        ? `<ul class="choice-tree" role="tree">${walkTree(kids(null), (n) => kids(n.id), (n) => !!q || !shut.has(n.id), (n, at) => `<li class="tree-row choice-row" role="treeitem" style="--depth:${at.depth}">${treeGuides(at.depth, at.last, at.conts)}${treeSlot(at, `data-twist="${esc(n.id)}"`)}${choice(tab, n, n.name, at.open)}${count(n)}</li>`)}</ul>`
        : `<div class="choice-chips">${hits.filter((n) => !n.group).sort((a, b) => pathOf(all, a).localeCompare(pathOf(all, b))).map((n) => `<span class="choice-chip">${choice(tab, n, pathOf(all, n))}${count(n)}</span>`).join("")}</div>`;
    const words = search.value.trim();
    const could = words && tab.make && !all.some((n) => typed(n) === words.toLowerCase()) ? tab.make(words) : null;
    list.innerHTML = (hits.length ? body : `<p class="choice-empty">No ${esc(tab.noun)} match.</p>`) + (could ? `<button type="button" class="assets-btn choice-make" data-make data-testid="choice-make">${ICONS.plus}<span>Make “${esc(words)}”</span></button>` : "");
    list.querySelectorAll<HTMLInputElement>('input[data-some="true"]').forEach((b) => (b.indeterminate = !tab.one));
  };

  const results = (): Map<string, ChoiceDone> => {
    const out = new Map<string, ChoiceDone>();
    for (const t of opts.tabs) {
      const was = first.get(t.id)!;
      const now = nodes.get(t.id)!.filter((n) => !n.group);
      const on = now.filter((n) => n.state === "on" && was.get(n.id) !== "on").map((n) => n.id);
      const off = now.filter((n) => n.state === "off" && was.has(n.id) && was.get(n.id) !== "off").map((n) => n.id);
      if (on.length || off.length) out.set(t.id, { on, off, made: on.filter((id) => made.get(t.id)!.has(id)) });
    }
    return out;
  };

  return new Promise((resolve) => {
    let answer: Map<string, ChoiceDone> | null = null;
    dlg.addEventListener("change", (e) => {
      const box = e.target as HTMLInputElement;
      if (box.dataset["id"] === undefined) return; // ("No folder" is the empty one)
      const all = nodes.get(tab.id)!;
      for (const n of all) {
        if (n.id === box.dataset["id"]) n.state = box.checked ? "on" : "off";
        else if (tab.one && !n.group) n.state = "off";
      }
    });
    dlg.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      if (b.value === "ok") answer = results();
      if (b.value) return dlg.close();
      if (b.dataset["tab"]) {
        tab = opts.tabs.find((t) => t.id === b.dataset["tab"])!;
        search.value = "";
      } else if (b.dataset["view"]) {
        view = b.dataset["view"] as ChooserView;
        opts.onView(view);
      } else if (b.dataset["twist"] !== undefined) {
        const shut = closed.get(tab.id)!;
        if (!shut.delete(b.dataset["twist"])) shut.add(b.dataset["twist"]);
      } else if (b.hasAttribute("data-make")) {
        make();
      } else return;
      draw();
    });
    /** The words typed become a choice, chosen. */
    const make = (): void => {
      const fresh = tab.make?.(search.value.trim());
      if (!fresh) return;
      const all = nodes.get(tab.id)!;
      for (const n of fresh) if (!all.some((x) => x.id === n.id)) all.push({ ...n });
      const target = fresh[fresh.length - 1]!;
      if (tab.one) for (const n of all) if (!n.group) n.state = "off";
      all.find((n) => n.id === target.id)!.state = "on";
      made.get(tab.id)!.add(target.id);
      search.value = "";
    };
    search.addEventListener("input", draw);
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (list.querySelector("[data-make]")) {
        make();
        draw();
      } else list.querySelector<HTMLInputElement>("input[data-id]")?.click();
    });
    draw();
    showModal(dlg, () => resolve(answer));
    search.focus();
  });
}
