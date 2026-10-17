import type { EditorState } from "../app/editor-state";
import { plural } from "../doc/plural";
import type { DocumentStore } from "../doc/document-store";
import type { AssetNames } from "../app/asset-names";
import type { BlendMode, CanvasObject, PathObject } from "../doc/model";
import { BLEND_MODES, MAX_NAME_LENGTH, inkOf } from "../doc/model";
import { SHAPE_NAMES } from "../doc/path";
import { isBoolMember, isResult } from "../doc/boolean-group";
import { ancestorsOf, isContainer, withDescendants } from "../doc/containers";
import type { BoolOp } from "../doc/boolean";
import { plainText } from "../text/markdown";
import { esc } from "./format";
import { ICONS } from "./icons";
import { swatchBackground } from "../render/ink";

/**
 * Floating Layers panel (ADR 0024), like the layers list of a design tool:
 * objects front to back, groups as expandable rows, an eye and a lock on
 * every row, click to select, drag to reorder, and the panel can be hidden
 * (the Layers button in the toolbar). It only reads and writes the document
 * through the same commands as the canvas.
 */
export interface LayersActions {
  setFlagOn(ids: readonly string[], flag: "hidden" | "locked", on: boolean): void;
  /** Whether a sheet hides what lies outside it (ADR 0108). */
  setClip(id: string, clip: boolean): void;
  moveAbove(ids: readonly string[], aboveId: string): void;
  /** Put the stacking order in name order (ADR 0059); only the order changes, never a position. `order` is front to back. */
  setOrder(order: readonly string[], label: string): void;
  setOpacity(ids: readonly string[], opacity: number): void;
  /** Blend mode of objects (null = normal), ADR 0047. */
  setBlend(ids: readonly string[], blend: BlendMode | null): void;
  /** Name an object or a group (its id); empty = automatic label. */
  rename(key: string, name: string): void;
  /** The file names of the originals (shared with the names above pictures). */
  names: AssetNames;
}

/** Lowest opacity the slider sets (the model needs more than 0; use Hide for nothing). */
const MIN_OPACITY = 0.05;

/** Rows drawn at most; a bigger document shows the front of the stack (no virtual scrolling yet). */
const MAX_ROWS = 500;

interface Node {
  /** Object id, or a group id. */
  id: string;
  group: boolean;
  /** Every object under this row (itself for an object). */
  members: CanvasObject[];
  children: Node[];
  /** Highest z among the members: the row's place in the stack. */
  z: number;
  /** A sheet (ADR 0108): `id` is its object's id, `members[0]` is the sheet itself, and the rest is what is on it. */
  sheet?: PathObject;
}

/** The tree of groups and objects, front first. */
export function layerTree(objects: readonly CanvasObject[]): Node[] {
  const roots: Node[] = [];
  const groups = new Map<string, Node>();
  const byId = new Map(objects.map((o) => [o.id, o]));
  const sheets = new Map<string, Node>();
  /** The row of a sheet, made (inside its own sheet's row) when first needed. */
  const sheetNode = (f: PathObject & { container: { clip: boolean } }): Node => {
    let n = sheets.get(f.id);
    if (!n) {
      n = { id: f.id, group: true, sheet: f, members: [f], children: [], z: f.z };
      sheets.set(f.id, n);
      const up = ancestorsOf((id) => byId.get(id), f);
      (up[0] ? sheetNode(up[0]).children : roots).push(n);
      for (const a of up) {
        const an = sheetNode(a);
        an.members.push(f);
        an.z = Math.max(an.z, f.z);
      }
    }
    return n;
  };
  const sorted = [...objects].sort((a, b) => b.z - a.z || (a.id < b.id ? 1 : -1));
  for (const o of sorted) {
    if (isResult(o)) continue; // what a boolean group looks like is not a layer of its own (ADR 0103): the group is the row
    if (isContainer(o)) {
      sheetNode(o);
      continue;
    }
    let siblings = roots;
    const chain = ancestorsOf((id) => byId.get(id), o);
    if (chain.length) {
      for (const f of chain.reverse()) {
        const fn = sheetNode(f);
        fn.members.push(o);
        fn.z = Math.max(fn.z, o.z);
        siblings = fn.children;
      }
    }
    for (const gid of o.groups ?? []) {
      let g = groups.get(gid);
      if (!g) {
        g = { id: gid, group: true, members: [], children: [], z: o.z };
        groups.set(gid, g);
        siblings.push(g);
      }
      g.members.push(o);
      siblings = g.children;
    }
    siblings.push({ id: o.id, group: false, members: [o], children: [], z: o.z });
  }
  return roots;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The objects front to back after sorting the panel by name: items by their name (a group by its own name, and its members after it,
 * each sorted the same way, so a group stays together). "asc" puts A in front (at the top of the panel).
 */
export function sortedByName(objects: readonly CanvasObject[], names: ReadonlyMap<string, string>, dir: "asc" | "desc"): CanvasObject[] {
  const label = (n: Node): string => (n.group ? (n.members[0]!.groupNames?.[n.id] ?? "Group") : labelOf(n.members[0]!, names).text);
  const sign = dir === "asc" ? 1 : -1;
  const walk = (nodes: readonly Node[]): CanvasObject[] =>
    [...nodes].sort((a, b) => sign * collator.compare(label(a), label(b))).flatMap((n) => (n.group ? walk(n.children) : n.members));
  return walk(layerTree(objects));
}

/**
 * A name for a narrow row: the end is kept apart so that, when the name is cut, it is cut in the middle ("dark-s01e01-frame_…0003.png")
 * and the part that tells similar names apart (a number, an extension) stays visible. The text of the two parts is the whole name.
 */
export function splitName(text: string): string {
  const keep = 9;
  if (text.length <= keep + 5) return esc(text);
  return `<span class="n-start">${esc(text.slice(0, -keep))}</span><span class="n-end">${esc(text.slice(-keep))}</span>`;
}

/** What a boolean group is called in the list, and its icon (ADR 0103). */
const BOOL_NAME: Record<BoolOp, string> = { union: "Union", intersect: "Intersect", subtract: "Subtract", exclude: "Exclude" };
const boolIcon = (op: BoolOp): string => (op === "union" ? ICONS.squaresUnite : op === "intersect" ? ICONS.squaresIntersect : op === "subtract" ? ICONS.squaresSubtract : ICONS.squaresExclude);

/** Short name of an object for lists and mention labels. */
export function labelOf(o: CanvasObject, names?: ReadonlyMap<string, string>): { icon: string; text: string; swatch?: string } {
  if (o.name) return { icon: o.kind === "stroke" ? ICONS.spline : o.kind === "image" ? ICONS.image : o.kind === "path" ? ICONS.vectorSquare : ICONS.type, text: o.name, ...(o.kind !== "image" ? { swatch: inkOf(o).rgb } : {}) };
  if (o.kind === "stroke") return { icon: ICONS.spline, text: "Stroke", swatch: o.color };
  if (o.kind === "path") return { icon: ICONS.vectorSquare, text: SHAPE_NAMES[o.shape ?? "path"], swatch: inkOf(o).rgb };
  if (o.kind === "image") return { icon: ICONS.image, text: names?.get(o.assetId) || `Image ${o.pixelW}×${o.pixelH}` };
  const plain = plainText(o.md, 28);
  return { icon: ICONS.type, text: plain || "Text", swatch: o.color };
}

export function mountLayersPanel(host: HTMLElement, editor: EditorState, doc: DocumentStore, actions: LayersActions): void {
  const panel = document.createElement("aside");
  panel.className = "layers-panel";
  panel.setAttribute("aria-label", "Layers");
  panel.dataset["testid"] = "layers-panel";
  host.appendChild(panel);
  const open = new Set<string>(); // expanded groups
  let sortOpen = false;
  /** The row a Shift-click takes its range from: the last one clicked. */
  let anchorKey: string | null = null;
  /** Filter by name (shown once there are many layers) and how many rows are drawn so far. */
  let filter = "";
  let limit = MAX_ROWS;
  let refocusFilter = false;
  let lastSelection = "";
  /** Groups the panel has already listed: a group seen for the first time (just made) opens. */
  const seenGroups = new Set<string>();
  const names = actions.names.map;
  let scheduled = false;
  let dragged: string[] = [];
  /** The row being renamed (kept across redraws) and what has been typed. */
  let renaming: { key: string; value: string } | null = null;

  const selectedObjs = (): CanvasObject[] => [...editor.selection].map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o);
  /** Opacity of the selection (the first object's when they differ). */
  const footer = (): string => {
    const sel = selectedObjs();
    if (!sel.length) return ""; // nothing selected: nothing to set (the panel is all list)
    const pct = Math.round((sel[0]?.opacity ?? 1) * 100);
    const blend = sel[0]?.blend ?? "";
    const modes = ["", ...BLEND_MODES].map((m) => `<option value="${m}"${m === blend ? " selected" : ""}>${m ? m.replace(/-/g, " ") : "normal"}</option>`).join("");
    const allHidden = sel.every((o) => o.hidden);
    const allLocked = sel.every((o) => o.locked);
    const actionsRow = `<div class="layers-do" role="group" aria-label="Selected layers">
      <button type="button" data-do="rename"${sel.length === 1 ? "" : " disabled"} title="Rename the selected layer (double-click its name too)">${ICONS.textCursorInput}<span>Rename</span></button>
      <button type="button" data-do="hide" title="Hide the selection">${allHidden ? ICONS.eye : ICONS.eyeOff}<span>${allHidden ? "Show" : "Hide"}</span></button>
      <button type="button" data-do="lock" title="Lock the selection: it is drawn, but cannot be picked">${allLocked ? ICONS.lockKeyholeOpen : ICONS.lockKeyhole}<span>${allLocked ? "Unlock" : "Lock"}</span></button></div>`;
    return `${actionsRow}<label class="layers-blend">Blend <select data-blend ${sel.length ? "" : "disabled"} aria-label="Blend mode of the selection">${modes}</select></label><label class="layers-opacity">Opacity <input type="range" data-opacity min="${MIN_OPACITY * 100}" max="100" step="1" value="${pct}" ${sel.length ? "" : "disabled"} aria-label="Opacity of the selection"> <output>${pct}%</output></label>`;
  };

  const render = (): void => {
    scheduled = false;
    panel.hidden = !editor.layersOpen;
    if (!editor.layersOpen) return;
    // A name being typed is not redrawn under the cursor (a redraw would end the edit).
    if ((renaming && panel.querySelector("[data-rename]"))) return;
    const all = doc.ordered().filter((o) => !isResult(o));
    for (const o of all) if (o.kind === "image") actions.names.get(o.assetId);
    const tree = layerTree(all);
    for (const g of new Set(all.flatMap((o) => o.groups ?? []))) {
      if (!seenGroups.has(g)) {
        seenGroups.add(g);
        if (editor.selection.size && all.some((o) => editor.selection.has(o.id) && o.groups?.includes(g))) open.add(g);
      }
    }
    let rows = 0;
    /**
     * The guide lines of a row: for each level above it a vertical line under that level's chevron (only while the branch goes on), and for
     * its own level a line that ends at the row's middle with a short tick into the row when it is the last of its group. The lines stop
     * at the last item of the group, so a group never looks as if it covered what follows it.
     */
    const guides = (depth: number, last: boolean, conts: readonly boolean[]): string => {
      if (depth === 0) return "";
      const parts: string[] = [];
      for (let j = 0; j < depth - 1; j++) if (conts[j]) parts.push(`<i class="tg" style="--l:${j}"></i>`);
      parts.push(`<i class="tg tg-own${last ? " is-last" : ""}" style="--l:${depth - 1}"></i>`);
      return `<span class="tree" aria-hidden="true">${parts.join("")}</span>`;
    };
    /** `last`: the last item of its group; `conts`: for each ancestor below the top, whether its own branch goes on below it (its guide line continues). */
    const row = (n: Node, depth: number, last: boolean, conts: readonly boolean[]): string => {
      if (rows >= limit) return "";
      rows++;
      const first = n.members[0]!;
      const bop = n.group ? first.boolOps?.[n.id] : undefined;
      const lab = n.sheet ? { icon: ICONS.sheetTool, text: n.sheet.name ?? "Sheet", swatch: undefined } : n.group ? { icon: bop ? boolIcon(bop) : ICONS.group, text: first.groupNames?.[n.id] ?? (bop ? BOOL_NAME[bop] : `Group (${n.members.length})`), swatch: undefined } : labelOf(first, names);
      const selected = n.members.every((m) => editor.selection.has(m.id));
      const hidden = n.members.every((m) => m.hidden);
      const locked = n.members.every((m) => m.locked);
      const expanded = n.group && open.has(n.id);
      const key = n.group ? n.id : first.id;
      const head = `<li role="treeitem" ${n.group ? `aria-expanded="${expanded}"` : ""} aria-selected="${selected}" class="layer${n.group ? " is-group" : ""}${selected ? " is-selected" : ""}${hidden ? " is-hidden" : ""}${locked ? " is-locked" : ""}" data-key="${key}" data-group="${n.group}" draggable="true" style="--depth:${depth}">
        ${guides(depth, last, conts)}${n.group ? `<button type="button" class="layer-twist" data-twist aria-label="${expanded ? "Collapse" : "Expand"}">${expanded ? ICONS.chevronDown : ICONS.chevronRight}</button>` : ""}
        <span class="layer-icon">${lab.icon}</span>${lab.swatch ? `<span class="layer-swatch" style="background:${swatchBackground(lab.swatch)}"></span>` : ""}
        ${renaming?.key === key ? `<input class="layer-rename" data-rename maxlength="${MAX_NAME_LENGTH}" value="${esc(renaming.value)}" aria-label="Layer name">` : `<span class="layer-name" title="${esc([...(first.groups ?? []).slice(0, n.group && !n.sheet ? first.groups!.indexOf(n.id) : undefined).map((g) => first.groupNames?.[g] ?? "Group"), lab.text].join(" › "))} (double-click to rename)">${splitName(lab.text)}</span>${n.group ? `<span class="layer-count" title="${plural(n.members.length, "item")} inside">${n.members.length}</span>` : ""}`}
        ${n.sheet ? `<button type="button" class="layer-state layer-clip" data-clip aria-pressed="${n.sheet.container!.clip}" aria-label="Clip content of ${esc(lab.text)}" title="${n.sheet.container!.clip ? "Clipping: what is outside the frame is hidden. Press to show it" : "Not clipping: press to hide what is outside the sheet"}">${ICONS.scissorsLineDashed}</button>` : ""}${hidden ? `<button type="button" class="layer-state" data-eye aria-pressed="true" aria-label="Show ${esc(lab.text)}" title="Hidden: show it">${ICONS.eyeOff}</button>` : ""}${locked ? `<button type="button" class="layer-state" data-lock aria-pressed="true" aria-label="Unlock ${esc(lab.text)}" title="Locked: unlock it">${ICONS.lockKeyhole}</button>` : ""}
      </li>`;
      return head + (expanded ? n.children.map((c, i) => row(c, depth + 1, i === n.children.length - 1, depth >= 1 ? [...conts, !last] : conts)).join("") : "");
    };
    // Filtering lists the matching items flat, front first (a group matches by its name or any of its groups' names).
    const q = filter.trim().toLowerCase();
    const shownTree: Node[] = q
      ? [...all]
          .sort((a, b) => b.z - a.z || (a.id < b.id ? 1 : -1))
          .filter((o) => `${labelOf(o, names).text} ${(o.groups ?? []).map((g) => o.groupNames?.[g] ?? "").join(" ")}`.toLowerCase().includes(q))
          .map((o): Node => ({ id: o.id, group: false, members: [o], children: [], z: o.z }))
      : tree;
    const list = shownTree.map((n) => row(n, 0, false, [])).join("");
    panel.innerHTML = `
      <header><h2>Layers <span class="layers-count">${all.length}</span></h2>
        <span class="layers-tools">
          <button type="button" class="layer-btn" data-sort-toggle aria-pressed="${sortOpen}" aria-expanded="${sortOpen}" aria-label="Sort the layers by name" title="Sort the layers by name">${ICONS.arrowDownAZ}</button>
          <button type="button" class="layer-btn" data-fold-all aria-label="${tree.some((n) => n.group && !open.has(n.id)) ? "Expand all groups" : "Collapse all groups"}" title="${tree.some((n) => n.group && !open.has(n.id)) ? "Expand all groups" : "Collapse all groups"}">${tree.some((n) => n.group && !open.has(n.id)) ? ICONS.chevronsUpDown : ICONS.chevronsDownUp}</button>
          <button type="button" class="layer-btn" data-close aria-label="Hide the Layers panel" title="Hide the Layers panel">${ICONS.x}</button>
        </span></header>
      ${all.length > 12 || filter ? `<div class="layers-filter"><input type="search" data-layers-filter placeholder="Filter ${all.length} layers by name" aria-label="Filter the layers by name" autocomplete="off" value="${esc(filter)}"></div>` : ""}
      ${sortOpen ? `<div class="layers-sort" role="group" aria-label="Sort by name"><span>Sort by name</span><button type="button" data-sort="asc">A to Z</button><button type="button" data-sort="desc">Z to A</button><small>Only the stacking order changes; nothing moves on the canvas.</small></div>` : ""}
      <ul role="tree" aria-label="Objects, front to back">${list || `<li class="layers-empty">${q ? "No layer has that name." : "Nothing on this canvas yet."}</li>`}${rows >= limit ? `<li class="layers-more-row"><button type="button" data-more>Show ${MAX_ROWS} more rows</button></li>` : ""}</ul>
      ${footer()}
`;
    if (refocusFilter) {
      refocusFilter = false;
      const f = panel.querySelector<HTMLInputElement>("[data-layers-filter]");
      if (f) {
        f.focus();
        f.setSelectionRange(f.value.length, f.value.length);
      }
    }
    if (renaming) {
      const input = panel.querySelector<HTMLInputElement>("[data-rename]");
      if (input && document.activeElement !== input) {
        input.focus();
        input.select();
      }
    }
  };
  const schedule = (): void => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(render);
    }
  };
  actions.names.subscribe(schedule);
  // A newly selected item deep in groups is shown: its groups open (once per selection, so they can still be closed). Noted on every
  // change of the selection, not at drawing time, so a quick deselect and reselect is never missed.
  const noteSelection = (): void => {
    const selKey = [...editor.selection].sort().join(",");
    if (selKey === lastSelection) return;
    lastSelection = selKey;
    for (const id of editor.selection) {
      const o = doc.get(id);
      for (const g of o?.groups ?? []) open.add(g);
      if (o) for (const f of ancestorsOf((x) => doc.get(x), o)) open.add(f.id); // (a picked object's sheets open to show it)
    }
  };
  doc.subscribe(schedule);
  editor.subscribe(() => {
    noteSelection();
    schedule();
  });
  render();

  const members = (key: string): CanvasObject[] => {
    const o = doc.get(key);
    if (isContainer(o)) {
      const ids = new Set(withDescendants(doc.all(), [o.id]));
      return doc.ordered().filter((x) => ids.has(x.id)); // a sheet's row is the sheet and what is in it
    }
    return o ? [o] : doc.ordered().filter((x) => x.groups?.includes(key));
  };

  const endRename = (commit: boolean): void => {
    const r = renaming;
    if (!r) return;
    renaming = null;
    if (commit) actions.rename(r.key, r.value);
    render();
  };
  // Two quick presses on the same name start a rename. Not `dblclick`: the first press selects the row, the panel redraws its rows, and
  // Firefox does not dispatch `dblclick` on elements replaced between the two clicks.
  let lastPress: { key: string; at: number } | null = null;
  let startRename: { key: string; value: string } | null = null;
  // A press on another canvas (or before a document was loaded) never counts as the first press of a double press.
  doc.subscribe((source) => {
    if (source === "load") lastPress = null;
  });
  let renameOpenedAt = 0;
  panel.addEventListener("pointerdown", (e) => {
    startRename = null;
    const name = (e.target as HTMLElement).closest(".layer-name");
    const li = name?.closest<HTMLElement>("li.layer");
    if (!name || !li) return;
    const key = li.dataset["key"]!;
    const now = performance.now();
    if (lastPress && lastPress.key === key && now - lastPress.at < 500) {
      lastPress = null;
      // Started when this press ends: focusing now would be undone by the press's own focus change.
      startRename = { key, value: name.textContent ?? "" };
    } else lastPress = { key, at: now };
  });
  // Not on `click`: Firefox sends none when the rows were redrawn between press and release.
  panel.addEventListener("pointerup", () => {
    if (!startRename) return;
    renaming = startRename;
    startRename = null;
    renameOpenedAt = performance.now();
    render();
  });
  panel.addEventListener("keydown", (e) => {
    const filterInput = e.target as HTMLInputElement;
    if (filterInput.matches?.("[data-layers-filter]")) {
      e.stopPropagation();
      if (e.key === "Escape" && filter) {
        filter = "";
        refocusFilter = true;
        render();
      }
      return;
    }
    if (!(e.target as HTMLElement).matches("[data-rename]")) return;
    e.stopPropagation();
    if (e.key === "Enter") endRename(true);
    else if (e.key === "Escape") endRename(false);
  });
  panel.addEventListener("focusout", (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.matches("[data-rename]")) return;
    // The press that opened the box can still move focus away a moment later (Firefox): take it back instead of ending the edit.
    if (performance.now() - renameOpenedAt < 250 && input.isConnected) {
      setTimeout(() => input.isConnected && input.focus(), 0);
      return;
    }
    endRename(true);
  });
  panel.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-rename]") && renaming) renaming.value = t.value;
    if (t.matches("[data-layers-filter]")) {
      filter = t.value;
      limit = MAX_ROWS;
      refocusFilter = true;
      render();
    }
    if (t.matches("[data-opacity]")) t.parentElement!.querySelector("output")!.textContent = `${t.value}%`;
  });
  // `change` fires once, when the slider is released: one undo step per drag.
  panel.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-opacity]")) actions.setOpacity([...editor.selection], Number(t.value) / 100);
    if (t.matches("[data-blend]")) actions.setBlend([...editor.selection], (t.value || null) as BlendMode | null);
  });

  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const doBtn = t.closest<HTMLButtonElement>("[data-do]");
    if (doBtn && !doBtn.disabled) {
      const sel = selectedObjs();
      const ids = sel.map((o) => o.id);
      if (doBtn.dataset["do"] === "rename" && sel.length === 1) {
        const o = sel[0]!;
        renaming = { key: o.id, value: labelOf(o, names).text };
        render();
      } else if (doBtn.dataset["do"] === "hide") actions.setFlagOn(ids, "hidden", !sel.every((o) => o.hidden));
      else if (doBtn.dataset["do"] === "lock") actions.setFlagOn(ids, "locked", !sel.every((o) => o.locked));
      return;
    }
    if (t.closest("[data-more]")) {
      limit += MAX_ROWS;
      render();
      return;
    }
    if (t.closest("[data-sort-toggle]")) {
      sortOpen = !sortOpen;
      render();
      return;
    }
    const sortBtn = t.closest<HTMLElement>("[data-sort]");
    if (sortBtn) {
      const dir = sortBtn.dataset["sort"] === "desc" ? "desc" : "asc";
      actions.setOrder(sortedByName(doc.ordered(), names, dir).map((o) => o.id), `Sort layers by name, ${dir === "asc" ? "A to Z" : "Z to A"}`);
      sortOpen = false;
      render();
      return;
    }
    if (t.closest("[data-fold-all]")) {
      const groups = new Set(doc.ordered().flatMap((o) => o.groups ?? []));
      if ([...groups].some((g) => !open.has(g))) for (const g of groups) open.add(g);
      else open.clear();
      render();
      return;
    }
    if (t.closest("[data-close]")) {
      editor.layersOpen = false;
      editor.changed();
      return;
    }
    const li = t.closest<HTMLElement>("li.layer");
    if (!li) return;
    const key = li.dataset["key"]!;
    const objs = members(key);

    if (t.closest("[data-twist]")) {
      if (open.has(key)) open.delete(key);
      else open.add(key);
      render();
    } else if (t.closest("[data-clip]")) {
      const f = doc.get(key);
      if (isContainer(f)) actions.setClip(f.id, !f.container.clip);
    } else if (t.closest("[data-eye]")) {
      actions.setFlagOn(objs.map((o) => o.id), "hidden", !objs.every((o) => o.hidden));
    } else if (t.closest("[data-lock]")) {
      actions.setFlagOn(objs.map((o) => o.id), "locked", !objs.every((o) => o.locked));
    } else {
      // A shape inside a boolean group is edited from inside it: its row takes you in (the group itself and everything else, out).
      const inside = !li.dataset["group"] || li.dataset["group"] === "false" ? objs[0] : undefined;
      editor.entered = inside && isBoolMember(inside) ? [...(inside.groups ?? [])] : [];
      const ids = objs.filter((o) => !o.hidden).map((o) => o.id);
      const rowKeys = [...panel.querySelectorAll<HTMLElement>("li.layer")].map((l) => l.dataset["key"]!);
      if (e.shiftKey && anchorKey && rowKeys.includes(anchorKey) && rowKeys.includes(key)) {
        // Shift: every row from the last one clicked to this one, as shown (Ctrl+Shift adds them to what is selected).
        const a = rowKeys.indexOf(anchorKey);
        const b = rowKeys.indexOf(key);
        const range = rowKeys.slice(Math.min(a, b), Math.max(a, b) + 1).flatMap((k) => members(k).filter((o) => !o.hidden).map((o) => o.id));
        editor.select(e.ctrlKey || e.metaKey ? [...editor.selection, ...range] : range);
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl or Cmd: this row in or out of the selection.
        const all = ids.length > 0 && ids.every((id) => editor.selection.has(id));
        editor.select(all ? [...editor.selection].filter((id) => !ids.includes(id)) : [...editor.selection, ...ids]);
        anchorKey = key;
      } else {
        editor.select(ids);
        anchorKey = key;
      }
    }
  });

  // Reorder: drop a row on another to put it just in front of that row (a group moves all its members).
  panel.addEventListener("dragstart", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("li.layer");
    if (!li) return;
    dragged = members(li.dataset["key"]!).map((o) => o.id);
    e.dataTransfer?.setData("text/plain", li.dataset["key"]!);
  });
  panel.addEventListener("dragover", (e) => {
    if (dragged.length && (e.target as HTMLElement).closest("li.layer")) e.preventDefault();
  });
  panel.addEventListener("drop", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("li.layer");
    if (!li || !dragged.length) return;
    e.preventDefault();
    const targetMembers = members(li.dataset["key"]!);
    // In front of the target's frontmost member.
    const top = [...targetMembers].sort((a, b) => b.z - a.z)[0];
    if (top) actions.moveAbove(dragged, top.id);
    dragged = [];
  });
}
