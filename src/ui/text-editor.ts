import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";
import { lookAt, worldToScreen } from "../core/camera";
import { fromLocal } from "../core/frames";
import { cameraIn } from "../scene/frame-index";
import type { ViewState } from "../app/view-state";
import type { EditorState } from "../app/editor-state";
import type { DocumentStore } from "../doc/document-store";
import type { TextObject } from "../doc/model";
import { homeObject, newObjectId, pivotOf } from "../doc/model";
import { radiansFromAngle } from "../core/angle";
import { normalizeUnit } from "../doc/edit-ops";
import type { Block, BlockType, Span } from "../text/markdown";
import { MAX_MARKDOWN_LENGTH, parse, serialize } from "../text/markdown";
import { layoutText } from "../text/layout";
import { TEXT_FONT_FAMILY } from "../render/draw-text";
import { paintColor } from "../render/ink";
import { ICONS } from "./icons";
import { esc } from "./format";
import { labelOf } from "./layers-panel";

/**
 * WYSIWYG text editing with a native contenteditable overlay placed exactly
 * over the text object, in the same font, size, wrap width, line height and
 * block spacing (ADR 0013). The overlay is only an editing surface: on
 * commit its DOM is read back into blocks and stored as canonical Markdown,
 * never as HTML. While it is open the object is hidden on the canvas.
 */

/** Size of new text, in CSS px at the zoom where it is created. */
export const NEW_TEXT_PX = 16;
export const NEW_TEXT_WRAP_PX = 320;
/** Editing happens at a readable size: outside this range the camera zooms to NEW_TEXT_PX first. */
const MIN_EDIT_PX = 9;
const MAX_EDIT_PX = 72;

let lastCopied = "";

/** Text most recently put on the clipboard by canvast (tests read it; browsers may not allow reading the clipboard). */
export function lastCopiedText(): string {
  return lastCopied;
}

export async function copyText(s: string): Promise<void> {
  lastCopied = s;
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    const t = document.createElement("textarea");
    t.value = s;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

const FORMATS: Array<{ cmd: string; icon: string; label: string }> = [
  { cmd: "bold", icon: ICONS.bold, label: "Bold (Ctrl+B)" },
  { cmd: "italic", icon: ICONS.italic, label: "Italic (Ctrl+I)" },
  { cmd: "h1", icon: ICONS.heading1, label: "Heading 1" },
  { cmd: "h2", icon: ICONS.heading2, label: "Heading 2" },
  { cmd: "h3", icon: ICONS.heading3, label: "Heading 3" },
  { cmd: "p", icon: ICONS.pilcrow, label: "Body text" },
  { cmd: "ul", icon: ICONS.list, label: "Bulleted list" },
  { cmd: "ol", icon: ICONS.listOrdered, label: "Numbered list" },
  { cmd: "copy", icon: ICONS.copy, label: "Copy Markdown" },
  { cmd: "done", icon: ICONS.check, label: "Done (Esc)" },
];

export interface TextEditor {
  open(target: TextObject | null, at: WorldPoint): void;
  commit(): void;
  readonly isOpen: boolean;
}

export function mountTextEditor(
  host: HTMLElement,
  view: ViewState,
  doc: DocumentStore,
  editor: EditorState,
  /** Texts and images on the board's other canvases matching a query (the picker's second list). */
  elsewhere: (query: string) => Promise<Array<{ id: string; label: string; canvasName: string }>> = () => Promise.resolve([]),
  /** The file name of an original (an image is listed by it, not by its pixel size). */
  assetName: (hash: string) => Promise<string> = () => Promise.resolve(""),
): TextEditor {
  const box = document.createElement("div");
  box.className = "text-editor";
  box.contentEditable = "true";
  box.spellcheck = false;
  box.hidden = true;
  box.dataset["testid"] = "text-editor";
  box.setAttribute("role", "textbox");
  box.setAttribute("aria-multiline", "true");
  box.setAttribute("aria-label", "Text");
  const bar = document.createElement("div");
  bar.className = "toolbar text-format";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Text format");
  bar.hidden = true;
  bar.innerHTML = FORMATS.map((f) => `<button type="button" data-cmd="${f.cmd}" aria-label="${f.label}" title="${f.label}">${f.icon}</button>`).join("");
  const picker = document.createElement("div");
  picker.className = "mention-picker";
  picker.hidden = true;
  picker.innerHTML = `<input type="text" aria-label="Mention an item" placeholder="Mention an item…" autocomplete="off"><ul role="listbox" aria-label="Items on this canvas"></ul>`;
  host.append(box, bar, picker);
  const pickInput = picker.querySelector("input")!;
  const pickList = picker.querySelector("ul")!;

  let target: TextObject | null = null;
  let isNew = false;

  const position = (): void => {
    if (!target) return;
    // The camera in the text's frame (ADR 0014); the text is near the view, so this is cheap.
    const cam = cameraIn(view.frameCamera, target.frame ?? doc.space.world) ?? view.camera;
    const s = worldToScreen(cam, view.viewport, target.anchor);
    const ppu = 2 ** (target.unit + cam.zi + cam.zf);
    const em = target.size * ppu;
    box.style.left = `${s.x}px`;
    box.style.top = `${s.y}px`;
    box.style.width = `${target.w * ppu}px`;
    box.style.fontSize = `${em}px`;
    box.style.setProperty("--em", `${em}px`);
    // A turned text is edited turned, about the same pivot it is drawn about.
    if (target.rot) {
      const pv = pivotOf(target);
      box.style.transformOrigin = `${pv.x * ppu}px ${pv.y * ppu}px`;
      box.style.transform = `rotate(${radiansFromAngle(target.rot)}rad)`;
    } else {
      box.style.transform = "";
    }
    box.style.color = paintColor(target.color);
    box.style.fontFamily = `${TEXT_FONT_FAMILY}, sans-serif`;
    bar.style.left = `${Math.max(4, s.x)}px`;
    bar.style.top = `${Math.max(4, s.y - 48)}px`;
  };

  /** Zoom so the text is at a readable size, with its top-left corner in view. */
  const zoomToEdit = (o: TextObject): void => {
    const of = o.frame ?? doc.space.world;
    const cam = cameraIn(view.frameCamera, of) ?? { zi: -Infinity, zf: 0 };
    const px = Math.log2(o.size) + o.unit + cam.zi + cam.zf;
    if (px >= Math.log2(MIN_EDIT_PX) && px <= Math.log2(MAX_EDIT_PX)) return;
    const level = Math.log2(NEW_TEXT_PX / o.size) - o.unit;
    const zi = Math.floor(level);
    const zf = level - zi;
    const vp = view.viewport;
    const l = layoutText(o.md, o.w / o.size);
    const dx = Math.min((o.w / o.size) * NEW_TEXT_PX, vp.width - 64) / 2;
    const dy = Math.min(l.height * NEW_TEXT_PX, vp.height - 160) / 2;
    const off = (px: number): D.Dyadic => D.shift(D.fromNumber(px / 2 ** zf), -zi);
    view.setFrameCamera(fromLocal(of, lookAt({ x: D.add(o.anchor.x, off(dx)), y: D.add(o.anchor.y, off(dy)) }, zi, zf)));
  };

  // `@` opens a picker of this canvas's objects; the pick becomes an atomic mention span (ADR 0039).
  let pickAt: Range | null = null;
  let choices: Array<{ id: string; label: string; canvasName?: string }> = [];
  let asked = 0;
  let active = 0;
  const closePicker = (refocus: boolean): void => {
    picker.hidden = true;
    pickAt = null;
    if (refocus) box.focus({ preventScroll: true });
  };
  const fileNames = new Map<string, string>();
  const askedNames = new Set<string>();
  const fillPicker = (): void => {
    const q = pickInput.value.trim().toLowerCase();
    for (const o of doc.ordered()) {
      if (o.kind !== "image" || askedNames.has(o.assetId)) continue;
      askedNames.add(o.assetId);
      void assetName(o.assetId).then((n) => {
        if (!n) return;
        fileNames.set(o.assetId, n);
        if (!picker.hidden) fillPicker();
      });
    }
    choices = [...doc.ordered()].reverse().filter((o) => o.id !== target?.id).map((o) => ({ id: o.id, label: labelOf(o, fileNames).text })).filter((c) => c.label.toLowerCase().includes(q)).slice(0, 8);
    const ask = ++asked;
    void elsewhere(q).then((more) => {
      if (ask !== asked || picker.hidden) return; // a newer query, or closed
      choices = [...choices.filter((c) => !c.canvasName), ...more.filter((m) => !choices.some((c) => c.id === m.id))];
      paint();
    });
    paint();
  };
  const paint = (): void => {
    active = Math.min(active, Math.max(0, choices.length - 1));
    pickList.innerHTML = choices.length
      ? choices.map((c, i) => `<li role="option" aria-selected="${i === active}" data-id="${c.id}">${esc(c.label)}${c.canvasName ? ` <small>${esc(c.canvasName)}</small>` : ""}</li>`).join("")
      : `<li class="empty">Nothing matches.</li>`;
  };
  const openPicker = (): void => {
    const sel = getSelection();
    if (!sel?.rangeCount || sel.anchorNode?.nodeType !== Node.TEXT_NODE) return;
    pickAt = sel.getRangeAt(0).cloneRange();
    const r = box.getBoundingClientRect();
    picker.style.left = `${Math.max(4, r.left)}px`;
    picker.style.top = `${r.bottom + 6}px`;
    pickInput.value = "";
    active = 0;
    fillPicker();
    picker.hidden = false;
    pickInput.focus();
  };
  const choose = (i: number): void => {
    const c = choices[i];
    const r = pickAt;
    closePicker(true);
    if (!c || !r) return;
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    const t = r.startContainer;
    if (t.nodeType === Node.TEXT_NODE && r.startOffset > 0 && (t as Text).data[r.startOffset - 1] === "@") r.setStart(t, r.startOffset - 1); // the typed @
    r.deleteContents();
    const m = document.createElement("span");
    m.className = "mention";
    m.contentEditable = "false";
    m.dataset["ref"] = c.id;
    m.textContent = c.label;
    const gap = document.createTextNode(" ");
    r.insertNode(gap);
    r.insertNode(m);
    r.setStartAfter(gap);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  };
  box.addEventListener("input", (e) => {
    if ((e as InputEvent).data === "@") openPicker();
  });
  pickInput.addEventListener("input", () => {
    active = 0;
    fillPicker();
  });
  pickInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePicker(true);
    else if (e.key === "Enter") choose(active);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % Math.max(1, choices.length);
      paint();
    } else return;
    e.preventDefault();
    e.stopPropagation(); // Esc closes the picker, not the editor
  });
  pickList.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-id]");
    if (li) choose(choices.findIndex((c) => c.id === li.dataset["id"]));
  });

  const close = (): void => {
    closePicker(false);
    target = null; // first: hiding the focused box fires focusout (and commit) synchronously
    box.hidden = bar.hidden = true;
    box.innerHTML = "";
    if (editor.preview.kind === "edit") editor.preview = { kind: "none" };
    editor.changed();
  };

  const commit = (): void => {
    if (!target) return;
    const md = serialize(domToBlocks(box));
    if (md.length > MAX_MARKDOWN_LENGTH) {
      editor.message = `Text is too long to save (${md.length.toLocaleString()} of ${MAX_MARKDOWN_LENGTH.toLocaleString()} characters).`;
      editor.changed();
      return;
    }
    const o = target;
    const wasNew = isNew;
    close();
    const cur = doc.get(o.id);
    if (wasNew || !cur || cur.kind !== "text") {
      if (md) doc.commit(doc.transaction("Add text", [homeObject(normalizeUnit({ ...o, md, z: doc.topZ() + 1 }), doc.space)]));
    } else if (!md) {
      doc.commit(doc.transaction("Delete text", [], [o.id]));
      editor.selection.delete(o.id);
    } else if (md !== cur.md) {
      doc.commit(doc.transaction("Edit text", [{ ...cur, md }]));
    }
  };

  const open = (t: TextObject | null, at: WorldPoint): void => {
    commit();
    if (editor.blockEdit()) return;
    const cam = view.camera;
    if (t) {
      zoomToEdit(t);
      target = t;
      isNew = false;
      editor.preview = { kind: "edit", ids: [t.id] };
    } else {
      const f = 2 ** cam.zf;
      const unit = -cam.zi;
      const size = NEW_TEXT_PX / f;
      // The click point is the middle of the first line.
      const anchor = { x: at.x, y: D.sub(at.y, D.shift(D.fromNumber(size * 0.65), unit)) };
      // `at` is in the camera frame's coordinates: the new text starts there.
      const frame = view.frame === doc.space.world ? {} : { frame: view.frame };
      target = { id: newObjectId(), kind: "text", ...frame, anchor, unit, z: 0, opacity: 1, attachmentTargetId: null, md: "", w: NEW_TEXT_WRAP_PX / f, size, color: editor.penColor };
      isNew = true;
    }
    box.innerHTML = blocksToHtml(parse(target.md));
    box.hidden = bar.hidden = false;
    position();
    box.focus({ preventScroll: true });
    // Caret at the end of the last text, inside its block (formatting applies to that block).
    let end: Node = box;
    while (end.lastChild) end = end.lastChild;
    const r = document.createRange();
    r.selectNodeContents(end === box || end.nodeType === Node.TEXT_NODE ? end : end.parentNode!);
    r.collapse(false);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(r);
    editor.changed();
  };

  view.subscribe(position);
  bar.addEventListener("mousedown", (e) => e.preventDefault()); // keep the text selection
  bar.addEventListener("click", (e) => {
    const cmd = (e.target as HTMLElement).closest<HTMLElement>("[data-cmd]")?.dataset["cmd"];
    if (!cmd) return;
    if (cmd === "done") commit();
    else if (cmd === "copy") {
      void copyText(serialize(domToBlocks(box))).then(() => {
        editor.message = "Copied Markdown";
        editor.changed();
      });
    } else if (cmd === "ul") document.execCommand("insertUnorderedList");
    else if (cmd === "ol") document.execCommand("insertOrderedList");
    else if (cmd === "bold" || cmd === "italic") document.execCommand(cmd);
    else document.execCommand("formatBlock", false, `<${cmd === "p" ? "div" : cmd}>`);
  });
  box.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    // Handled here: not every browser binds these in editable content (and U has no Markdown form).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === "b" || k === "i" || k === "u")) {
      e.preventDefault();
      if (k !== "u") document.execCommand(k === "b" ? "bold" : "italic");
      return;
    }
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      commit();
      host.querySelector<HTMLElement>("canvas")?.focus({ preventScroll: true });
    }
  });
  // Pasting keeps only the plain text (a Markdown note is the place for formatted content).
  box.addEventListener("paste", (e) => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData?.getData("text/plain") ?? "");
  });
  box.addEventListener("focusout", (e) => {
    const to = e.relatedTarget as Node | null;
    if (to && (box.contains(to) || bar.contains(to) || picker.contains(to))) return;
    commit();
  });

  return {
    open,
    commit,
    get isOpen() {
      return target !== null;
    },
  };
}

function blocksToHtml(blocks: readonly Block[]): string {
  let html = "";
  let list: "ul" | "ol" | null = null;
  const spans = (ss: readonly Span[]): string =>
    ss.map((s) => {
      if (s.ref !== undefined) return `<span class="mention" contenteditable="false" data-ref="${esc(s.ref)}">${esc(s.text)}</span>`;
      let h = esc(s.text);
      if (s.italic) h = `<i>${h}</i>`;
      if (s.bold) h = `<b>${h}</b>`;
      return h;
    }).join("");
  for (const b of blocks) {
    const l = b.type === "ul" || b.type === "ol" ? b.type : null;
    if (list !== l) {
      if (list) html += `</${list}>`;
      if (l) html += `<${l}>`;
      list = l;
    }
    const tag = l ? "li" : b.type === "p" ? "div" : b.type;
    html += `<${tag}>${spans(b.spans)}</${tag}>`;
  }
  if (list) html += `</${list}>`;
  return html;
}

const HEADING: Record<string, BlockType> = { H1: "h1", H2: "h2", H3: "h3", H4: "h3", H5: "h3", H6: "h3" };

/** Read the editing surface back into blocks; styles come from the computed style of each text run. */
export function domToBlocks(root: HTMLElement): Block[] {
  const blocks: Block[] = [];
  let cur: { type: BlockType; spans: Span[] } | null = null;
  const end = (): void => {
    if (cur?.spans.length) blocks.push(cur);
    cur = null;
  };
  const start = (type: BlockType): void => {
    end();
    cur = { type, spans: [] };
  };
  const walk = (n: Node, type: BlockType): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = (n as Text).data.replace(/[ \r\n\t]/g, " ");
      if (!text) return;
      if (!cur) start(type);
      const cs = getComputedStyle(n.parentElement!);
      cur!.spans.push({ text, bold: Number(cs.fontWeight) >= 600, italic: cs.fontStyle !== "normal" });
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    if (n.dataset["ref"] !== undefined) {
      if (!cur) start(type);
      cur!.spans.push({ text: n.textContent ?? "", bold: false, italic: false, ref: n.dataset["ref"] });
      return;
    }
    const tag = n.tagName;
    if (tag === "BR") return end();
    if (tag === "UL" || tag === "OL") {
      end();
      for (const c of n.childNodes) walk(c, tag === "UL" ? "ul" : "ol");
      return end();
    }
    const block = HEADING[tag] ?? (tag === "LI" || tag === "DIV" || tag === "P" ? type : null);
    if (block) {
      start(block);
      for (const c of n.childNodes) walk(c, block);
      return end();
    }
    for (const c of n.childNodes) walk(c, type);
  };
  for (const c of root.childNodes) walk(c, "p");
  end();
  return blocks;
}
