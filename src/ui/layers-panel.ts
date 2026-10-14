import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { CanvasObject } from "../doc/model";
import type { Backlink } from "../app/session";
import { mentionIds, plainText } from "../text/markdown";
import { esc } from "./format";
import { ICONS } from "./icons";

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
  setOpacity(ids: readonly string[], opacity: number): void;
  /** Texts on the board's other canvases that mention an object (stored index). */
  backlinksElsewhere(id: string): Promise<Backlink[]>;
  /** Open a canvas (null = this one) and select and frame objects there. */
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

/** Short name of an object for lists and mention labels. */
export function labelOf(o: CanvasObject): { icon: string; text: string; swatch?: string } {
  if (o.kind === "stroke") return { icon: ICONS.pencil, text: "Stroke", swatch: o.color };
  if (o.kind === "image") return { icon: ICONS.image, text: `Image ${o.pixelW}×${o.pixelH}` };
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
  let scheduled = false;
  let dragged: string[] = [];

  const selectedObjs = (): CanvasObject[] => [...editor.selection].map((id) => doc.get(id)).filter((o): o is CanvasObject => !!o);
  /** Opacity of the selection (the first object's when they differ). */
  const footer = (): string => {
    const sel = selectedObjs();
    const pct = Math.round((sel[0]?.opacity ?? 1) * 100);
    return `<label class="layers-opacity">Opacity <input type="range" data-opacity min="${MIN_OPACITY * 100}" max="100" step="1" value="${pct}" ${sel.length ? "" : "disabled"} aria-label="Opacity of the selection"> <output>${pct}%</output></label>`;
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
        const items = ids.map((id) => {
          const t = doc.get(id);
          if (t) return linkRow("", id, labelOf(t).text, "");
          const b = located?.map?.get(id);
          if (b) return linkRow(b.canvasId, id, b.label, b.canvasName);
          return located?.map ? `<li class="broken"><span>Missing item</span><span>not on this board</span></li>` : "";
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
    const all = doc.ordered();
    const tree = layerTree(all);
    let rows = 0;
    const row = (n: Node, depth: number): string => {
      if (rows >= MAX_ROWS) return "";
      rows++;
      const first = n.members[0]!;
      const lab = n.group ? { icon: ICONS.group, text: `Group (${n.members.length})`, swatch: undefined } : labelOf(first);
      const selected = n.members.every((m) => editor.selection.has(m.id));
      const hidden = n.members.every((m) => m.hidden);
      const locked = n.members.every((m) => m.locked);
      const expanded = n.group && open.has(n.id);
      const key = n.group ? n.id : first.id;
      const head = `<li role="treeitem" ${n.group ? `aria-expanded="${expanded}"` : ""} aria-selected="${selected}" class="layer${selected ? " is-selected" : ""}${hidden ? " is-hidden" : ""}${locked ? " is-locked" : ""}" data-key="${key}" data-group="${n.group}" draggable="true" style="--depth:${depth}">
        <button type="button" class="layer-twist" data-twist ${n.group ? "" : "disabled tabindex=-1"} aria-label="${expanded ? "Collapse" : "Expand"}">${n.group ? (expanded ? ICONS.chevronDown : ICONS.chevronRight) : ""}</button>
        <span class="layer-icon">${lab.icon}</span>${lab.swatch ? `<span class="layer-swatch" style="background:${lab.swatch}"></span>` : ""}
        <span class="layer-name">${esc(lab.text)}</span>
        <button type="button" class="layer-btn" data-eye aria-pressed="${hidden}" aria-label="${hidden ? "Show" : "Hide"} ${esc(lab.text)}" title="${hidden ? "Show" : "Hide"}">${hidden ? ICONS.eyeOff : ICONS.eye}</button>
        <button type="button" class="layer-btn" data-lock aria-pressed="${locked}" aria-label="${locked ? "Unlock" : "Lock"} ${esc(lab.text)}" title="${locked ? "Unlock" : "Lock"}">${locked ? ICONS.lockKeyhole : ICONS.lockKeyholeOpen}</button>
      </li>`;
      return head + (expanded ? n.children.map((c) => row(c, depth + 1)).join("") : "");
    };
    const list = tree.map((n) => row(n, 0)).join("");
    panel.innerHTML = `
      <header><h2>Layers <span class="layers-count">${all.length}</span></h2><button type="button" class="layer-btn" data-close aria-label="Hide the Layers panel" title="Hide the Layers panel">${ICONS.x}</button></header>
      <ul role="tree" aria-label="Objects, front to back">${list || '<li class="layers-empty">Nothing on this canvas yet.</li>'}</ul>
      <div class="layers-links" data-links>${linksHtml()}</div>
      ${footer()}
      ${rows >= MAX_ROWS ? `<p class="layers-note">Showing the front ${MAX_ROWS} rows.</p>` : ""}`;
  };
  const schedule = (): void => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(render);
    }
  };
  doc.subscribe(schedule);
  editor.subscribe(schedule);
  render();

  const members = (key: string): CanvasObject[] => {
    const o = doc.get(key);
    return o ? [o] : doc.ordered().filter((x) => x.groups?.includes(key));
  };

  panel.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-opacity]")) t.parentElement!.querySelector("output")!.textContent = `${t.value}%`;
  });
  // `change` fires once, when the slider is released: one undo step per drag.
  panel.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-opacity]")) actions.setOpacity([...editor.selection], Number(t.value) / 100);
  });

  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const go = t.closest<HTMLElement>("[data-go]");
    if (go) {
      actions.reveal(go.dataset["canvas"] || null, [go.dataset["go"]!]);
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
