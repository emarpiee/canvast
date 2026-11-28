import { WIKI, encodeLinkPart, noteKindOf, textHtml } from "./note-file";
import { renderMarkdown } from "../markdown-editor/render";
import { DOC_CSS, DOC_TOKENS } from "../markdown-editor/style";
import { cardContext } from "../assets/card";
import { NO_META, fileMeta, splitFrontmatter, type NoteMeta } from "./frontmatter";
import { NOTE_PAGE_PIXEL_W } from "../doc/model";

// The picture of a note (its library thumbnail and its card on a canvas): the top of its page, as the notes editor lays it out, drawn
// through an SVG image (`foreignObject`), which runs nothing and loads nothing. Light or dark paper (`setNoteLook`): cards are drawn in memory, never stored.
// Its pictures, videos and sounds are found by the app (`setNotePictures`) and drawn into it as data (a video by its picture, with a
// ▶; a sound by its waveform, with a ♪). shortcut: library fonts are not (its text is in the system's sans-serif), embed them likewise if wanted.

/** A note's card on a canvas: its page drawn at twice its size (sharp when zoomed in). Its picture is `CARD_SCALE` × the page it lays out. */
export const CARD_SCALE = 2;
/** How wide a note's page is laid out for its thumbnail and a new card, CSS px (a card on a canvas is then laid out at its own width). */
const PAGE_W = NOTE_PAGE_PIXEL_W / CARD_SCALE;
/** A new card is as tall as the note up to this (CSS px of the page): a longer note fades out at the bottom until the card is made taller. */
const NEW_CARD_MAX_H = 4000;
/** The longest page a card lays out (CSS px): a card showing the whole note stops there. */
const PAGE_MAX_H = 16000;
// (the page's look is the notes editor's own, DOC_CSS, the one set of rules its preview and table cells use; here only the page itself,
// its colours as the editor's tokens, and what only a card has: pictures drawn as data, a video's ▶, a sound's ♪, the properties' badges)
/** The note styles (notes/note-styles.ts) a card draws with, as the editor does: true when they changed (cards are drawn again). */
let styleVars = "";
export const setNoteStyles = (vars: string): boolean => (vars === styleVars ? false : ((styleVars = vars), true));
const css = (): string => `
.page{box-sizing:border-box;overflow:hidden;padding:26px 30px;${DOC_TOKENS.light}--me-size:15px;background:var(--me-bg);color:var(--me-fg);font:var(--me-size)/var(--me-line-height) var(--me-font);word-wrap:break-word}
.page.dark{${DOC_TOKENS.dark}}
.page.me-doc{${styleVars}}
${DOC_CSS}
ul,ol{padding-left:1.4em}
.media{position:relative;display:inline-block;max-width:100%}.media img{display:block;max-width:100%;height:auto;border-radius:var(--me-radius)}.is-video::after,.is-audio::after{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:2.4em;height:2.4em;border-radius:50%;background:oklch(0.2 0 0 / .6);color:#fff;font-size:1.4em;line-height:2.4em;text-align:center}.is-video::after{content:"▶"}.is-audio::after{content:"♪"}.pic{display:inline-block;padding:.7em 1.1em;border-radius:var(--me-radius);background:var(--me-code-bg);color:var(--me-muted);font-size:.85em}
.props{display:flex;flex-wrap:wrap;gap:.35em;margin:0 0 .7em}.prop{padding:.1em .6em;border-radius:1em;background:var(--me-code-bg);color:var(--me-muted);font-size:.8em}`;
/** Light or dark paper (Settings > Notes > Preview look); a change is drawn by whoever shows the cards. */
export type NoteLook = "light" | "dark";
let look: NoteLook = "light";
/** Whether the look changed. */
export const setNoteLook = (l: NoteLook): boolean => (l === look ? false : ((look = l), true));

/** The properties a note's card and thumbnail show over its words (Settings > Notes > Note cards show properties), by name. */
let shownProps: readonly string[] = [];
/** Whether the list changed; a change is drawn by whoever shows the cards. */
export const setShownProps = (list: string): boolean => {
  const next = list.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (next.join() === shownProps.join()) return false;
  shownProps = next;
  return true;
};
/** What a note's file says for a property's name: each tag, its description, or a property's value on one line. */
const propWords = (meta: NoteMeta, key: string): string[] =>
  key === "tags" || key === "tag" ? meta.tags : key === "description" ? (meta.note ? [meta.note.split("\n")[0]!] : []) : meta.fields.filter((f) => f.key.toLowerCase() === key && f.value).map((f) => f.value.split("\n")[0]!);

/** What the library says about an item (the details panel's properties): what a card's labels show; else the note's file. */
let itemMeta: ((hash: string) => Promise<NoteMeta | null>) | null = null;
export const setNoteItemMeta = (fn: (hash: string) => Promise<NoteMeta | null>): void => void (itemMeta = fn);

/** What a link in a note shows: a picture (a picture item's own file, else its library thumbnail) and the item's type. */
export type NotePictureSource = (noteHash: string, link: string) => Promise<{ blob: Blob; type: string } | null>;
let pictures: NotePictureSource | null = null;
/** How the app finds the pictures of a note's links (main.ts): the preview has no library of its own. */
export const setNotePictures = (fn: NotePictureSource): void => void (pictures = fn);

/** A picture as data for the page, at most the page's width (twice, for a sharp card), and its size there: the width its link sets
 *  (`![[cat.png|200]]`), as the editor draws it, else its own. */
async function pictureData(blob: Blob, want: number | null): Promise<{ url: string; w: number; h: number } | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, (PAGE_W * 2) / bmp.width);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const shown = Math.min(PAGE_W - 60, want ?? bmp.width);
    const out = { url: c.toDataURL("image/webp", 0.82), w: shown, h: Math.round((shown * bmp.height) / bmp.width) };
    bmp.close();
    return out;
  } catch {
    return null;
  }
}

/**
 * What a note's thumbnail depends on besides its text (its hash): the paper and the labels shown. A kept thumbnail drawn otherwise is drawn again.
 * shortcut: a linked picture changed since is not seen (the thumbnail keeps the old one) until the note is saved again.
 */
export async function noteFaceKey(hash: string): Promise<string> {
  const own = shownProps.length && itemMeta ? await itemMeta(hash).catch(() => null) : null;
  return `${look}|${shownProps.join()}|${own ? shownProps.flatMap((k) => propWords(own, k)).join("\u0000") : ""}`;
}

/** The last pages made (a card is measured, then drawn: its pictures are read and packed once). */
const made = new Map<string, Promise<string>>();
async function pageHtml(name: string, text: string, hash?: string): Promise<string> {
  const kind = noteKindOf(name);
  const own = shownProps.length && hash && itemMeta ? await itemMeta(hash).catch(() => null) : null;
  const badges = shownProps.flatMap((k) => propWords(own ?? (kind ? (fileMeta(kind, text) ?? NO_META) : NO_META), k));
  const key = `${hash ?? ""}|${name}|${badges.join("\u0000")}|${text}`; // (the whole text: two versions alike in length and start, 66px and 16px, are not one page)
  let p = made.get(key);
  if (!p) {
    p = makePageHtml(name, text, badges, hash);
    made.set(key, p);
    if (made.size > 8) made.delete(made.keys().next().value!);
  }
  return p;
}

/** The note's text as HTML that can be drawn in an image: its media as pictures in data (nothing loads there), no scripts or frames. */
async function makePageHtml(name: string, text: string, badges: readonly string[], hash?: string): Promise<string> {
  const kind = noteKindOf(name);
  // (an embed, `![[cat.png]]`, is the picture it names, found as a link to it is)
  const html = kind === "md" ? renderMarkdown(splitFrontmatter(text).body, { html: true, embedSrc: (t) => `${WIKI}${encodeLinkPart(t)}` }) : textHtml(text);
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  // (a link between notes shows its words, as in the editor)
  for (const a of doc.body.querySelectorAll("a[data-wiki]")) a.replaceWith(a.textContent ?? "");
  if (badges.length) {
    const row = doc.createElement("p");
    row.className = "props";
    row.append(...badges.map((b) => Object.assign(doc.createElement("span"), { className: "prop", textContent: b })));
    doc.body.prepend(row);
  }
  for (const n of doc.body.querySelectorAll("script, style, iframe, object, embed, link, meta")) n.remove();
  for (const el of doc.body.querySelectorAll("img, video, audio")) {
    const src = el.getAttribute("src") ?? el.querySelector("source")?.getAttribute("src") ?? "";
    // (a temporary address saved in the file by an older version: found by the name it carries)
    const lost = src.startsWith("blob:") ? el.getAttribute("alt") : null;
    const asked = lost ? `${WIKI}${encodeLinkPart(lost)}` : src;
    const found = hash && pictures && asked && !(src.startsWith("blob:") && !lost) ? await pictures(hash, asked).catch(() => null) : null;
    const data = found ? await pictureData(found.blob, Number(el.getAttribute("width")) || null) : null;
    const box = doc.createElement("span");
    box.className = "pic";
    if (data) {
      const img = doc.createElement("img");
      img.setAttribute("src", data.url);
      img.setAttribute("width", String(data.w));
      img.setAttribute("height", String(data.h));
      box.className = found!.type.startsWith("video/") ? "media is-video" : found!.type.startsWith("audio/") ? "media is-audio" : "media";
      box.append(img);
    } else box.textContent = el.getAttribute("alt") || decodeURIComponent(src.split("/").pop() ?? "") || "Picture";
    el.replaceWith(box);
  }
  return new XMLSerializer().serializeToString(doc.body).replace(/^<body[^>]*>|<\/body>$/g, "");
}

/**
 * The size of a new card for a note (its picture on a canvas): the whole page at `CARD_SCALE`, as tall as the note (at least 4:3,
 * at most `cardMaxH`; a longer note fades out at the bottom).
 */
export async function noteCardSize(name: string, text: string, hash?: string): Promise<{ w: number; h: number }> {
  const h = await notePageHeight(name, text, PAGE_W, hash);
  return { w: PAGE_W * CARD_SCALE, h: Math.round(Math.min(NEW_CARD_MAX_H, Math.max((PAGE_W * 3) / 4, h)) * CARD_SCALE) };
}

/** How tall a note's page is laid out `width` CSS px wide (at most `PAGE_MAX_H`): the height of a card that shows the whole note. */
export async function notePageHeight(name: string, text: string, width: number, hash?: string): Promise<number> {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${css()}</style><div class="page me-doc${look === "dark" ? " dark" : ""}" style="width:${width}px">${await pageHtml(name, text, hash)}</div>`;
  document.body.append(host);
  const h = (root.lastElementChild as HTMLElement).scrollHeight;
  host.remove();
  return Math.min(PAGE_MAX_H, h);
}

/**
 * The top of a note's page, `w` × `h` pixels, laid out `lw` CSS px wide (a card: its own width, `w / CARD_SCALE`, or the full card's for a
 * smaller copy of it; a thumbnail: `PAGE_W`); when the note goes on below, it fades out at the bottom.
 */
export async function notePicture(name: string, text: string, w: number, h: number, hash?: string, lw = PAGE_W): Promise<HTMLCanvasElement> {
  const k = w / lw;
  const lh = Math.round(h / k);
  const html = await pageHtml(name, text, hash);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${lw} ${lh}"><foreignObject width="${lw}" height="${lh}"><div xmlns="http://www.w3.org/1999/xhtml" class="page me-doc${look === "dark" ? " dark" : ""}" style="width:${lw}px;height:${lh}px"><style>${css()}</style>${html}</div></foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = cardContext(c); // (in the computer's memory: see cardContext)
  x.drawImage(img, 0, 0, w, h);
  if ((await notePageHeight(name, text, lw, hash)) <= lh + 1) return c; // (the whole note is in it)
  const fade = x.createLinearGradient(0, h * 0.82, 0, h);
  const paper = look === "dark" ? "oklch(0.23 0.01 250" : "oklch(0.985 0.004 95"; // (the page's own colour, .page / .page.dark)
  fade.addColorStop(0, `${paper} / 0)`);
  fade.addColorStop(1, `${paper})`);
  x.fillStyle = fade;
  x.fillRect(0, h * 0.82, w, h * 0.18);
  return c;
}
