import { noteKindOf, richNoteBody, textHtml } from "./note-file";

// The picture of a note (its library thumbnail and its card on a canvas): the top of its page, as the notes editor lays it out, drawn
// through an SVG image (`foreignObject`), which runs nothing and loads nothing. Fixed paper colours, like every file card: it is stored.
// shortcut: library pictures and fonts in the note are not drawn (a picture shows as a grey box with its name; text in the system's
// sans-serif); embed them as data URLs here if a preview should show them.

/** A note's page is laid out this wide (CSS px), whatever the size of its picture. */
const PAGE_W = 600;
/** A note's card on a canvas: its page drawn at twice its size (sharp when zoomed in), as tall as the note up to this many CSS px. */
const CARD_SCALE = 2;
const CARD_MAX_H = 1800;
const CSS = `
.page{box-sizing:border-box;overflow:hidden;padding:26px 30px;background:oklch(0.985 0.004 95);color:oklch(0.27 0.01 250);font:15px/1.45 system-ui,sans-serif;word-wrap:break-word}
h1,h2,h3,h4,h5,h6{margin:.2em 0 .45em;line-height:1.2}h1{font-size:1.9em}h2{font-size:1.5em}h3{font-size:1.25em}h4,h5,h6{font-size:1.05em}
p,ul,ol,blockquote,pre,table,figure{margin:0 0 .6em}ul,ol{padding-left:1.4em}
blockquote{border-left:3px solid oklch(0.82 0.01 250);padding-left:.8em;color:oklch(0.45 0.01 250)}
pre,code{font-family:ui-monospace,monospace;background:oklch(0.94 0.005 250);border-radius:4px}pre{padding:.5em .7em;white-space:pre-wrap}
table{border-collapse:collapse}td,th{border:1px solid oklch(0.82 0.01 250);padding:.2em .45em}hr{border:0;border-top:1px solid oklch(0.82 0.01 250)}
li:has(>input[type=checkbox]:first-child){list-style:none;margin-left:-1.2em}a{color:oklch(0.5 0.1 200)}.pic{display:inline-block;padding:.7em 1.1em;border-radius:4px;background:oklch(0.9 0.005 250);color:oklch(0.48 0.01 250);font-size:.85em}`;

/** The note's text as HTML that can be drawn in an image: no pictures (they could not load there), no scripts or frames. */
async function pageHtml(name: string, text: string): Promise<string> {
  const kind = noteKindOf(name);
  const { markdownHtml } = await import("./note-markdown"); // (loaded when a preview is made: the editor needs a page, not the unit tests' Node)
  const html = kind === "md" ? markdownHtml(text) : kind === "rich" ? richNoteBody(text) : textHtml(text);
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const n of doc.body.querySelectorAll("script, style, iframe, object, embed, link, meta, video, audio")) n.remove();
  for (const img of doc.body.querySelectorAll("img")) {
    const box = doc.createElement("span");
    box.className = "pic";
    box.textContent = img.getAttribute("alt") || "Picture";
    img.replaceWith(box);
  }
  return new XMLSerializer().serializeToString(doc.body).replace(/^<body[^>]*>|<\/body>$/g, "");
}

/**
 * The size of a new card for a note (its picture on a canvas): the whole page at `CARD_SCALE`, as tall as the note (at least 4:3,
 * at most `CARD_MAX_H`; a longer note fades out at the bottom).
 */
export async function noteCardSize(name: string, text: string): Promise<{ w: number; h: number }> {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${CSS}</style><div class="page" style="width:${PAGE_W}px">${await pageHtml(name, text)}</div>`;
  document.body.append(host);
  const h = (root.lastElementChild as HTMLElement).scrollHeight;
  host.remove();
  return { w: PAGE_W * CARD_SCALE, h: Math.round(Math.min(CARD_MAX_H, Math.max((PAGE_W * 3) / 4, h)) * CARD_SCALE) };
}

/** The top of a note's page, `w` × `h` pixels (laid out `PAGE_W` wide); when the note goes on below, it fades out at the bottom. */
export async function notePicture(name: string, text: string, w: number, h: number): Promise<HTMLCanvasElement> {
  const k = w / PAGE_W;
  const lw = PAGE_W;
  const lh = Math.round(h / k);
  const html = await pageHtml(name, text);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${lw} ${lh}"><foreignObject width="${lw}" height="${lh}"><div xmlns="http://www.w3.org/1999/xhtml" class="page" style="width:${lw}px;height:${lh}px"><style>${CSS}</style>${html}</div></foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  x.drawImage(img, 0, 0, w, h);
  if ((await noteCardSize(name, text)).h / CARD_SCALE <= lh) return c; // (the whole note is in it)
  const fade = x.createLinearGradient(0, h * 0.82, 0, h);
  fade.addColorStop(0, "oklch(0.985 0.004 95 / 0)");
  fade.addColorStop(1, "oklch(0.985 0.004 95)");
  x.fillStyle = fade;
  x.fillRect(0, h * 0.82, w, h * 0.18);
  return c;
}
