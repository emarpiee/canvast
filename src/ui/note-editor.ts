import suneditor, { helper } from "suneditor";
import { align, anchor, audio, audioGallery, autocomplete, backgroundColor, blockquote, blockStyle, codeBlock, drawing, fileBrowser, fileGallery, fileUpload, font, fontColor, fontSize, hr, image, imageGallery, layout, lineHeight, link, list, list_bulleted, list_numbered, paragraphStyle, slashCommand, table, template, textStyle, video, videoGallery } from "suneditor/plugins";
import type { SunEditor } from "suneditor/types";
import { WIKI, linkTarget, linksToWiki, relativeLink, richNoteBody, richNoteFile, textHtml, wikiToLinks } from "../notes/note-file";
import type { NoteKind, NoteStyle } from "../notes/note-file";
import { splitFrontmatter } from "../notes/frontmatter";


/** What a note's attachments can be: what the library chooser lists for each of the editor's buttons. */
export type AttachKind = "image" | "video" | "audio" | "file";

/** A library item as a note shows it. */
export interface NoteItem {
  hash: string;
  name: string;
  type: string;
}

/** What the notes editor needs from the library. */
export interface NoteHost {
  /** The folder of the note in the library (its links are relative to it). */
  dir: string[];
  /** The item a link in the note names (by its path in the library, or its hash), or null. */
  find(target: { hash: string } | { path: string[] }): Promise<NoteItem | null>;
  /** The item's file, to show it in the note. */
  blob(hash: string): Promise<Blob | null>;
  /** Where the item is in the library (its folders and file name), for a link to it. */
  pathOf(hash: string): Promise<string[]>;
  /** The library chooser, for this kind of item (it can import files too). */
  choose(kind: AttachKind | "any"): Promise<NoteItem | null>;
  /** Files dropped, pasted or uploaded into the note: put in the library first. */
  importFiles(files: File[]): Promise<NoteItem[]>;
  /** The fonts of the library, loaded, by their family names (the page knows them by those names too). */
  fonts(): Promise<string[]>;
  /** What `[[` offers: the library's notes and files, by the name a link names them with (`key`), and the name shown (`name`). */
  linkables(): Promise<Array<{ key: string; name: string; hash: string }>>;
  /** The item a `[[target]]` link names, or null. */
  findWiki(target: string): Promise<NoteItem | null>;
  /** Ctrl+click on a link in the note: open what it points at (a note, a file of the library). `link`: as written in the file. */
  open(link: string): void;
  /** The notes of the library tagged `template`: offered in Insert ▸ Template after the built-in ones. */
  templates(): Promise<Array<{ name: string; kind: NoteKind; text: string; dir: string[] }>>;
  /** The editor's Save button (and Ctrl+S): whether it was saved. */
  save(): Promise<boolean>;
}

export interface NoteEditor {
  /** Edited since it was opened or last saved. */
  readonly dirty: boolean;
  /** The note as a markdown or plain text file, and whether that keeps everything in it (else formatting would be lost). */
  asText(kind: Exclude<NoteKind, "rich">): { text: string; keepsAll: boolean };
  /** The note as a rich text note's file. */
  asRich(title: string): string;
  saved(): void;
  destroy(): void;
}

// SunEditor's demo presets (suneditor.com), without what needs a server or another library (math, embeds, PDF export).
const GALLERIES = ["imageGallery", "videoGallery", "audioGallery", "fileGallery", "fileBrowser"];
const TEXT_TOOLS = ["subscript", "superscript", "|", "textStyle", "copyFormat", "removeFormat"];
const PARAGRAPH_TOOLS = ["outdent", "indent", "lineHeight", "|", "blockquote", "paragraphStyle"];
const INSERT_TOOLS = ["hr", "codeBlock", "anchor", "|", "audio", "drawing", "fileUpload", "|", "template", "layout", "|", ...GALLERIES];

/** Templates every note has (Insert ▸ Template, at the cursor); the library's notes tagged `template` come after them. */
const TEMPLATES = [
  { name: "Meeting notes", html: "<h2>Meeting notes</h2><p><strong>Date:</strong> </p><p><strong>Attendees:</strong> </p><h3>Notes</h3><ul><li></li></ul><h3>Action items</h3><ul><li><input type=\"checkbox\"> </li></ul>" },
  { name: "To-do list", html: "<h2>To do</h2><ul><li><input type=\"checkbox\"> </li><li><input type=\"checkbox\"> </li><li><input type=\"checkbox\"> </li></ul>" },
  { name: "Journal entry", html: "<h2>Journal</h2><p><em>Date:</em> </p><h3>What happened</h3><p></p><h3>What I learned</h3><p></p>" },
  { name: "Reference sheet", html: "<h2>Reference</h2><p><strong>Subject:</strong> </p><p><strong>Source:</strong> </p><h3>Observations</h3><ul><li></li></ul>" },
];
/** Layouts (Insert ▸ Layout): one takes the place of the whole note (Ctrl+Z brings the note back). Markdown cannot hold them: a note with one is saved as a rich text note. */
const col = (flex: number, text: string): string => `<div style="flex:${flex}"><p>${text}</p></div>`;
const LAYOUTS = [
  { name: "Two columns", html: `<div style="display:flex;gap:1em">${col(1, "Left")}${col(1, "Right")}</div>` },
  { name: "Three columns", html: `<div style="display:flex;gap:1em">${col(1, "Left")}${col(1, "Middle")}${col(1, "Right")}</div>` },
  { name: "Sidebar and main", html: `<div style="display:flex;gap:1em">${col(1, "Sidebar")}${col(3, "Main")}</div>` },
];
// (not New document, which empties the open note, Print, or the page buttons: no use for a note in the library)
const FILE_TOOLS = ["save", "|", "selectAll", "copy"];
const VIEW_TOOLS = ["showBlocks", "markdownView", "preview"];
const FULL_BUTTONS: SunEditor.UI.ButtonList = [
  ["undo", "redo"],
  "|",
  ["blockStyle", "font", "fontSize"],
  "|",
  ["bold", "italic", "underline", "strike"],
  "|",
  ["fontColor", "backgroundColor"],
  [":Text-text.Text ▾", ...TEXT_TOOLS],
  "/",
  ["align", "list_bulleted", "list_numbered"],
  [":Paragraph-text.Paragraph ▾", ...PARAGRAPH_TOOLS],
  "|",
  ["link", "image", "table", "video"],
  [":Insert-text.Insert ▾", ...INSERT_TOOLS],
  ["-right", ":File-text.File ▾", ...FILE_TOOLS],
  ["-right", ":View-text.View ▾", ...VIEW_TOOLS],
  ["-right", "codeView", "fullScreen"],
];
const SUB_BUTTONS = [["bold", "italic", "underline", "strike", "subscript", "superscript"], "|", ["fontColor", "backgroundColor"]];
const hIcon = (n: number): string => `<svg width="17" height="17" viewBox="0 0 24 24"><text x="1" y="18" font-size="15" font-weight="700" fill="currentColor">H${n}</text></svg>`;
const line = (tag: string) => ($: SunEditor.Deps): void => void $.format.setLine(document.createElement(tag));

function presetOptions(style: NoteStyle): SunEditor.InitOptions {
  switch (style) {
    case "document":
      return { type: "document:header,page", buttonList: FULL_BUTTONS, subToolbar: { mode: "balloon", buttonList: SUB_BUTTONS } };
    case "classic":
      return { buttonList: FULL_BUTTONS, subToolbar: { mode: "balloon", buttonList: SUB_BUTTONS } };
    case "bottom":
      return { mode: "classic:bottom", statusbar: false, buttonList: FULL_BUTTONS, subToolbar: { mode: "balloon", buttonList: SUB_BUTTONS } };
    case "balloon":
      return { mode: "balloon", buttonList: [["bold", "italic", "underline", "strike"], "|", ["fontColor", "backgroundColor"], "|", ["removeFormat"], "|", ["link"]] };
    case "notion":
      return {
        buttonList: [["undo", "redo"], ["-right", ":File-text.File ▾", ...FILE_TOOLS], ["-right", ":View-text.View ▾", ...VIEW_TOOLS]],
        placeholder_line: "Press '/' for commands",
        blockHandle: {
          menu: ["blockStyle", "list", "blockquote", "codeBlock", "fontColor", "backgroundColor", "align", "removeFormat", { title: "Duplicate", icon: "copy", action: ($, { block }) => (block.after(block.cloneNode(true)), $.history.push(false)) }, "copy", { title: "Delete", icon: "delete", action: ($, { block }) => (block.remove(), $.history.push(false)) }],
          onPlusClick: ($, { block }) => $.plugins["slashCommand"].open(block),
        },
        slashCommand: {
          triggerChar: "/",
          items: [
            { key: "text", title: "Text", icon: "text_style", keywords: ["paragraph", "p", "plain"], action: line("P") },
            { key: "h1", title: "Heading 1", icon: hIcon(1), keywords: ["title", "big"], action: line("H1") },
            { key: "h2", title: "Heading 2", icon: hIcon(2), keywords: ["subtitle"], action: line("H2") },
            { key: "h3", title: "Heading 3", icon: hIcon(3), keywords: ["subheading"], action: line("H3") },
            "list_bulleted",
            "list_numbered",
            { key: "quote", title: "Quote", icon: "blockquote", keywords: ["blockquote", "cite"], action: ($) => void $.format.applyBlock(document.createElement("BLOCKQUOTE")) },
            { key: "code", title: "Code", icon: "code_block", keywords: ["pre", "snippet"], action: ($) => void $.format.setBrLine(document.createElement("PRE")) },
            "hr",
            "table",
            "image",
            "link",
            "bold",
            "italic",
            "underline",
            "strike",
            "fontColor",
            "backgroundColor",
          ],
        },
        subToolbar: { mode: "balloon", buttonList: [["blockStyle"], "|", ["bold", "italic", "underline", "strike"], "|", ["fontColor", "backgroundColor"], "|", ["link", "removeFormat"], "|", ["align"]] },
      };
  }
}

const KIND_OF_GALLERY: Record<string, AttachKind | "any"> = { imageGallery: "image", videoGallery: "video", audioGallery: "audio", fileGallery: "file", fileBrowser: "any" };
const kindOfType = (type: string): AttachKind => (/^(image|video|audio)\//.exec(type)?.[1] as AttachKind | undefined) ?? "file";

/**
 * The gallery buttons open the library chooser instead of a server's list: what is chosen goes in through the plugin's own way of
 * inserting an item (its `selectorHandler`), as if picked in its own gallery.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- (a mixin's base must take any arguments)
type GalleryClass = (new (...args: any[]) => { onSelectfunction: unknown; browser: { selectorHandler(target: Node): void } }) & { key: string };
function libraryGallery<T extends GalleryClass>(base: T, choose: (kind: AttachKind | "any") => Promise<HTMLElement | null>): T {
  const kind = KIND_OF_GALLERY[base.key]!;
  return class extends base {
    open(onSelect?: (target: Node) => void): void {
      this.onSelectfunction = onSelect ?? null;
      void choose(kind).then((target) => {
        if (target) this.browser.selectorHandler(target);
        this.onSelectfunction = null;
      });
    }
  };
}

/** The font list's button says Default (not the page's own list of font names) when the words have no font of their own. */
class NoteFont extends font {
  override active(element: HTMLElement | null, target: HTMLElement): boolean | void {
    const shown = super.active(element, target);
    if (!element && this.$.store.get("hasFocus")) {
      const label = this.$.lang["default"] ?? "Default";
      target.querySelector(".se-txt")!.textContent = label;
      const tip = target.parentNode?.querySelector(".se-tooltip-text");
      if (tip) tip.textContent = `${this.$.lang["font"]} (${label})`;
    }
    return shown;
  }
}

/** Is this an upload of files from the device (and not an address, which goes in as it is)? */
const localFiles = (files: unknown): File[] | null => {
  const list = files instanceof FileList || Array.isArray(files) ? [...files] : [];
  return list.length && list.every((f) => f instanceof Blob) ? (list as File[]) : null;
};

/**
 * Open a note in the notes editor (SunEditor) inside `el`. Its links to library items are shown from the library (pictures, videos,
 * sounds, files) and written back as they were, or, for what is added, as a path relative to the note; files added go into the library.
 */
export async function mountNoteEditor(el: HTMLElement, opts: { kind: NoteKind; text: string; style: NoteStyle; host: NoteHost }): Promise<NoteEditor> {
  const { host } = opts;
  /** Each address shown in the note for a library item → the link written in the file for it. */
  const links = new Map<string, string>();
  const urlOf = async (item: NoteItem, link?: string): Promise<string | null> => {
    const blob = await host.blob(item.hash);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    links.set(url, link ?? relativeLink(host.dir, await host.pathOf(item.hash)));
    return url;
  };
  const targetFor = async (item: NoteItem): Promise<HTMLElement | null> => {
    const url = await urlOf(item);
    if (!url) return null;
    const t = document.createElement(item.type.startsWith("image/") ? "img" : "span");
    t.setAttribute("data-command", url);
    t.setAttribute("data-name", item.name);
    t.setAttribute("data-type", kindOfType(item.type));
    t.setAttribute("alt", item.name);
    return t;
  };

  /**
   * A note file's text as the editor's HTML, its links to library items shown from the library. `dir`: the folder of the file it comes
   * from; a template's links from another folder are written again from this note's (the app's own links stay as they are).
   */
  const shown = async (kind: NoteKind, text: string, dir: readonly string[]): Promise<string> => {
    const html = kind === "md" ? helper.markdown.markdownToHtml(wikiToLinks(splitFrontmatter(text).body), "P") : kind === "txt" ? textHtml(text) : richNoteBody(text); // (properties: in the details panel)
    const page = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    const here = dir.join("/") === host.dir.join("/");
    for (const box of page.body.querySelectorAll("input[type=checkbox]")) box.removeAttribute("disabled"); // (task boxes are ticked in the note)
    await Promise.all(
      [...page.body.querySelectorAll<HTMLElement>("[src], [href]")].map(async (n) => {
        const attr = n.hasAttribute("src") ? "src" : "href";
        const link = n.getAttribute(attr)!;
        const target = linkTarget(link, dir);
        const item = target && (await host.find(target));
        const url = item && (await urlOf(item, here || "hash" in target ? link : undefined));
        if (url) n.setAttribute(attr, url);
      }),
    );
    return page.body.innerHTML;
  };
  /** A link to a note or file, as the editor holds it (a markdown note writes it `[[key]]`); its path is found for a rich text note. */
  const wikiPath = new Map<string, string>();
  const knowPath = (target: string): void =>
    void host.findWiki(target).then(async (item) => item && wikiPath.set(target, relativeLink(host.dir, await host.pathOf(item.hash))));
  const wikiLink = (target: string, shownText: string): HTMLAnchorElement => {
    const a = document.createElement("a");
    a.href = `${WIKI}${encodeURIComponent(target)}`;
    a.textContent = shownText;
    knowPath(target);
    return a;
  };
  const value = await shown(opts.kind, opts.text, host.dir);
  for (const m of value.matchAll(/href="canvast-wiki:([^"]+)"/g)) knowPath(decodeURIComponent(m[1]!));
  const linkables = (await host.linkables()).map((l) => ({ key: l.key, name: l.name }));
  const templates = await Promise.all((await host.templates()).map(async (t) => ({ name: t.name, html: await shown(t.kind, t.text, t.dir) })));
  const fonts = await host.fonts();
  const choose = async (kind: AttachKind | "any"): Promise<HTMLElement | null> => {
    const item = await host.choose(kind);
    return item && targetFor(item);
  };
  // Files from the device (an upload, a drop, a paste) go into the library, then into the note through the plugin's own address insert.
  const takeFiles = (kind: AttachKind) => async ({ $, info }: { $: SunEditor.Deps; info: { files?: unknown } }): Promise<boolean> => {
    const files = localFiles(info.files);
    if (!files) return true;
    const items = await host.importFiles(files);
    for (const [n, item] of items.entries()) {
      const url = await urlOf(item);
      if (!url) continue;
      if (kind === "file") $.plugins["fileUpload"].create(url, { name: item.name, size: 0 }, n === items.length - 1);
      else await $.plugins[kind].submitURL(url);
    }
    return false;
  };

  let dirty = false;
  const holder = document.createElement("div");
  el.append(holder);
  /** What the editor holds and how it cleans it (the same for the hidden one that compares notes). */
  const content: SunEditor.InitOptions = {
    // (not math, embeds or PDF export: they need a server or another library)
    plugins: [
      ...[align, anchor, audio, backgroundColor, blockquote, blockStyle, codeBlock, drawing, fileUpload, NoteFont, fontColor, fontSize, hr, image, layout, lineHeight, link, list, list_bulleted, list_numbered, paragraphStyle, slashCommand, table, template, textStyle, video, autocomplete],
      ...[imageGallery, videoGallery, audioGallery, fileGallery, fileBrowser].map((g) => libraryGallery(g as GalleryClass, choose)),
    ],
    font: { items: fonts },
    fileUpload: { uploadUrl: "canvast:library" }, // (never sent: files are taken by onFileUploadBefore)
    template: { items: [...TEMPLATES, ...templates] },
    autocomplete: {
      limitSize: 8,
      triggers: {
        // `[[`: a link to a note or a file of the library, written `[[name]]` in a markdown note
        "[[": { data: linkables, onSelect: (item: { key: string; [x: string]: unknown }) => wikiLink(item.key, String(item["name"] ?? item.key)) },
      },
    },
    layout: { items: LAYOUTS },
    // Kept through the editor's cleaning: the app's own links, and markdown's task lists.
    allowedURLProtocols: ["canvast", "canvast-wiki"],
    elementWhitelist: "input",
    attributeWhitelist: { input: "type|checked|disabled" },
  };
  const editor = suneditor.create(holder, {
    ...presetOptions(opts.style),
    ...content,
    value,
    width: "100%",
    height: "100%",
    theme: "canvast", // (the app's tokens, light or dark with the app: src/styles.css)
    events: {
      onChange: () => void (dirty = true),
      onInput: () => void (dirty = true),
      onSave: async () => (await host.save()) || false,
      onImageUploadBefore: takeFiles("image"),
      onVideoUploadBefore: takeFiles("video"),
      onAudioUploadBefore: takeFiles("audio"),
      onFileUploadBefore: takeFiles("file"),
    },
  } as SunEditor.InitOptions);

  // Ctrl+S saves at once: the editor's own shortcut waits until its history takes the last keys (some 400 ms after typing stops).
  const keys = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.code !== "KeyS") return;
    e.preventDefault();
    e.stopPropagation();
    editor.$.history.push(false);
    void host.save();
  };
  el.addEventListener("keydown", keys, true);
  // A task box is ticked with a click: its `checked` attribute is what the file keeps (`- [x]`), one step of undo.
  // Ctrl+click (⌘ on a Mac) on a link opens what it points at; a plain click puts the cursor in it, to edit.
  const follow = (e: MouseEvent): void => {
    const a = (e.target as HTMLElement).closest?.("a[href]");
    if (!a || !(e.ctrlKey || e.metaKey) || !a.closest(".sun-editor-editable")) return;
    e.preventDefault();
    e.stopPropagation();
    const href = a.getAttribute("href")!;
    host.open(links.get(href) ?? href);
  };
  el.addEventListener("click", follow, true);
  const tick = (e: MouseEvent): void => {
    const box = e.target as HTMLInputElement;
    if (box.type !== "checkbox" || !box.closest(".sun-editor-editable")) return;
    e.preventDefault();
    const on = !box.hasAttribute("checked");
    box.toggleAttribute("checked", on);
    setTimeout(() => (box.checked = on)); // (after the click's own default is undone)
    dirty = true;
    editor.$.history.push(false);
  };
  el.addEventListener("click", tick, true);

  /** The editor's HTML with the library's addresses back to the links written in the file. */
  const output = (): string => {
    const $ = editor.$;
    $.viewer.codeView(false);
    $.viewer.markdownView(false);
    let out = $.html.get();
    for (const [url, link] of links) out = out.split(url).join(link);
    return out;
  };
  const toMarkdown = (h: string): string => helper.markdown.jsonToMarkdown(helper.converter.htmlToJson(h));
  // Two notes are compared as a hidden editor of the same kind holds them (it writes pictures, tables and lists its own way).
  let twin: ReturnType<typeof suneditor.create> | null = null;
  const held = (h: string): string => {
    if (!twin) {
      const box = document.createElement("div");
      box.hidden = true;
      el.append(box);
      twin = suneditor.create(box.appendChild(document.createElement("div")), { ...content, buttonList: [], statusbar: false });
    }
    twin.$.html.set(twin.$.html.clean(h, { forceFormat: true, whitelist: null, blacklist: null }));
    // (attributes in one order: the editor writes a picture's in the order it set them)
    const box = document.createElement("template");
    box.innerHTML = twin.$.html.get();
    for (const b of box.content.querySelectorAll("input[type=checkbox]")) b.removeAttribute("disabled"); // (markdown read back marks them so)
    for (const n of box.content.querySelectorAll("*")) {
      const attrs = [...n.attributes].map((a) => [a.name, a.value] as const).sort(([a], [b]) => (a < b ? -1 : 1));
      for (const [k] of attrs) n.removeAttribute(k);
      for (const [k, v] of attrs) n.setAttribute(k, v);
    }
    // (the editor's caret placeholders, and spaces at a block's end, which markdown does not keep, are no part of the note's formatting)
    return box.innerHTML.replace(/[\u200B\uFEFF]/g, "").replace(/(?:&nbsp;|\u00a0|\s)+(<\/(?:p|h[1-6]|li|td|th|div|blockquote)>)/g, "$1");
  };
  return {
    get dirty() {
      return dirty;
    },
    asText(kind) {
      const out = output();
      const now = editor.$.html.get();
      if (kind === "md") {
        // Markdown keeps it all when the note, written as markdown and read back, is the same note (an alignment, a font size… would go).
        return { text: linksToWiki(toMarkdown(out)).replace(/[\u200B\uFEFF]/g, ""), keepsAll: held(helper.markdown.markdownToHtml(toMarkdown(now), "P")) === held(now) };
      }
      const box = document.createElement("div");
      box.innerHTML = out;
      const lines = [...box.children].map((b) => (b as HTMLElement).innerText ?? b.textContent ?? "");
      const text = lines.join("\n");
      return { text, keepsAll: held(textHtml(text)) === held(now) };
    },
    asRich: (title) => richNoteFile(title, output().replace(/href="canvast-wiki:([^"]+)"/g, (m, t: string) => { const p = wikiPath.get(decodeURIComponent(t)); return p ? `href="${p}"` : m; })),
    saved: () => void (dirty = false),
    destroy() {
      el.removeEventListener("keydown", keys, true);
      el.removeEventListener("click", tick, true);
      el.removeEventListener("click", follow, true);
      editor.destroy();
      twin?.destroy();
      for (const url of links.keys()) URL.revokeObjectURL(url);
    },
  };
}
