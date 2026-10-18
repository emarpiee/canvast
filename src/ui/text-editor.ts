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
import { layoutOf } from "../text/layout";
import { NEW_TEXT_PX, fitWidth, lookOf, withLook } from "../text/text-style";
import type { TextLook } from "../text/text-style";
import { FALLBACK_FAMILY, familyFor } from "../text/fonts";
import { paintColor } from "../render/ink";
import { ICONS } from "./icons";
import { esc } from "./format";
import { openColourPopover } from "./colour-popover";

/**
 * WYSIWYG text editing with a native contenteditable overlay placed exactly
 * over the text object, in the same font, size, wrap width, line height and
 * block spacing (ADR 0013). The overlay is only an editing surface: on
 * commit its DOM is read back into blocks and stored as canonical Markdown,
 * never as HTML. While it is open the object is hidden on the canvas.
 */

/** Size of new text, in CSS px at the zoom where it is created. */
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
  { cmd: "underline", icon: ICONS.underline, label: "Underline (Ctrl+U)" },
  { cmd: "strike", icon: ICONS.strikethrough, label: "Strikethrough (Ctrl+Shift+X)" },
  { cmd: "colour", icon: ICONS.textColour, label: "Colour of the selected words" },
  { cmd: "bigger", icon: ICONS.textBigger, label: "Make the selected words bigger" },
  { cmd: "smaller", icon: ICONS.textSmaller, label: "Make the selected words smaller" },
  { cmd: "h1", icon: ICONS.heading1, label: "Heading 1" },
  { cmd: "h2", icon: ICONS.heading2, label: "Heading 2" },
  { cmd: "h3", icon: ICONS.heading3, label: "Heading 3" },
  { cmd: "p", icon: ICONS.pilcrow, label: "Body text" },
  { cmd: "ul", icon: ICONS.list, label: "Bulleted list" },
  { cmd: "ol", icon: ICONS.listOrdered, label: "Numbered list" },
  { cmd: "copy", icon: ICONS.clipboardCopy, label: "Copy Markdown" },
  { cmd: "done", icon: ICONS.check, label: "Done (Esc)" },
];

export interface TextEditor {
  /** Edit `target`, or a new text: at the point `at` (the middle of its first line), as wide as its words, or (`widthPx`, dragged out) as wide as that, from its top-left corner. */
  open(target: TextObject | null, at: WorldPoint, box?: { widthPx: number }): void;
  commit(): void;
  readonly isOpen: boolean;
  /** The look of the text being edited at the zoom now (null: none is open). */
  look(): ReturnType<typeof lookOf> | null;
  /** Change the look of the text being edited (stored when the edit is finished). */
  restyle(look: TextLook): void;
}

export function mountTextEditor(
  host: HTMLElement,
  view: ViewState,
  doc: DocumentStore,
  editor: EditorState,
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
  host.append(box, bar);

  let target: TextObject | null = null;
  let isNew = false;
  /** The look was changed while editing: the edited object (not the stored one) carries it. */
  let restyled = false;
  const ppuNow = (): number => {
    if (!target) return 0;
    const cam = cameraIn(view.frameCamera, target.frame ?? doc.space.world) ?? view.camera;
    return 2 ** (target.unit + cam.zi + cam.zf);
  };

  const position = (): void => {
    if (!target) return;
    // The camera in the text's frame (ADR 0014); the text is near the view, so this is cheap.
    const cam = cameraIn(view.frameCamera, target.frame ?? doc.space.world) ?? view.camera;
    const s = worldToScreen(cam, view.viewport, target.anchor);
    const ppu = 2 ** (target.unit + cam.zi + cam.zf);
    const em = target.size * ppu;
    box.style.left = `${s.x}px`;
    box.style.top = `${s.y}px`;
    box.style.width = target.autoWidth ? "max-content" : `${target.w * ppu}px`;
    box.style.minWidth = target.autoWidth ? `${em * 0.5}px` : "";
    box.style.textAlign = target.align ?? "left";
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
    box.style.fontFamily = `${familyFor(target.assetId)}, ${FALLBACK_FAMILY}`;
    box.style.lineHeight = String(target.lineHeight ?? 1.3);
    box.style.letterSpacing = `${target.tracking ?? 0}em`;
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
    const l = layoutOf(o);
    const dx = Math.min((o.w / o.size) * NEW_TEXT_PX, vp.width - 64) / 2;
    const dy = Math.min(l.height * NEW_TEXT_PX, vp.height - 160) / 2;
    const off = (px: number): D.Dyadic => D.shift(D.fromNumber(px / 2 ** zf), -zi);
    view.setFrameCamera(fromLocal(of, lookAt({ x: D.add(o.anchor.x, off(dx)), y: D.add(o.anchor.y, off(dy)) }, zi, zf)));
  };

  const close = (): void => {
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
    const wasRestyled = restyled;
    close();
    const cur = doc.get(o.id);
    if (wasNew || !cur || cur.kind !== "text") {
      if (md) doc.commit(doc.transaction("Add text", [homeObject(normalizeUnit(fitWidth({ ...o, md, z: doc.topZ() + 1 })), doc.space)]));
    } else if (!md) {
      doc.commit(doc.transaction("Delete text", [], [o.id]));
      editor.selection.delete(o.id);
    } else if (md !== cur.md || wasRestyled) {
      doc.commit(doc.transaction("Edit text", [fitWidth(wasRestyled ? { ...o, md } : { ...cur, md })]));
    }
  };

  const open = (t: TextObject | null, at: WorldPoint, drawn?: { widthPx: number }): void => {
    commit();
    if (editor.blockEdit()) return;
    restyled = false;
    const cam = view.camera;
    if (t) {
      zoomToEdit(t);
      target = t;
      isNew = false;
      editor.preview = { kind: "edit", ids: [t.id] };
    } else {
      const f = 2 ** cam.zf;
      const unit = -cam.zi;
      const look = editor.textLook;
      const size = (look.sizePx ?? NEW_TEXT_PX) / f;
      // A click: the point is the middle of the first line. A drag: the top-left corner of the box that was drawn.
      const anchor = drawn ? at : { x: at.x, y: D.sub(at.y, D.shift(D.fromNumber(size * 0.65), unit)) };
      // `at` is in the camera frame's coordinates: the new text starts there.
      const frame = view.frame === doc.space.world ? {} : { frame: view.frame };
      const base: TextObject = { id: newObjectId(), kind: "text", ...frame, anchor, unit, z: 0, opacity: 1, attachmentTargetId: null, md: "", w: drawn ? drawn.widthPx / f : size, size, color: look.color ?? editor.penColor };
      target = withLook(base, { ...look, autoWidth: !drawn });
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

  /** The words selected in the box (null: none, or the caret only). */
  const selectedRange = (): Range | null => {
    const sel = getSelection();
    const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    return r && !r.collapsed && box.contains(r.commonAncestorContainer) ? r : null;
  };
  const needWords = (): void => {
    editor.message = "Select the words first.";
    editor.changed();
  };
  /**
   * Make the selected words `factor` times their size: each run of selected text is put in a span with a size relative to what it sits in,
   * so a second press makes it bigger still, and a run that was already sized keeps the size it had.
   */
  const resizeSelection = (factor: number): void => {
    const r = selectedRange();
    if (!r) return needWords();
    const root = r.commonAncestorContainer.nodeType === Node.TEXT_NODE ? r.commonAncestorContainer.parentNode! : r.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const runs: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (r.intersectsNode(n) && (n as Text).data.length) runs.push(n as Text);
    if (!runs.length) return needWords();
    const { startContainer, startOffset, endContainer, endOffset } = r;
    // Cut the first and last run where the selection begins and ends (the end first, so the start offset still holds).
    const last = runs[runs.length - 1]!;
    if (last === endContainer && endOffset < last.data.length) last.splitText(endOffset);
    if (runs[0] === startContainer && startOffset > 0) runs[0] = runs[0]!.splitText(startOffset);
    const spans = runs.filter((t) => t.data.length).map((t) => {
      const span = document.createElement("span");
      span.style.fontSize = `${factor * 100}%`;
      t.replaceWith(span);
      span.append(t);
      return span;
    });
    // Keep the words selected, so that bigger and smaller can be pressed again.
    const sel = document.createRange();
    sel.setStartBefore(spans[0]!);
    sel.setEndAfter(spans[spans.length - 1]!);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(sel);
  };
  /** The colour of the selected words, chosen in the colour picker (the selection is kept while the picker has the focus). */
  const pickSelectionColour = (anchor: HTMLElement): void => {
    const r = selectedRange();
    if (!r) return needWords();
    const saved = r.cloneRange();
    const first = r.startContainer.nodeType === Node.TEXT_NODE ? r.startContainer.parentElement : (r.startContainer as HTMLElement);
    const now = first ? hexOfCss(getComputedStyle(first).color) : "#000000";
    openColourPopover(anchor.closest("button") ?? anchor, {
      name: "Colour of the selected words",
      value: now,
      alpha: true,
      onInput: (hex) => {
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(saved);
        document.execCommand("styleWithCSS", false, "true");
        document.execCommand("foreColor", false, cssOfHex(hex));
        if (sel && sel.rangeCount) saved.setStart(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset), saved.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
      },
    });
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
    else if (cmd === "bold" || cmd === "italic" || cmd === "underline") document.execCommand(cmd);
    else if (cmd === "strike") document.execCommand("strikeThrough");
    else if (cmd === "bigger" || cmd === "smaller") resizeSelection(cmd === "bigger" ? 1.25 : 0.8);
    else if (cmd === "colour") pickSelectionColour(e.target as HTMLElement);
    else document.execCommand("formatBlock", false, `<${cmd === "p" ? "div" : cmd}>`);
  });
  box.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    // Handled here: not every browser binds these in editable content.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (k === "b" || k === "i" || k === "u")) {
      e.preventDefault();
      document.execCommand(k === "b" ? "bold" : k === "i" ? "italic" : "underline");
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.shiftKey && k === "x") {
      e.preventDefault();
      document.execCommand("strikeThrough");
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
  // The options bar and its pop-ups (size, font, colour...) change the text while it is open: using them does not end the edit.
  const OPTIONS = ".toolbar, .colour-pop";
  const inside = (n: EventTarget | null): boolean => n instanceof Element && (box.contains(n) || bar.contains(n) || n.closest(OPTIONS) !== null);
  box.addEventListener("focusout", (e) => {
    if (inside(e.relatedTarget)) return;
    commit();
  });
  // ...so what ends it is a press anywhere else, or Escape from the options bar.
  document.addEventListener("pointerdown", (e) => {
    if (target && !inside(e.target)) commit();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (!target || e.key !== "Escape" || box.contains(e.target as Node)) return;
    commit();
    host.querySelector<HTMLElement>("canvas")?.focus({ preventScroll: true });
  });

  return {
    open,
    commit,
    get isOpen() {
      return target !== null;
    },
    look: () => (target ? lookOf(target, ppuNow()) : null),
    restyle: (look) => {
      if (!target) return;
      target = withLook(target, look, ppuNow());
      restyled = true;
      position();
    },
  };
}

function blocksToHtml(blocks: readonly Block[]): string {
  let html = "";
  let list: "ul" | "ol" | null = null;
  const spans = (ss: readonly Span[]): string =>
    ss.map((s) => {
      let h = esc(s.text);
      if (s.italic) h = `<i>${h}</i>`;
      if (s.bold) h = `<b>${h}</b>`;
      if (s.strike) h = `<s>${h}</s>`;
      if (s.underline) h = `<u>${h}</u>`;
      const css = [s.color ? `color:${cssOfHex(s.color)}` : "", s.scale && s.scale !== 1 ? `font-size:${s.scale * 100}%` : ""].filter(Boolean).join(";");
      return css ? `<span style="${css}">${h}</span>` : h;
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
  const rootColor = getComputedStyle(root).color;
  const rootPx = parseFloat(getComputedStyle(root).fontSize);
  /** Whether an element, or one it sits in (up to the box), is decorated with `line` (underline, line-through). */
  const decorated = (el: HTMLElement | null, line: string): boolean => {
    for (; el && el !== root; el = el.parentElement) if (getComputedStyle(el).textDecorationLine.includes(line)) return true;
    return false;
  };
  const walk = (n: Node, type: BlockType, blockPx = rootPx): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = (n as Text).data.replace(/[ \r\n\t]/g, " ");
      if (!text) return;
      if (!cur) start(type);
      const el = n.parentElement!;
      const cs = getComputedStyle(el);
      const scale = Math.round((parseFloat(cs.fontSize) / blockPx) * 10000) / 10000;
      cur!.spans.push({
        text,
        bold: Number(cs.fontWeight) >= 600,
        italic: cs.fontStyle !== "normal",
        ...(decorated(el, "underline") ? { underline: true } : {}),
        ...(decorated(el, "line-through") ? { strike: true } : {}),
        ...(cs.color !== rootColor ? { color: hexOfCss(cs.color) } : {}),
        ...(Math.abs(scale - 1) > 0.004 ? { scale } : {}),
      });
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    const tag = n.tagName;
    if (tag === "BR") return end();
    if (tag === "UL" || tag === "OL") {
      end();
      for (const c of n.childNodes) walk(c, tag === "UL" ? "ul" : "ol", blockPx);
      return end();
    }
    const block = HEADING[tag] ?? (tag === "LI" || tag === "DIV" || tag === "P" ? type : null);
    if (block) {
      start(block);
      const px = parseFloat(getComputedStyle(n).fontSize) || blockPx;
      for (const c of n.childNodes) walk(c, block, px);
      return end();
    }
    for (const c of n.childNodes) walk(c, type, blockPx);
  };
  for (const c of root.childNodes) walk(c, "p");
  end();
  return blocks;
}

/** "#rrggbb" or "#rrggbbaa" from a computed `rgb()` or `rgba()` colour. */
export function hexOfCss(css: string): string {
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (!m) return "#000000";
  const [r = 0, g = 0, b = 0, a = 1] = m[1]!.split(/[,/\s]+/).filter(Boolean).map(Number);
  const h = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ""}`;
}

/** A CSS colour from "#rrggbb" or "#rrggbbaa". */
export function cssOfHex(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const a = hex.length === 9 ? Math.round((parseInt(hex.slice(7), 16) / 255) * 1000) / 1000 : 1;
  return a < 1 ? `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})` : `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
