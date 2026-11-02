import suneditor, { helper } from "suneditor";
import { align, anchor, audio, audioGallery, backgroundColor, blockquote, blockStyle, codeBlock, drawing, fileBrowser, fileGallery, fileUpload, font, fontColor, fontSize, hr, image, imageGallery, lineHeight, link, list, list_bulleted, list_numbered, pageNavigator, paragraphStyle, slashCommand, table, textStyle, video, videoGallery } from "suneditor/plugins";
import type { SunEditor } from "suneditor/types";
import { linkTarget, relativeLink, richNoteBody, richNoteFile } from "../notes/note-file";
import type { NoteKind, NoteStyle } from "../notes/note-file";


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
  /** The fonts of the library, loaded: their name and the CSS family the page draws them with. */
  fonts(): Promise<Array<{ name: string; family: string }>>;
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

// SunEditor's demo presets (suneditor.com), without what needs a server or a library this app does not have (math, embeds, PDF export, templates).
const GALLERIES = ["imageGallery", "videoGallery", "audioGallery", "fileGallery", "fileBrowser"];
const TEXT_TOOLS = ["subscript", "superscript", "|", "textStyle", "copyFormat", "removeFormat"];
const PARAGRAPH_TOOLS = ["outdent", "indent", "lineHeight", "|", "blockquote", "paragraphStyle"];
const INSERT_TOOLS = ["hr", "codeBlock", "anchor", "|", "audio", "drawing", "fileUpload", "|", ...GALLERIES];
const FILE_TOOLS = ["newDocument", "save", "|", "selectAll", "copy", "|", "print"];
const VIEW_TOOLS = ["showBlocks", "markdownView", "preview"];
const fullButtons = (pages: boolean): SunEditor.UI.ButtonList => [
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
  ...(pages ? ["|", ["pageBreak", "pageNavigator", "pageUp", "pageDown"]] : []),
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
      return { type: "document:header,page", buttonList: fullButtons(true), subToolbar: { mode: "balloon", buttonList: SUB_BUTTONS } };
    case "classic":
      return { buttonList: fullButtons(false), subToolbar: { mode: "balloon", buttonList: SUB_BUTTONS } };
    case "bottom":
      return { mode: "classic:bottom", statusbar: false, buttonList: fullButtons(false), subToolbar: { mode: "balloon", buttonList: SUB_BUTTONS } };
    case "inline":
      return { mode: "inline", buttonList: fullButtons(false) };
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

/** A plain text file as the editor's HTML: a paragraph a line. */
const textHtml = (text: string): string => text.split(/\r?\n/).map((l) => `<p>${l.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`) || "<br>"}</p>`).join("");

/** Is this an upload of files from the device (and not an address, which goes in as it is)? */
const localFiles = (files: unknown): File[] | null => {
  const list = files instanceof FileList || Array.isArray(files) ? [...files] : [];
  return list.length && list.every((f) => f instanceof Blob) ? (list as File[]) : null;
};

/**
 * Open a note in the notes editor (SunEditor) inside `el`. Its links to library items are shown from the library (pictures, videos,
 * sounds, files) and written back as they were, or, for what is added, as a path relative to the note; files added go into the library.
 */
export async function mountNoteEditor(el: HTMLElement, opts: { kind: NoteKind; text: string; style: NoteStyle; dark: boolean; host: NoteHost }): Promise<NoteEditor> {
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

  // The file's text as HTML, its links to library items shown from the library.
  const html = opts.kind === "md" ? helper.markdown.markdownToHtml(opts.text, "P") : opts.kind === "txt" ? textHtml(opts.text) : richNoteBody(opts.text);
  const page = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  await Promise.all(
    [...page.body.querySelectorAll<HTMLElement>("[src], [href]")].map(async (n) => {
      const attr = n.hasAttribute("src") ? "src" : "href";
      const link = n.getAttribute(attr)!;
      const target = linkTarget(link, host.dir);
      const item = target && (await host.find(target));
      const url = item && (await urlOf(item, link));
      if (url) n.setAttribute(attr, url);
    }),
  );
  const fonts = await host.fonts();
  const cssName = (name: string): string => (/^[A-Za-z][\w -]*$/.test(name) ? name : `"${name.replace(/"/g, "")}"`);
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
    // (not math, embeds, PDF export, templates or layouts: they need a server or a library this app does not have)
    plugins: [
      ...[align, anchor, audio, backgroundColor, blockquote, blockStyle, codeBlock, drawing, fileUpload, font, fontColor, fontSize, hr, image, lineHeight, link, list, list_bulleted, list_numbered, pageNavigator, paragraphStyle, slashCommand, table, textStyle, video],
      ...[imageGallery, videoGallery, audioGallery, fileGallery, fileBrowser].map((g) => libraryGallery(g as GalleryClass, choose)),
    ],
    font: { items: [...new Set(fonts.map((f) => `${cssName(f.name)}, ${f.family}`))] },
    fileUpload: { uploadUrl: "canvast:library" }, // (never sent: files are taken by onFileUploadBefore)
    // Kept through the editor's cleaning: the app's own links, and markdown's task lists.
    allowedURLProtocols: ["canvast"],
    elementWhitelist: "input",
    attributeWhitelist: { input: "type|checked|disabled" },
  };
  const editor = suneditor.create(holder, {
    ...presetOptions(opts.style),
    ...content,
    value: page.body.innerHTML,
    width: "100%",
    height: "100%",
    theme: opts.dark ? "dark" : "",
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
    for (const n of box.content.querySelectorAll("*")) {
      const attrs = [...n.attributes].map((a) => [a.name, a.value] as const).sort(([a], [b]) => (a < b ? -1 : 1));
      for (const [k] of attrs) n.removeAttribute(k);
      for (const [k, v] of attrs) n.setAttribute(k, v);
    }
    return box.innerHTML;
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
        return { text: toMarkdown(out), keepsAll: held(helper.markdown.markdownToHtml(toMarkdown(now), "P")) === held(now) };
      }
      const box = document.createElement("div");
      box.innerHTML = out;
      const lines = [...box.children].map((b) => (b as HTMLElement).innerText ?? b.textContent ?? "");
      const text = lines.join("\n");
      return { text, keepsAll: held(textHtml(text)) === held(now) };
    },
    asRich: (title) => richNoteFile(title, output()),
    saved: () => void (dirty = false),
    destroy() {
      el.removeEventListener("keydown", keys, true);
      editor.destroy();
      twin?.destroy();
      for (const url of links.keys()) URL.revokeObjectURL(url);
    },
  };
}
