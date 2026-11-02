import { WIKI, noteKindOf, richNoteBody, textHtml } from "./note-file";
import { cardContext } from "../assets/card";
import { splitFrontmatter } from "./frontmatter";

// The picture of a note (its library thumbnail and its card on a canvas): the top of its page, as the notes editor lays it out, drawn
// through an SVG image (`foreignObject`), which runs nothing and loads nothing. Light or dark paper (`setNoteLook`): cards are drawn in memory, never stored.
// Its pictures, videos and sounds are found by the app (`setNotePictures`) and drawn into it as data (a video by its picture, with a
// ▶; a sound by its waveform, with a ♪). shortcut: library fonts are not (its text is in the system's sans-serif), embed them likewise if wanted.

/** A note's page is laid out this wide (CSS px), whatever the size of its picture. */
const PAGE_W = 600;
/** A note's card on a canvas: its page drawn at twice its size (sharp when zoomed in), as tall as the note up to `cardMaxH` CSS px. */
const CARD_SCALE = 2;
/** How much of a long note its card shows (Settings > Notes, Preview length): page heights in CSS px. */
export const NOTE_CARD_LENGTHS = { short: 900, medium: 1800, long: 4000, whole: 8000 } as const;
let cardMaxH: number = NOTE_CARD_LENGTHS.long;
export const setNoteCardLength = (length: keyof typeof NOTE_CARD_LENGTHS): void => void (cardMaxH = NOTE_CARD_LENGTHS[length]);
const CSS = `
.page{box-sizing:border-box;overflow:hidden;padding:26px 30px;background:oklch(0.985 0.004 95);color:oklch(0.27 0.01 250);font:15px/1.45 system-ui,sans-serif;word-wrap:break-word}
h1,h2,h3,h4,h5,h6{margin:.2em 0 .45em;line-height:1.2}h1{font-size:1.9em}h2{font-size:1.5em}h3{font-size:1.25em}h4,h5,h6{font-size:1.05em}
p,ul,ol,blockquote,pre,table,figure{margin:0 0 .6em}ul,ol{padding-left:1.4em}
blockquote{border-left:3px solid oklch(0.82 0.01 250);padding-left:.8em;color:oklch(0.45 0.01 250)}
pre,code{font-family:ui-monospace,monospace;background:oklch(0.94 0.005 250);border-radius:4px}pre{padding:.5em .7em;white-space:pre-wrap}
table{border-collapse:collapse}td,th{border:1px solid oklch(0.82 0.01 250);padding:.2em .45em}hr{border:0;border-top:1px solid oklch(0.82 0.01 250)}
li:has(>input[type=checkbox]:first-child){list-style:none;margin-left:-1.2em}.media{position:relative;display:inline-block;max-width:100%}.media img{display:block;max-width:100%;height:auto;border-radius:4px}.is-video::after,.is-audio::after{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:2.4em;height:2.4em;border-radius:50%;background:oklch(0.2 0 0 / .6);color:#fff;font-size:1.4em;line-height:2.4em;text-align:center}.is-video::after{content:"▶"}.is-audio::after{content:"♪"}a{color:oklch(0.5 0.1 200)}.pic{display:inline-block;padding:.7em 1.1em;border-radius:4px;background:oklch(0.9 0.005 250);color:oklch(0.48 0.01 250);font-size:.85em}
.page.dark{background:oklch(0.23 0.01 250);color:oklch(0.9 0.005 250)}.dark blockquote{border-left-color:oklch(0.42 0.01 250);color:oklch(0.72 0.01 250)}.dark pre,.dark code{background:oklch(0.3 0.01 250)}.dark td,.dark th{border-color:oklch(0.4 0.01 250)}.dark a{color:oklch(0.76 0.1 200)}.dark .pic{background:oklch(0.32 0.01 250);color:oklch(0.75 0.01 250)}`;
/** Light or dark paper (Settings > Notes > Preview look); a change is drawn by whoever shows the cards. */
export type NoteLook = "light" | "dark";
let look: NoteLook = "light";
/** Whether the look changed. */
export const setNoteLook = (l: NoteLook): boolean => (l === look ? false : ((look = l), true));

/** What a link in a note shows: a picture (a picture item's own file, else its library thumbnail) and the item's type. */
export type NotePictureSource = (noteHash: string, link: string) => Promise<{ blob: Blob; type: string } | null>;
let pictures: NotePictureSource | null = null;
/** How the app finds the pictures of a note's links (main.ts): the preview has no library of its own. */
export const setNotePictures = (fn: NotePictureSource): void => void (pictures = fn);

/** A picture as data for the page, at most the page's width (twice, for a sharp card), and its size there. */
async function pictureData(blob: Blob): Promise<{ url: string; w: number; h: number } | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, (PAGE_W * 2) / bmp.width);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const shown = Math.min(PAGE_W - 60, bmp.width);
    const out = { url: c.toDataURL("image/webp", 0.82), w: shown, h: Math.round((shown * bmp.height) / bmp.width) };
    bmp.close();
    return out;
  } catch {
    return null;
  }
}

/** The last pages made (a card is measured, then drawn: its pictures are read and packed once). */
const made = new Map<string, Promise<string>>();
function pageHtml(name: string, text: string, hash?: string): Promise<string> {
  const key = `${hash ?? ""}|${name}|${text.length}|${text.slice(0, 64)}`;
  let p = made.get(key);
  if (!p) {
    p = makePageHtml(name, text, hash);
    made.set(key, p);
    if (made.size > 8) made.delete(made.keys().next().value!);
  }
  return p;
}

/** The note's text as HTML that can be drawn in an image: its media as pictures in data (nothing loads there), no scripts or frames. */
async function makePageHtml(name: string, text: string, hash?: string): Promise<string> {
  const kind = noteKindOf(name);
  const { markdownHtml } = await import("./note-markdown"); // (loaded when a preview is made: the editor needs a page, not the unit tests' Node)
  // (Obsidian's `![[cat.png]]`: the picture it embeds)
  const md = (t: string): string => splitFrontmatter(t).body.replace(/!\[\[([^\[\]|\n]+?)(?:\|[^\[\]\n]*)?\]\]/g, (_m, n: string) => `![${n.trim()}](${WIKI}${encodeURIComponent(n.trim())})`);
  const html = kind === "md" ? markdownHtml(md(text)) : kind === "rich" ? richNoteBody(text) : textHtml(text);
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const n of doc.body.querySelectorAll("script, style, iframe, object, embed, link, meta, video, audio")) n.remove();
  for (const el of doc.body.querySelectorAll("img, video, audio")) {
    const src = el.getAttribute("src") ?? el.querySelector("source")?.getAttribute("src") ?? "";
    const found = hash && pictures && src ? await pictures(hash, src).catch(() => null) : null;
    const data = found ? await pictureData(found.blob) : null;
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
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${CSS}</style><div class="page${look === "dark" ? " dark" : ""}" style="width:${PAGE_W}px">${await pageHtml(name, text, hash)}</div>`;
  document.body.append(host);
  const h = (root.lastElementChild as HTMLElement).scrollHeight;
  host.remove();
  return { w: PAGE_W * CARD_SCALE, h: Math.round(Math.min(cardMaxH, Math.max((PAGE_W * 3) / 4, h)) * CARD_SCALE) };
}

/** The top of a note's page, `w` × `h` pixels (laid out `PAGE_W` wide); when the note goes on below, it fades out at the bottom. */
export async function notePicture(name: string, text: string, w: number, h: number, hash?: string): Promise<HTMLCanvasElement> {
  const k = w / PAGE_W;
  const lw = PAGE_W;
  const lh = Math.round(h / k);
  const html = await pageHtml(name, text, hash);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${lw} ${lh}"><foreignObject width="${lw}" height="${lh}"><div xmlns="http://www.w3.org/1999/xhtml" class="page${look === "dark" ? " dark" : ""}" style="width:${lw}px;height:${lh}px"><style>${CSS}</style>${html}</div></foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = cardContext(c); // (in the computer's memory: see cardContext)
  x.drawImage(img, 0, 0, w, h);
  if ((await noteCardSize(name, text, hash)).h / CARD_SCALE <= lh) return c; // (the whole note is in it)
  const fade = x.createLinearGradient(0, h * 0.82, 0, h);
  const paper = look === "dark" ? "oklch(0.23 0.01 250" : "oklch(0.985 0.004 95"; // (the page's own colour, .page / .page.dark)
  fade.addColorStop(0, `${paper} / 0)`);
  fade.addColorStop(1, `${paper})`);
  x.fillStyle = fade;
  x.fillRect(0, h * 0.82, w, h * 0.18);
  return c;
}
