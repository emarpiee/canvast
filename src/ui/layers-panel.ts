import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { BlendMode, CanvasObject } from "../doc/model";
import { BLEND_MODES, MAX_NAME_LENGTH } from "../doc/model";
import type { Backlink } from "../app/session";
import { mentionIds, plainText } from "../text/markdown";
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
  moveAbove(ids: readonly string[], aboveId: string): void;
  /** Put the stacking order in name order (ADR 0059); only the order changes, never a position. `order` is front to back. */
  setOrder(order: readonly string[], label: string): void;
  /** Add or remove in-canvas tags on objects (ADR 0062). */
  tag(ids: readonly string[], change: { add?: readonly string[]; remove?: readonly string[] }): void;
  setOpacity(ids: readonly string[], opacity: number): void;
  /** Blend mode of objects (null = normal), ADR 0047. */
  setBlend(ids: readonly string[], blend: BlendMode | null): void;
  /** Point a text's mentions of a missing item at another item (ADR 0047). */
  relink(textId: string, oldId: string, newId: string, label: string): void;
  /** Items on the board's other canvases matching a query (for relinking). */
  mentionable(query: string): Promise<Backlink[]>;
  /** Name an object or a group (its id); empty = automatic label. */
  rename(key: string, name: string): void;
  /** Texts on the board's other canvases that mention an object (stored index). */
  backlinksElsewhere(id: string): Promise<Backlink[]>;
  /** Open a canvas (null = this one) and select and frame objects there. */
  /** The file name of an original (empty when unknown). */
  assetName(hash: string): Promise<string>;
  reveal(canvasId: string | null, ids: readonly string[]): void;
  /** Where mentioned objects are on the board's other canvases. */
  locateMentions(ids: readonly string[]): Promise<Map<string, Backlink>>;
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
}

/** The tree of groups and objects, front first. */
export function layerTree(objects: readonly CanvasObject[]): Node[] {
  const roots: Node[] = [];
  const groups = new Map<string, Node>();
  const sorted = [...objects].sort((a, b) => b.z - a.z || (a.id < b.id ? 1 : -1));
  for (const o of sorted) {
    let siblings = roots;
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

/** Short name of an object for lists and mention labels. */
export function labelOf(o: CanvasObject, names?: ReadonlyMap<string, string>): { icon: string; text: string; swatch?: string } {
  if (o.name) return { icon: o.kind === "stroke" ? ICONS.pencil : o.kind === "image" ? ICONS.image : ICONS.type, text: o.name, ...(o.kind !== "image" ? { swatch: o.color } : {}) };
  if (o.kind === "stroke") return { icon: ICONS.pencil, text: "Stroke", swatch: o.color };
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
  /** The tag being typed survives a redraw of the panel. */
  let tagDraft = "";
  let refocusTag = false;
  let lastSelection = "";
  /** Groups the panel has already listed: a group seen for the first time (just made) opens. */
  const seenGroups = new Set<string>();
  // File names of the originals (the catalog is read once per original).
  const names = new Map<string, string>();
  const asked = new Set<string>();
  let scheduled = false;
  let dragged: string[] = [];
  /** The row being renamed (kept across redraws) and what has been typed. */
  let renaming: { key: string; value: string } | null = null;
  /** A missing mention of a text being pointed at another item. */
  let relinking: { textId: string; oldId: string } | null = null;

  const selectedObjs = (): CanvasObject[] => [...editor.selection].map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o);
  /** Opacity of the selection (the first object's when they differ). */
  const footer = (): string => {
    const sel = selectedObjs();
    const pct = Math.round((sel[0]?.opacity ?? 1) * 100);
    const blend = sel[0]?.blend ?? "";
    const modes = ["", ...BLEND_MODES].map((m) => `<option value="${m}"${m === blend ? " selected" : ""}>${m ? m.replace(/-/g, " ") : "normal"}</option>`).join("");
    const on = [...new Map(sel.flatMap((o) => o.tags ?? []).map((t) => [t.toLowerCase(), t] as const)).values()];
    const here = [...new Map(doc.ordered().flatMap((o) => o.tags ?? []).map((t) => [t.toLowerCase(), t] as const)).values()].filter((t) => !on.some((x) => x.toLowerCase() === t.toLowerCase()));
    const tagRow = `<div class="layers-tags" data-testid="canvas-tags"><span class="layers-tags-label">Tags</span><div class="tag-chips">${on
      .map((t) => `<span class="tag-chip">#${esc(t)}<button type="button" data-untag-canvas="${esc(t)}" aria-label="Remove tag ${esc(t)} from the selection">×</button></span>`)
      .join("")}<input class="tag-input" data-canvas-tag-input list="canvas-tag-suggest" placeholder="${sel.length ? "Add a tag" : "Select items to tag"}" aria-label="Add a tag to the selection" maxlength="64" value="${esc(tagDraft)}" ${sel.length ? "" : "disabled"}><datalist id="canvas-tag-suggest">${here.map((t) => `<option value="${esc(t)}">`).join("")}</datalist></div></div>`;
    return `${tagRow}<label class="layers-blend">Blend <select data-blend ${sel.length ? "" : "disabled"} aria-label="Blend mode of the selection">${modes}</select></label><label class="layers-opacity">Opacity <input type="range" data-opacity min="${MIN_OPACITY * 100}" max="100" step="1" value="${pct}" ${sel.length ? "" : "disabled"} aria-label="Opacity of the selection"> <output>${pct}%</output></label>`;
  };

  // Links of the one selected object (ADR 0040): texts that mention it, and what a selected text mentions.
  let elsewhere: { id: string; list: Backlink[] } | null = null;
  let located: { id: string; md: string; map: Map<string, Backlink> | null } | null = null; // map null = asked, not answered
  const linkRow = (canvasId: string, id: string, label: string, where: string): string =>
    `<li><button type="button" data-go="${esc(id)}" data-canvas="${esc(canvasId)}">${esc(label || "Text")}</button><span>${esc(where)}</span></li>`;
  const linksHtml = (): string => {
    const sel = selectedObjs();
    const one = sel.length === 1 ? sel[0]! : null;
    if (!one || elsewhere?.id !== one.id) elsewhere = null; // reselecting asks the store again
    if (!one) return "";
    const here = doc.ordered().filter((o) => o.kind === "text" && o.id !== one.id && mentionIds(o.md).includes(one.id));
    const rows = here.map((o) => linkRow("", o.id, plainText((o as { md: string }).md), "this canvas"));
    if (elsewhere?.id === one.id) for (const b of elsewhere.list) rows.push(linkRow(b.canvasId, b.id, b.label, b.canvasName));
    else void actions.backlinksElsewhere(one.id).then((list) => {
      elsewhere = { id: one.id, list };
      if (editor.selection.size === 1 && editor.selection.has(one.id)) schedule();
    });
    const out: string[] = [];
    if (rows.length) out.push(`<h3>Mentioned in</h3><ul>${rows.join("")}</ul>`);
    if (one.kind === "text") {
      const ids = mentionIds(one.md);
      if (ids.length) {
        if (located?.id !== one.id || located.md !== one.md) {
          const { id, md } = one;
          located = { id, md, map: null };
          void actions.locateMentions(ids.filter((i) => !doc.get(i))).then((map) => {
            located = { id, md, map };
            if (editor.selection.size === 1 && editor.selection.has(id)) schedule();
          });
        }
        const id0 = one.id;
        const items = ids.map((id) => {
          const t = doc.get(id);
          if (t) return linkRow("", id, labelOf(t).text, "");
          const b = located?.map?.get(id);
          if (b) return linkRow(b.canvasId, id, b.label, b.canvasName);
          if (relinking?.textId === id0 && relinking.oldId === id) return `<li class="relink"><input type="text" data-relink-q placeholder="Find an item…" aria-label="Find an item to relink" autocomplete="off"><button type="button" data-relink-cancel>Cancel</button><ul data-relink-results aria-label="Items to relink to"></ul></li>`;
          return located?.map ? `<li class="broken"><span>Missing item</span><button type="button" data-relink="${esc(id)}">Relink</button></li>` : "";
        });
        out.push(`<h3>Mentions</h3><ul>${items.join("")}</ul>`);
      }
    }
    return out.join("");
  };

  const render = (): void => {
    scheduled = false;
    panel.hidden = !editor.layersOpen;
    if (!editor.layersOpen) return;
    // A name being typed is not redrawn under the cursor (a redraw would end the edit).
    if (document.activeElement?.matches?.("[data-canvas-tag-input]") && panel.contains(document.activeElement)) {
      if (tagDraft) return; // a tag being typed is not redrawn under the cursor
      refocusTag = true; // the box is redrawn (the selection changed) and keeps the focus
    }
    if ((renaming && panel.querySelector("[data-rename]")) || (relinking && panel.querySelector("[data-relink-q]"))) return;
    const all = doc.ordered();
    for (const o of all) {
      if (o.kind === "image" && !asked.has(o.assetId)) {
        asked.add(o.assetId);
        void actions.assetName(o.assetId).then((n) => {
          if (n) {
            names.set(o.assetId, n);
            schedule();
          }
        });
      }
    }
    const tree = layerTree(all);
    for (const g of new Set(all.flatMap((o) => o.groups ?? []))) {
      if (!seenGroups.has(g)) {
        seenGroups.add(g);
        if (editor.selection.size && all.some((o) => editor.selection.has(o.id) && o.groups?.includes(g))) open.add(g);
      }
    }
    let rows = 0;
    const row = (n: Node, depth: number): string => {
      if (rows >= MAX_ROWS) return "";
      rows++;
      const first = n.members[0]!;
      const lab = n.group ? { icon: ICONS.group, text: first.groupNames?.[n.id] ?? `Group (${n.members.length})`, swatch: undefined } : labelOf(first, names);
      const selected = n.members.every((m) => editor.selection.has(m.id));
      const hidden = n.members.every((m) => m.hidden);
      const locked = n.members.every((m) => m.locked);
      const expanded = n.group && open.has(n.id);
      const key = n.group ? n.id : first.id;
      const head = `<li role="treeitem" ${n.group ? `aria-expanded="${expanded}"` : ""} aria-selected="${selected}" class="layer${n.group ? " is-group" : ""}${selected ? " is-selected" : ""}${hidden ? " is-hidden" : ""}${locked ? " is-locked" : ""}" data-key="${key}" data-group="${n.group}" draggable="true" style="--depth:${depth}">
        <button type="button" class="layer-twist" data-twist ${n.group ? "" : "disabled tabindex=-1"} aria-label="${expanded ? "Collapse" : "Expand"}">${n.group ? (expanded ? ICONS.chevronDown : ICONS.chevronRight) : ""}</button>
        <span class="layer-icon">${lab.icon}</span>${lab.swatch ? `<span class="layer-swatch" style="background:${swatchBackground(lab.swatch)}"></span>` : ""}
        ${renaming?.key === key ? `<input class="layer-rename" data-rename maxlength="${MAX_NAME_LENGTH}" value="${esc(renaming.value)}" aria-label="Layer name">` : `<span class="layer-name" title="${esc([...(first.groups ?? []).slice(0, n.group ? first.groups!.indexOf(n.id) : undefined).map((g) => first.groupNames?.[g] ?? "Group"), lab.text].join(" › "))} (double-click to rename)">${esc(lab.text)}</span>${n.group ? `<span class="layer-count" title="${n.members.length} item(s) inside">${n.members.length}</span>` : ""}`}
        <button type="button" class="layer-btn" data-eye aria-pressed="${hidden}" aria-label="${hidden ? "Show" : "Hide"} ${esc(lab.text)}" title="${hidden ? "Show" : "Hide"}">${hidden ? ICONS.eyeOff : ICONS.eye}</button>
        <button type="button" class="layer-btn" data-lock aria-pressed="${locked}" aria-label="${locked ? "Unlock" : "Lock"} ${esc(lab.text)}" title="${locked ? "Unlock" : "Lock"}">${locked ? ICONS.lockKeyhole : ICONS.lockKeyholeOpen}</button>
      </li>`;
      return head + (expanded ? n.children.map((c) => row(c, depth + 1)).join("") : "");
    };
    const list = tree.map((n) => row(n, 0)).join("");
    panel.innerHTML = `
      <header><h2>Layers <span class="layers-count">${all.length}</span></h2>
        <span class="layers-tools">
          <button type="button" class="layer-btn" data-sort-toggle aria-pressed="${sortOpen}" aria-expanded="${sortOpen}" aria-label="Sort the layers by name" title="Sort the layers by name">${ICONS.arrowDownAZ}</button>
          <button type="button" class="layer-btn" data-fold-all aria-label="${tree.some((n) => n.group && !open.has(n.id)) ? "Expand all groups" : "Collapse all groups"}" title="${tree.some((n) => n.group && !open.has(n.id)) ? "Expand all groups" : "Collapse all groups"}">${tree.some((n) => n.group && !open.has(n.id)) ? ICONS.chevronsUpDown : ICONS.chevronsDownUp}</button>
          <button type="button" class="layer-btn" data-close aria-label="Hide the Layers panel" title="Hide the Layers panel">${ICONS.x}</button>
        </span></header>
      ${sortOpen ? `<div class="layers-sort" role="group" aria-label="Sort by name"><span>Sort by name</span><button type="button" data-sort="asc">A to Z</button><button type="button" data-sort="desc">Z to A</button><small>Only the stacking order changes; nothing moves on the canvas.</small></div>` : ""}
      <ul role="tree" aria-label="Objects, front to back">${list || '<li class="layers-empty">Nothing on this canvas yet.</li>'}</ul>
      <div class="layers-links" data-links>${linksHtml()}</div>
      ${footer()}
      ${rows >= MAX_ROWS ? `<p class="layers-note">Showing the front ${MAX_ROWS} rows.</p>` : ""}`;
    if (refocusTag) {
      refocusTag = false;
      panel.querySelector<HTMLInputElement>("[data-canvas-tag-input]")?.focus();
    }
    if (relinking) panel.querySelector<HTMLInputElement>("[data-relink-q]")?.focus();
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
  // A newly selected item deep in groups is shown: its groups open (once per selection, so they can still be closed). Noted on every
  // change of the selection, not at drawing time, so a quick deselect and reselect is never missed.
  const noteSelection = (): void => {
    const selKey = [...editor.selection].sort().join(",");
    if (selKey === lastSelection) return;
    lastSelection = selKey;
    for (const id of editor.selection) for (const g of doc.get(id)?.groups ?? []) open.add(g);
  };
  doc.subscribe(schedule);
  editor.subscribe(() => {
    noteSelection();
    schedule();
  });
  render();

  const members = (key: string): CanvasObject[] => {
    const o = doc.get(key);
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
    const tagInput = e.target as HTMLInputElement;
    if (tagInput.matches?.("[data-canvas-tag-input]")) {
      e.stopPropagation(); // typing a tag never reaches the canvas shortcuts
      if (e.key === "Enter") {
        const add = tagInput.value.split(",");
        tagDraft = "";
        refocusTag = true;
        if (add.join("").trim()) actions.tag([...editor.selection], { add });
        else render();
        e.preventDefault();
      } else if (e.key === "Escape") {
        tagDraft = "";
        tagInput.blur();
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
    if (t.matches("[data-relink-q]") && relinking) {
      const q = t.value.trim().toLowerCase();
      const out = panel.querySelector<HTMLElement>("[data-relink-results]")!;
      const textId = relinking.textId;
      const here = doc.ordered().filter((o) => o.id !== textId && labelOf(o, names).text.toLowerCase().includes(q)).slice(0, 6);
      const item = (id: string, label: string, where: string): string => `<li><button type="button" data-relink-pick="${esc(id)}" data-label="${esc(label)}">${esc(label)}</button><span>${esc(where)}</span></li>`;
      out.innerHTML = here.map((o) => item(o.id, labelOf(o, names).text, "this canvas")).join("");
      const asked = q;
      void actions.mentionable(t.value).then((list) => {
        if (relinking?.textId !== textId || t.value.trim().toLowerCase() !== asked) return;
        out.insertAdjacentHTML("beforeend", list.map((b) => item(b.id, b.label, b.canvasName)).join(""));
      });
    }
    if (t.matches("[data-canvas-tag-input]")) tagDraft = t.value;
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
    const go = t.closest<HTMLElement>("[data-go]");
    if (go) {
      actions.reveal(go.dataset["canvas"] || null, [go.dataset["go"]!]);
      return;
    }
    const rl = t.closest<HTMLElement>("[data-relink]");
    if (rl && editor.selection.size === 1) {
      relinking = { textId: [...editor.selection][0]!, oldId: rl.dataset["relink"]! };
      render();
      return;
    }
    const pick = t.closest<HTMLElement>("[data-relink-pick]");
    if (pick && relinking) {
      const r = relinking;
      relinking = null;
      located = null;
      actions.relink(r.textId, r.oldId, pick.dataset["relinkPick"]!, pick.dataset["label"] ?? "");
      render();
      return;
    }
    if (t.closest("[data-relink-cancel]")) {
      relinking = null;
      render();
      return;
    }
    const untag = t.closest<HTMLElement>("[data-untag-canvas]");
    if (untag) {
      actions.tag([...editor.selection], { remove: [untag.dataset["untagCanvas"]!] });
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
    } else if (t.closest("[data-eye]")) {
      actions.setFlagOn(objs.map((o) => o.id), "hidden", !objs.every((o) => o.hidden));
    } else if (t.closest("[data-lock]")) {
      actions.setFlagOn(objs.map((o) => o.id), "locked", !objs.every((o) => o.locked));
    } else {
      editor.entered = [];
      editor.select(objs.filter((o) => !o.hidden).map((o) => o.id), e.shiftKey || e.ctrlKey || e.metaKey);
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
