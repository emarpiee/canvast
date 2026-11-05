import { ICONS } from "./icons";
import { scrubNumbers } from "../colour-picker/scrub";
import suneditor, { helper } from "suneditor";
import { htmlMarkdown, markdownHtml, pastedHtml, pastedMarkdown } from "../notes/note-markdown";
import { copyPlainText } from "../app/system-clipboard";
import { align, anchor, audio, audioGallery, autocomplete, backgroundColor, blockquote, blockStyle, codeBlock, drawing, fileBrowser, fileGallery, fileUpload, font, fontColor, fontSize, hr, image, imageGallery, layout, lineHeight, link, list, list_bulleted, list_numbered, paragraphStyle, slashCommand, table, template, textStyle, video, videoGallery } from "suneditor/plugins";
import type { SunEditor } from "suneditor/types";
import { FENCE_TICK, WIKI, encodeLinkPart, keepSpelling, libraryLink, linkTarget, linksToWiki, obsidianMarkdown, richNoteBody, richNoteFile, textHtml, wikiToLinks } from "../notes/note-file";
import type { NoteKind, NoteStyle, PathTarget } from "../notes/note-file";
import { splitFrontmatter, type Prop } from "../notes/frontmatter";


/**
 * Every temporary address a note has shown for a library item, in this run of the app: a note's content copied into another note carries them, and
 * they stop working when their note closes. Kept after that, to find the item again. (The address is no secret: an item is only shown again if the note may list it.)
 */
const shownItems = new Map<string, { hash: string; name: string }>();

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
  /** The whole note as a markdown file, properties and these words; null when it has none to carry. */
  whole(words: string, pasted: readonly Prop[]): string | null;
  /** Read again what `whole` needs: the file and the item's properties. */
  refreshWhole(): Promise<void>;
  /** The folder of the note in the library (its links are relative to it). */
  dir: string[];
  /** The item a link in the note names (by its path in the library, or its hash), or null. */
  find(target: { hash: string } | PathTarget): Promise<NoteItem | null>;
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
  /** The library's tags, for `#` (a tag written in a note is one of its item's tags). */
  tags(): Promise<string[]>;
  /** The item a `[[target]]` link names, or null. */
  findWiki(target: string): Promise<NoteItem | null>;
  /** Ctrl+click on a link in the note: open what it points at (a note, a file of the library). `link`: as written in the file. */
  open(link: string): void;
  /** A small picture of what a link points at (its library preview), for a look while the pointer rests on it. */
  peek(link: string): Promise<Blob | null>;
  /** The notes of the library tagged `template`: offered in Insert ▸ Template after the built-in ones. */
  templates(): Promise<Array<{ name: string; kind: NoteKind; text: string; dir: string[] }>>;
  /** The editor's Save button (and Ctrl+S): whether it was saved. */
  save(): Promise<boolean>;
}

export interface NoteEditor {
  /** Properties pasted into the note and not saved yet. */
  pastedProps(): readonly Prop[];
  /** Edited since it was opened or last saved. */
  readonly dirty: boolean;
  /** The note as a markdown or plain text file, and whether that keeps everything in it (else formatting would be lost). */
  asText(kind: Exclude<NoteKind, "rich">): { text: string; keepsAll: boolean };
  /** The note as a rich text note's file. */
  asRich(title: string): string;
  /** Pasted content found its items: wait for this before writing the note. */
  settle(): Promise<void>;
  /** The editor's content now (given to `saved`, for what was saved). */
  current(): string;
  /** The note was saved (`as` this content, else as it is now): what was typed since stays a change. */
  saved(as?: string): void;
  destroy(): void;
}

// SunEditor's demo presets (suneditor.com), without what needs a server or another library (math, embeds, PDF export).
const GALLERIES = ["imageGallery", "videoGallery", "audioGallery", "fileGallery", "fileBrowser"];
const TEXT_TOOLS = ["subscript", "superscript", "|", "textStyle", "copyFormat", "removeFormat"];
const PARAGRAPH_TOOLS = ["outdent", "indent", "lineHeight", "|", "blockquote", "paragraphStyle"];
const INSERT_TOOLS = ["hr", "codeBlock", "anchor", "|", "audio", "drawing", "fileUpload", "|", "template", "layout", "|", ...GALLERIES];

/** Templates every note has (Insert ▸ Template, at the cursor); the library's notes tagged `template` come after them. */
const TEMPLATES = [
  { name: "Meeting notes", html: "<h2>Meeting notes</h2><p><strong>Date:</strong> {{date}}</p><p><strong>Attendees:</strong> </p><h3>Notes</h3><ul><li></li></ul><h3>Action items</h3><ul><li><input type=\"checkbox\"> </li></ul>" },
  { name: "To-do list", html: "<h2>To do</h2><ul><li><input type=\"checkbox\"> </li><li><input type=\"checkbox\"> </li><li><input type=\"checkbox\"> </li></ul>" },
  { name: "Journal entry", html: "<h2>Journal {{date}}</h2><p><em>Written at</em> {{time}}</p><h3>What happened</h3><p></p><h3>What I learned</h3><p></p>" },
  { name: "Reference sheet", html: "<h2>Reference</h2><p><strong>Subject:</strong> </p><p><strong>Source:</strong> </p><h3>Observations</h3><ul><li></li></ul>" },
];
/** A template's `{{date}}` (2026-11-03), `{{time}}` (14:05) and `{{title}}` (the note's name) filled in. */
function fillTemplate(html: string, title: string): string {
  const now = new Date();
  const two = (n: number): string => String(n).padStart(2, "0");
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return html.replace(/\{\{\s*(date|time|title)\s*\}\}/gi, (_m, k: string) =>
    k.toLowerCase() === "date" ? `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}` : k.toLowerCase() === "time" ? `${two(now.getHours())}:${two(now.getMinutes())}` : esc(title),
  );
}

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
  [":Text-text.Text", ...TEXT_TOOLS],
  "/",
  ["align", "list_bulleted", "list_numbered"],
  [":Paragraph-text.Paragraph", ...PARAGRAPH_TOOLS],
  "|",
  ["link", "image", "table", "video"],
  [":Insert-text.Insert", ...INSERT_TOOLS],
  ["-right", ":File-text.File", ...FILE_TOOLS],
  ["-right", ":View-text.View", ...VIEW_TOOLS],
  ["-right", "codeView", "fullScreen"],
];
// (Classic and Bottom: one short row, as SunEditor's own Classic, with everything else behind its +)
const SIMPLE_BUTTONS: SunEditor.UI.ButtonList = [
  ["undo", "redo"],
  "|",
  ["blockStyle"],
  "|",
  ["bold", "italic", "underline"],
  "|",
  ["list"],
  "|",
  ["link", "image", "table"],
  [":More-default.more_plus", "font", "fontSize", "strike", ...TEXT_TOOLS, "fontColor", "backgroundColor", "align", ...PARAGRAPH_TOOLS, "video", ...INSERT_TOOLS, ...FILE_TOOLS, ...VIEW_TOOLS, "codeView"],
  "|",
  ["fullScreen"],
];
const SUB_BUTTONS = [["bold", "italic", "underline", "strike", "subscript", "superscript"], "|", ["fontColor", "backgroundColor"], "|", ["link", "removeFormat"]];
const hIcon = (n: number): string => `<svg width="17" height="17" viewBox="0 0 24 24"><text x="1" y="18" font-size="15" font-weight="700" fill="currentColor">H${n}</text></svg>`;
const line = (tag: string) => ($: SunEditor.Deps): void => void $.format.setLine(document.createElement(tag));

/** The `/` menu, in every editor style: `/` then words to find a command. */
const SLASH_MENU: NonNullable<SunEditor.InitOptions["slashCommand"]> = {
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
};

function presetOptions(style: NoteStyle): SunEditor.InitOptions {
  switch (style) {
    case "document":
      return { type: "document:header,page", buttonList: FULL_BUTTONS, subToolbar: { mode: "balloon", buttonList: SUB_BUTTONS } };
    case "classic":
      return { buttonList: SIMPLE_BUTTONS, subToolbar: { mode: "balloon", buttonList: SUB_BUTTONS } };
    case "bottom":
      return { mode: "classic:bottom", statusbar: false, buttonList: SIMPLE_BUTTONS, subToolbar: { mode: "balloon", buttonList: SUB_BUTTONS } };
    case "balloon":
      return { mode: "balloon", buttonList: [["bold", "italic", "underline", "strike"], "|", ["fontColor", "backgroundColor"], "|", ["removeFormat"], "|", ["link"]] };
    case "notion":
      return {
        buttonList: [["undo", "redo"], ["-right", ":File-text.File", ...FILE_TOOLS], ["-right", ":View-text.View", ...VIEW_TOOLS]],
        placeholder_line: "Press '/' for commands",
        blockHandle: {
          menu: ["blockStyle", "list", "blockquote", "codeBlock", "fontColor", "backgroundColor", "align", "removeFormat", { title: "Duplicate", icon: "copy", action: ($, { block }) => (block.after(block.cloneNode(true)), $.history.push(false)) }, "copy", { title: "Delete", icon: "delete", action: ($, { block }) => (block.remove(), $.history.push(false)) }],
          onPlusClick: ($, { block }) => $.plugins["slashCommand"].open(block),
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

// (SunEditor offers a file pasted or dropped to every plugin that takes it: a picture, video or sound is its own plugin's, not also a file's)
class NoteFileUpload extends fileUpload {
  override onFilePasteAndDrop(a: Parameters<fileUpload["onFilePasteAndDrop"]>[0]): void {
    if (!/^(image|video|audio)\//.test(a.file.type)) super.onFilePasteAndDrop(a);
  }
}

/** The font list's button says Default (not the page's own list of font names) when the words have no font of their own. */
// (SunEditor runs the input plugins one after another, awaiting each: a note closed meanwhile (hidden items locked) has no window left to read the selection from)
const alive = ($: { frameContext?: { get(k: string): unknown } }): boolean => !!$.frameContext?.get("_ww");
class NoteSlash extends slashCommand {
  override onInput(...a: Parameters<slashCommand["onInput"]>): ReturnType<slashCommand["onInput"]> {
    if (!alive(this.$)) return;
    // (Firefox keeps a new line's first letter in a text of its own, and the menu reads only the text the cursor is in: `/` and `head` are then two)
    getSelection()?.anchorNode?.parentNode?.normalize();
    return super.onInput(...a);
  }
}
class NoteAutocomplete extends autocomplete {
  override async onInput(...a: Parameters<autocomplete["onInput"]>): Promise<void> {
    if (alive(this.$)) await super.onInput(...a);
  }
}

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

/** A row of the [[ and # lists: the name, and (smaller) how a link writes it when that is not the same (a folder, `canvas:`). */
const listRow = (name: string, key: string): string => {
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<div class="se-autocomplete-item"><span>${esc(name)}</span>${key && key !== name ? `<span>${esc(key)}</span>` : ""}</div>`;
};

/** Move a floating panel back inside the window when it would start left of it or end right of it. */
function keepInView(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const room = document.documentElement.clientWidth;
  const gap = 8;
  const shift = r.left < gap ? gap - r.left : r.right > room - gap ? Math.max(gap - r.left, room - gap - r.right) : 0;
  if (shift) el.style.left = `${(parseFloat(el.style.left) || 0) + shift}px`;
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
/**
 * SunEditor writes out a note by a walk that tests its whole text so far at every closing tag, so a long note takes far longer than its length: seconds on opening
 * and at each save. For the compact form it asks for itself (no line breaks or indents to work out) the same walk, in order and without that. Its own stays for the
 * code view. With #debug (every test) both run, so that a difference shows as an error.
 */
function fasterCode(editor: { $: { html: unknown } }): void {
  const html = editor.$.html as { _convertToCode(h: string | Node, comp: boolean): string };
  const own = html._convertToCode.bind(html);
  html._convertToCode = (h, comp) => {
    if (!comp || typeof h === "string") return own(h, comp);
    const parts: string[] = [];
    const walk = (at: Node): void => {
      for (const n of at.childNodes) {
        if (n.nodeType === Node.COMMENT_NODE) parts.push(`\n<!-- ${(n.textContent ?? "").trim()} -->`);
        else if (n.nodeType === Node.TEXT_NODE) {
          if (!/^(OL|UL)$/i.test(n.parentElement?.nodeName ?? "")) parts.push(helper.converter.htmlToEntity(/^\n+$/.test((n as Text).data) ? "" : (n as Text).data));
        } else if (!n.childNodes.length) parts.push((n as Element).outerHTML);
        else {
          const shell = (n.cloneNode(false) as Element).outerHTML;
          parts.push(shell.slice(0, shell.indexOf(">") + 1));
          walk(n);
          parts.push(`</${n.nodeName.toLowerCase()}>`);
        }
      }
    };
    walk(h);
    const out = parts.join("").trim();
    if (location.hash.includes("debug") && out !== own(h, comp)) console.error("canvast: a note written out differently by the faster walk");
    return out;
  };
}

export async function mountNoteEditor(el: HTMLElement, opts: { kind: NoteKind; text: string; style: NoteStyle; host: NoteHost; /** The note's name (no extension), for {{title}}. */ title: string; /** The whole place it is shown in (else the library's viewer). */ root?: HTMLElement | null }): Promise<NoteEditor> {
  const { host } = opts;
  /** Each address shown in the note for a library item → the link written in the file for it. */
  const links = new Map<string, string>();
  const urlOf = async (item: NoteItem, link?: string): Promise<string | null> => {
    const blob = await host.blob(item.hash);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    links.set(url, link ?? libraryLink(await host.pathOf(item.hash)));
    shownItems.set(url, { hash: item.hash, name: item.name });
    return url;
  };
  /**
   * A temporary address that is not this note's (its content pasted from another note, or saved so before this was fixed): the item it showed,
   * from what this run of the app remembers, else by the name the picture or file link carries. Null when nothing tells.
   */
  const itemOfAddress = async (address: string, name: string): Promise<NoteItem | null> => {
    const known = shownItems.get(address);
    return (known && (await host.find({ hash: known.hash }))) ?? ((known?.name ?? name) ? await host.findWiki(known?.name ?? name) : null);
  };
  const nameOfMedia = (n: Element): string => n.getAttribute("alt") || n.getAttribute("data-se-file-name") || n.getAttribute("download") || n.getAttribute("title") || "";
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
    const html = kind === "md" ? markdownHtml(wikiToLinks(splitFrontmatter(text).body)) : kind === "txt" ? textHtml(text) : richNoteBody(text); // (properties: in the details panel)
    return fromLibrary(html, dir);
  };
  /** The editor's HTML with its links to library items shown from the library. */
  const fromLibrary = async (html: string, dir: readonly string[]): Promise<string> => {
    const page = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    const here = dir.join("/") === host.dir.join("/");
    for (const box of page.body.querySelectorAll("input[type=checkbox]")) box.removeAttribute("disabled"); // (task boxes are ticked in the note)
    await Promise.all(
      [...page.body.querySelectorAll<HTMLElement>("[src], [href]")].map(async (n) => {
        const attr = n.hasAttribute("src") ? "src" : "href";
        const link = n.getAttribute(attr)!;
        // (a note saved with another note's temporary address in it: shown from the item, and its real link written at the next save)
        if (link.startsWith("blob:")) {
          const lost = await itemOfAddress(link, nameOfMedia(n));
          const again = lost && (await urlOf(lost));
          if (again) n.setAttribute(attr, again);
          return;
        }
        // An embed (`![[cat.png]]`): its picture when it is one; else it stays as written.
        if (attr === "src" && link.startsWith(WIKI)) {
          const name = decodeURIComponent(link.slice(WIKI.length));
          const found = await host.findWiki(name);
          const shownUrl = found?.type.startsWith("image/") ? await urlOf(found, link) : null;
          if (shownUrl) {
            n.setAttribute("src", shownUrl);
            knowPath(name);
          } else {
            const alt = n.getAttribute("alt") ?? "";
            n.replaceWith(`![[${name}${alt && alt !== name.split("/").pop() ? `|${alt}` : ""}]]`);
          }
          return;
        }
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
    void host.findWiki(target).then(async (item) => item && wikiPath.set(target, libraryLink(await host.pathOf(item.hash))));
  const wikiLink = (target: string, shownText: string): HTMLAnchorElement => {
    const a = document.createElement("a");
    a.href = `${WIKI}${encodeLinkPart(target)}`;
    a.textContent = shownText;
    knowPath(target);
    return a;
  };
  // A picture's, video's or sound's dialog shows the link the note writes (the address the editor uses lasts only while the note is open); a link typed there is found in the library.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- (a mixin's base must take any arguments)
  const linkDialog = <T extends new (...args: any[]) => any>(base: T, urlField: string): T => class extends base {
    shownLink = "";
    get linkField(): HTMLInputElement | null {
      return (this as unknown as Record<string, HTMLInputElement | null>)[urlField] ?? null;
    }
    modalOn(isUpdate: boolean): void {
      super.modalOn(isUpdate);
      requestAnimationFrame(() => {
        const field = this.linkField;
        if (!field) return;
        this.shownLink = field.value = links.get(field.value) ?? field.value;
        const preview = this.previewSrc ?? this.preview;
        if (preview) preview.textContent = field.value;
      });
    }
    // (the dialog's field puts a `/` before what has no web address's start)
    submitURL(url: string): unknown {
      return super.submitURL(url.replace(/^\/blob:/, "blob:"));
    }
    async modalAction(): Promise<boolean> {
      const field = this.linkField;
      const typed = field?.value.trim() ?? "";
      if (field && typed && typed !== this.shownLink) {
        const target = linkTarget(typed, host.dir);
        const item = target && (await host.find(target));
        const url = item && (await urlOf(item, typed));
        if (url) {
          field.value = url;
          field.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      return super.modalAction() as Promise<boolean>;
    }
  };
  const NoteImage = linkDialog(image, "imgUrlFile");
  const NoteVideo = linkDialog(video, "videoUrlFile");
  const NoteAudio = linkDialog(audio, "audioUrlFile");
  const value = await shown(opts.kind, opts.text, host.dir);
  for (const m of value.matchAll(/href="canvast-wiki:([^"]+)"/g)) knowPath(decodeURIComponent(m[1]!));
  const linkables = (await host.linkables()).map((l) => ({ key: l.key, name: l.name }));
  const tagList = (await host.tags()).map((t) => ({ key: t.replace(/\s+/g, "-") }));
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
  /** Properties pasted with a note from Obsidian, until the next save puts them in the file. */
  const pasted: Array<{ props: Prop[]; words: string[] }> = [];
  const bare = (s: string): string => s.replace(/\s+/g, "");
  const textOf = (html: string): HTMLElement => new DOMParser().parseFromString(html, "text/html").body;
  /** The words of each block of what was pasted, to know later whether any of it is still in the note. */
  const blocksOf = (html: string): string[] => {
    const body = textOf(html);
    const blocks = [...body.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, td, th, pre")].map((b) => bare(b.textContent ?? "")).filter(Boolean);
    return blocks.length ? blocks : [bare(body.textContent ?? "")].filter(Boolean);
  };
  /**
   * The Markdown and Code views show the note as text and, coming back, read it again from that text: markdown keeps no picture sizes,
   * spacing or styles. Left without a change to that text, the note comes back as it was, not read again.
   */
  const views: Record<"markdown" | "code", { html: string; text: string; dirty: boolean } | null> = { markdown: null, code: null };
  const viewToggled = (which: "markdown" | "code") => ({ frameContext, is }: { frameContext: SunEditor.FrameContext; is: boolean }): void => {
    const area = frameContext.get(which) as HTMLTextAreaElement | undefined;
    if (!area) return;
    if (is) return void ((views[which] = { html: editor.$.html.get(), text: area.value, dirty }), (viewArea[which] = area));
    const was = views[which];
    views[which] = null;
    viewArea[which] = null;
    if (!was) return;
    if (area.value !== was.text) return void (dirty = true); // (read again from what was typed there: a change of the note)
    editor.$.html.set(was.html);
    dirty = was.dirty;
  };
  const viewArea: Record<"markdown" | "code", HTMLTextAreaElement | null> = { markdown: null, code: null };
  /** What was typed in the Markdown or Code view and not read back yet. */
  const typedInView = (): boolean => (["markdown", "code"] as const).some((w) => !!viewArea[w] && viewArea[w].value !== views[w]?.text);
  /** How many times the person has changed the words (`current` notes it: what is typed while a save runs is told from what was saved). */
  let edits = 0;
  let editsAtCurrent = 0;
  el.addEventListener("input", () => void edits++, true);
  const holder = document.createElement("div");
  el.classList.toggle("is-plain-note", opts.kind === "txt"); // (its spaces and tabs are shown and kept)
  el.append(holder);
  /** What the editor holds and how it cleans it (the same for the hidden one that compares notes). */
  const content: SunEditor.InitOptions = {
    // (not math, embeds or PDF export: they need a server or another library)
    plugins: [
      ...[align, anchor, NoteAudio, backgroundColor, blockquote, blockStyle, codeBlock, drawing, NoteFileUpload, NoteFont, fontColor, fontSize, hr, NoteImage, layout, lineHeight, link, list, list_bulleted, list_numbered, paragraphStyle, NoteSlash, table, template, textStyle, NoteVideo, NoteAutocomplete],
      ...[imageGallery, videoGallery, audioGallery, fileGallery, fileBrowser].map((g) => libraryGallery(g as GalleryClass, choose)),
    ],
    font: { items: fonts },
    slashCommand: SLASH_MENU,
    fileUpload: { uploadUrl: "canvast:library" }, // (never sent: files are taken by onFileUploadBefore)
    // ({{date}}, {{time}} and {{title}} in a template are filled in: today, now, this note's name)
    // (when it goes in: the time is the insert's, not the note's opening)
    template: { items: [...TEMPLATES, ...templates].map((t) => ({ name: t.name, get html() { return fillTemplate(t.html, opts.title); } })) },
    autocomplete: {
      limitSize: 8,
      triggers: {
        // `[[`: a link to a note or a file of the library, written `[[name]]` in a markdown note
        "[[": { data: linkables, renderItem: (item: { key: string; [x: string]: unknown }) => listRow(String(item["name"] ?? item.key), item.key), onSelect: (item: { key: string; [x: string]: unknown }) => wikiLink(item.key, String(item["name"] ?? item.key)) },
        // `#`: a tag of the library, written `#tag` in the words (a markdown note's #tags are its item's tags)
        "#": { data: tagList, searchStartLength: 1, renderItem: (item: { key: string }) => listRow(`#${item.key}`, ""), onSelect: (item: { key: string }) => `#${item.key}` },
      },
    },
    layout: { items: LAYOUTS },
    // Kept through the editor's cleaning: the app's own links, and markdown's task lists.
    // (and links to other programs, written as they are: a note never follows them, but it keeps them)
    allowedURLProtocols: ["canvast", "canvast-wiki", "obsidian", "app", "file", "ftp", "tel", "zotero", "vscode", "ssh"],
    elementWhitelist: "input|mark|kbd",
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
      // A floating panel of the editor (the [[ and # lists, a picture's tools) is kept inside the window.
      onShowController: ({ info }: { info: { form?: HTMLElement | null; inWrapper?: boolean } }) => void (info.form && !info.inWrapper && requestAnimationFrame(() => keepInView(info.form!))),
      // A web address or a [[link]] pasted over words (in one line): those words become the link, nothing else is pasted.
      onPaste: async ({ $, event }: { $: SunEditor.Deps; event: Event }) => {
        const text = (event as ClipboardEvent).clipboardData?.getData("text/plain").trim() ?? "";
        const sel = window.getSelection();
        const words = sel && !sel.isCollapsed ? sel.toString() : "";
        const wiki = /^\[\[([^[\]|\n]+)\]\]$/.exec(text);
        const url = /^(https?:\/\/|mailto:)\S+$/i.test(text) ? text : null;
        if (!words.trim() || /\n/.test(words) || (!wiki && !url)) {
          // From Obsidian: its source, else the page it drew, read as a note's own (its pictures found in the library, a code block's lines kept).
          if (opts.kind === "txt") return undefined;
          const source = pastedMarkdown((event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "");
          const drawn = source ? null : pastedHtml((event as ClipboardEvent).clipboardData?.getData("text/html") ?? "");
          const got = source ?? drawn;
          if (!got) return undefined;
          dirty = true;
          const html = await fromLibrary(source ? markdownHtml(wikiToLinks(source.content)) : drawn!.content, host.dir);
          if (got.props.length) pasted.push({ props: got.props, words: blocksOf(html) });
          return html.trim() ? $.html.clean(html, { forceFormat: false, whitelist: null, blacklist: null }) : false;
        }
        const a = wiki ? wikiLink(wiki[1]!.trim(), words) : Object.assign(document.createElement("a"), { href: url!, textContent: words });
        if (!$.html.insertNode(a, { skipCharCount: false })) return undefined;
        $.selection.setRange(a.firstChild!, words.length, a.firstChild!, words.length);
        dirty = true;
        return false;
      },
      onToggleMarkdownView: viewToggled("markdown"),
      onToggleCodeView: viewToggled("code"),
      onChange: () => void (dirty = true),
      onInput: () => void (dirty = true),
      onSave: async () => (await host.save()) || false,
      onImageUploadBefore: takeFiles("image"),
      onVideoUploadBefore: takeFiles("video"),
      onAudioUploadBefore: takeFiles("audio"),
      onFileUploadBefore: takeFiles("file"),
    },
  } as SunEditor.InitOptions);

  /** The note as it was opened or last saved: what "unsaved changes" compare with. */
  let savedHtml = "";
  // The keyboard's Save and Undo while the person is at the note, wherever the focus went (a picture selected, a button of its toolbar, its header:
  // none of them keeps it in the words). Without this they would go on to the canvas or the library behind it.
  const root = opts.root ?? el.closest<HTMLElement>('[data-testid="slide-view"]') ?? el;
  let atNote = !opts.root; // (the library's viewer is the whole view; a panel beside a canvas, from the first press in it)
  const pressed = (e: PointerEvent): void => {
    const t = e.target as Element | null;
    atNote = !!t && (root.contains(t) || !!t.closest(".sun-editor, .se-controller, .se-modal, .se-dropdown, .lib-pick"));
  };
  window.addEventListener("pointerdown", pressed, true);
  const keys = (e: KeyboardEvent): void => {
    if (!atNote || e.altKey || !root.isConnected || root.hidden || document.querySelector("dialog[open]")) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.isContentEditable || /^(TEXTAREA|SELECT|INPUT)$/.test(t.tagName));
    if (!(e.ctrlKey || e.metaKey)) {
      // A key pressed with the focus off the words (a picture selected: its Delete) is the note's, not the canvas's: from the editor's page, the
      // app's shortcuts leave it alone and the editor still gets it.
      const page = el.querySelector(".sun-editor-editable");
      if (typing || !e.isTrusted || !page || e.key === "Escape" || e.key === "Tab" || /^F\d+$/.test(e.key)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      page.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code, shiftKey: e.shiftKey, bubbles: true, cancelable: true }));
      return;
    }
    if (e.code === "KeyS" && !e.shiftKey) {
      // Ctrl+S saves at once: the editor's own shortcut waits until its history takes the last keys (some 400 ms after typing stops).
      e.preventDefault();
      e.stopImmediatePropagation();
      editor.$.history.push(false);
      void host.save();
    } else if (e.code === "KeyF" && !e.shiftKey) {
      // Find in this note, wherever the focus is: the editor's own shortcut works only from its words, and elsewhere the key went to the library's search.
      e.preventDefault();
      e.stopImmediatePropagation();
      editor.$.finder.open(true);
    } else if (!typing && (e.code === "KeyZ" || (e.code === "KeyY" && !e.shiftKey))) {
      // (in the words or a field, Undo is theirs already, and the app's own shortcuts leave those alone)
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === "KeyZ" && !e.shiftKey) editor.$.history.undo();
      else editor.$.history.redo();
    }
  };
  window.addEventListener("keydown", keys, true);
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
  // The small card on a link in the words: a button goes where it points, and so does the link's text on it (a browser's new window goes nowhere here).
  // (the editor makes that card only after it has started, in the wrapper that carries its floating parts: the button is added when it comes)
  const carrier = editor.$.contextProvider.carrierWrapper as HTMLElement;
  const armLinkCard = (): void => {
    const linkCard = carrier.querySelector<HTMLElement>('.se-controller-link:has([data-command="unlink"])'); // (an anchor's and a formula's cards have that class too)
    if (!linkCard || linkCard.querySelector("[data-go-link]")) return;
    linkCard.querySelector(".se-btn-group")?.insertAdjacentHTML("afterbegin", `<button type="button" class="se-btn se-tooltip note-go-link" data-go-link data-testid="note-go-link" tabindex="-1" aria-label="Go to link">${ICONS.goToLink}<span class="se-tooltip-inner"><span class="se-tooltip-text">Go to link</span></span></button>`);
    linkCard.addEventListener("click", (e) => {
      const on = e.target as HTMLElement;
      if (!on.closest("[data-go-link]") && !on.closest("a")) return;
      e.preventDefault();
      e.stopPropagation();
      const href = linkCard.querySelector("a")!.getAttribute("href") ?? "";
      host.open(links.get(href) ?? href);
    }, true);
  };
  armLinkCard();
  new MutationObserver(armLinkCard).observe(carrier, { childList: true, subtree: true });
  // The pointer resting on a link: a small card with the preview of what it points at (a note's page, a picture), like a tooltip.
  let peekTimer = 0;
  let peekCard: HTMLElement | null = null;
  const unpeek = (): void => {
    clearTimeout(peekTimer);
    peekCard?.remove();
    peekCard = null;
  };
  const peekOver = (e: MouseEvent): void => {
    const a = (e.target as HTMLElement).closest?.("a[href]");
    if (!a || !a.closest(".sun-editor-editable")) return;
    unpeek();
    peekTimer = window.setTimeout(() => {
      const href = a.getAttribute("href")!;
      void host.peek(links.get(href) ?? href).then((blob) => {
        if (!blob || !a.isConnected || !a.matches(":hover")) return;
        const url = URL.createObjectURL(blob);
        const r = a.getBoundingClientRect();
        peekCard = document.createElement("div");
        peekCard.className = "note-link-peek";
        peekCard.style.left = `${Math.round(r.left)}px`;
        peekCard.style.top = `${Math.round(r.bottom + 6)}px`;
        peekCard.innerHTML = `<img alt="" src="${url}">`;
        peekCard.querySelector("img")!.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
        document.body.append(peekCard);
      });
    }, 350);
  };
  el.addEventListener("mouseover", peekOver);
  el.addEventListener("mouseout", unpeek);
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
  // Content that comes in with temporary addresses that are not this note's (pasted or dropped from another note): each gets this note's own, and its real link.
  const page = (): Element | null => el.querySelector(".sun-editor-editable");
  let repairing: Promise<void> = Promise.resolve();
  const repair = async (): Promise<void> => {
    const stray = [...(page()?.querySelectorAll("[src^='blob:'], [href^='blob:']") ?? [])].filter((n) => !links.has(n.getAttribute("src") ?? n.getAttribute("href") ?? ""));
    for (const n of stray) {
      const attr = n.hasAttribute("src") ? "src" : "href";
      const item = await itemOfAddress(n.getAttribute(attr)!, nameOfMedia(n));
      const url = item && (await urlOf(item));
      if (url) {
        n.setAttribute(attr, url);
        dirty = true;
      }
    }
  };
  // A picture or other component dragged to another place: SunEditor moves it but records no step, so Undo would seem to do nothing.
  page()?.addEventListener("drop", () => editor.$.history.push(false));
  const strays = new MutationObserver(() => void (repairing = repairing.then(repair)));
  const watched = page();
  if (watched) strays.observe(watched, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "href"] });
  // Drag a size or the font size left or right to change it, as every number of the app (SunEditor's are text, to take a unit). A dragged
  // size keeps the picture's proportion as a typed one does (it is worked out on keyup); a dragged font size is applied on release.
  scrubNumbers(el, undefined, { units: "._se_size_x, ._se_size_y, .__se__font_size" });
  el.addEventListener("input", (e) => {
    const t = e.target as HTMLElement;
    if (!e.isTrusted && t.matches("._se_size_x, ._se_size_y")) t.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  });
  el.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (!e.isTrusted && t.matches(".__se__font_size")) (editor.$.plugins as Record<string, { toolbarInputChange?(a: object): void }>)["fontSize"]?.toolbarInputChange?.({ target: t, value: t.value.trim(), event: e });
  });

  /** The editor's HTML without what only says what is selected now. */
  const settled = (h: string): string => h.replace(/ ?\b(?:se-component-selected|se-figure-selected)\b/g, "").replace(/ data-se-index="[^"]*"/g, "");
  fasterCode(editor);
  savedHtml = settled(editor.$.html.get());
  const initialHtml = savedHtml;
  /** The file's words as they are now, and how the editor writes them: what a save does not change keeps the file's own spelling. */
  let fileBody = opts.kind === "md" ? splitFrontmatter(opts.text).body : "";
  let canon0: string | null = null;
  let lastMd: { canon: string; text: string } | null = null;
  /** The editor's HTML with the library's addresses back to the links written in the file. */
  const output = (): string => {
    const $ = editor.$;
    $.viewer.codeView(false);
    $.viewer.markdownView(false);
    return mapped(settled($.html.get()));
  };
  const mapped = (h: string): string => {
    let out = h;
    for (const [url, link] of links) out = out.split(url).join(link);
    return out;
  };
  const toMarkdown = htmlMarkdown;
  const mdOf = (h: string): string => linksToWiki(toMarkdown(h)).replace(/[\u200B\uFEFF]/g, "");
  // Two notes are compared as a hidden editor of the same kind holds them (it writes pictures, tables and lists its own way).
  let twin: ReturnType<typeof suneditor.create> | null = null;
  const held = (h: string): string => {
    if (!twin) {
      const box = document.createElement("div");
      box.hidden = true;
      el.append(box);
      twin = suneditor.create(box.appendChild(document.createElement("div")), { ...content, buttonList: [], statusbar: false });
      fasterCode(twin);
    }
    twin.$.html.set(twin.$.html.clean(h, { forceFormat: true, whitelist: null, blacklist: null }));
    // (attributes in one order: the editor writes a picture's in the order it set them)
    const box = document.createElement("template");
    box.innerHTML = twin.$.html.get();
    for (const b of box.content.querySelectorAll("input[type=checkbox]")) b.removeAttribute("disabled"); // (markdown read back marks them so)
    // (what a picture just put in carries for the editor's own use: its size as "auto" is no size of its own)
    for (const i of box.content.querySelectorAll("img")) {
      for (const a of [...i.attributes]) if (a.name.startsWith("data-se-") || ((a.name === "width" || a.name === "height") && (a.value === "auto" || !a.value)) || a.name === "alt" || a.name === "title") i.removeAttribute(a.name);
    }
    for (const c of box.content.querySelectorAll("[class*='se-component-selected'], [class*='se-figure-selected']")) c.classList.remove("se-component-selected", "se-figure-selected");
    for (const n of box.content.querySelectorAll("*")) {
      const same = (v: string): string => {
        try {
          return decodeURIComponent(v); // (an address written with %3A or with : is the same address)
        } catch {
          return v;
        }
      };
      const attrs = [...n.attributes].map((a) => [a.name, a.name === "href" || a.name === "src" ? same(a.value) : a.value] as const).sort(([a], [b]) => (a < b ? -1 : 1));
      for (const [k] of attrs) n.removeAttribute(k);
      for (const [k, v] of attrs) if (v !== "" || (k !== "class" && k !== "style")) n.setAttribute(k, v); // (an empty class or style is none)
    }
    // (the editor's caret placeholders, and spaces at a block's end, which markdown does not keep, are no part of the note's formatting)
    return box.innerHTML
      .replace(/[\u200B\uFEFF]/g, "")
      .replace(/(?:&nbsp;|\u00a0|\s|<br>)+(<\/(?:p|h[1-6]|li|td|th|div|blockquote)>)/g, "$1") // (nor a line break there)
      .replace(/(<(?:p|h[1-6]|li|td|th|div|blockquote)(?: [^>]*)?>)(?:&nbsp;|\u00a0|\s|<br>)+/g, "$1") // (nor at a block's start)
      .replace(/(?:<br>)+((?:<\/code>)?<\/pre>)/g, "$1") // (nor a code block's last empty line)
      .replace(/<p><\/p>/g, "") // (an empty paragraph: markdown keeps no empty lines)
      .replace(/&nbsp;|\u00a0/g, " "); // (a space the editor keeps from collapsing is a space)
  };
  // Copying the whole note takes its properties along, as the markdown file it is: pasted at the top of a note elsewhere, they are properties there.
  el.addEventListener("focusin", () => void host.refreshWhole());
  const wholeSelected = (): boolean => {
    const box = document.activeElement;
    if (box instanceof HTMLTextAreaElement && el.contains(box)) return box.value.trim() !== "" && box.selectionStart === 0 && box.selectionEnd === box.value.length;
    const sel = getSelection();
    const area = editor.$.frameContext.get("wysiwyg") as HTMLElement;
    if (!sel || sel.isCollapsed || !area.contains(sel.anchorNode) || !area.contains(sel.focusNode)) return false;
    return bare(sel.toString()) === bare(area.textContent ?? "") && (bare(area.textContent ?? "") !== "" || !!area.querySelector("img, video, audio"));
  };
  const wholeNow = (): string | null => {
    if (opts.kind === "txt" || !wholeSelected()) return null;
    const words = self.asText("md").text;
    lastMd = null; // (only a save's words become what the file says)
    return host.whole(words, self.pastedProps());
  };
  el.addEventListener("copy", (e) => {
    const whole = wholeNow();
    if (whole === null || !e.clipboardData) return;
    e.clipboardData.setData("text/plain", whole); // (nothing else: an app given a page too would take the page, without the properties)
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // (its toolbar's Copy button, which writes the clipboard itself)
  el.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest?.('[data-command="copy"]')) return;
    const whole = wholeNow();
    if (whole === null) return;
    e.preventDefault();
    e.stopPropagation();
    void copyPlainText(whole);
  }, true);
  const self: NoteEditor = {
    // (edited since it was saved: a change the editor reports late, as its history taking the last keys, is no edit when the note is as saved)
    get dirty() {
      return typedInView() || (dirty && settled(editor.$.html.get()) !== savedHtml);
    },
    asText(kind) {
      const out = output();
      const now = editor.$.html.get();
      if (kind === "md") {
        // Markdown keeps it all when the note, written as markdown and read back, is the same note (an alignment, a font size… would go).
        const canon = mdOf(out);
        canon0 ??= mdOf(mapped(initialHtml));
        lastMd = { canon, text: keepSpelling(canon, canon0, fileBody) };
        return { text: lastMd.text, keepsAll: held(markdownHtml(toMarkdown(now))) === held(now) };
      }
      const box = document.createElement("div");
      box.innerHTML = out;
      // (a line break, or a list's items, are lines of the file: a `<div>` not on the page has no innerText of its own to tell them)
      for (const br of box.querySelectorAll("br")) br.replaceWith("\n");
      const lineOf = (b: Element): string => (b.matches("ul, ol") ? [...b.children].map(lineOf).join("\n") : (b.textContent ?? "").replace(/^\n$/, ""));
      const lines = [...box.children].map(lineOf);
      const text = lines.join(/\r\n/.test(opts.text) ? "\r\n" : "\n"); // (the file's own line ends)
      return { text, keepsAll: held(textHtml(text)) === held(now) };
    },
    asRich: (title) => richNoteFile(title, output().replace(/(href|src)="canvast-wiki:([^"]+)"/g, (m, a: string, t: string) => { const p = wikiPath.get(decodeURIComponent(t)); return p ? `${a}="${p}"` : m; })),
    settle: () => (repairing = repairing.then(repair)),
    pastedProps() {
      // (undone or deleted, all of what came with them: they went too. Nothing but properties was pasted: nothing to tell by, they stay.)
      const now = bare(textOf(editor.$.html.get()).textContent ?? "");
      return pasted.filter((p) => !p.words.length || p.words.some((w) => now.includes(w))).flatMap((p) => p.props);
    },
    current() {
      editsAtCurrent = edits;
      return settled(editor.$.html.get());
    },
    saved(as) {
      pasted.length = 0;
      const now = settled(editor.$.html.get());
      // (typed while it was being saved: still a change. Else the editor's own late touches, a picture's size once it has loaded, are no change.)
      const typed = as !== undefined && edits !== editsAtCurrent;
      savedHtml = typed ? as : now;
      dirty = typed;
      if (lastMd) ((fileBody = lastMd.text), (canon0 = lastMd.canon), (lastMd = null)); // (what the file says now)
    },
    destroy() {
      window.removeEventListener("keydown", keys, true);
      window.removeEventListener("pointerdown", pressed, true);
      strays.disconnect();
      el.removeEventListener("click", tick, true);
      el.removeEventListener("click", follow, true);
      el.removeEventListener("mouseover", peekOver);
      el.removeEventListener("mouseout", unpeek);
      unpeek();
      editor.destroy();
      twin?.destroy();
      for (const url of links.keys()) URL.revokeObjectURL(url);
    },
  };
  return self;
}
