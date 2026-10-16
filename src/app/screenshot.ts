/**
 * Screenshots (ADR 0080): what the canvas shows, stored in the library like any picture. This file holds the pure parts (the file name, the
 * tags, the formats) and the parts that make the picture (the interface laid over it, the encoding).
 */
export type ShotFormat = "webp" | "png" | "jpeg";

export const SHOT_FORMATS: Record<ShotFormat, { ext: string; mime: string; lossy: boolean }> = {
  webp: { ext: "webp", mime: "image/webp", lossy: true },
  png: { ext: "png", mime: "image/png", lossy: false },
  jpeg: { ext: "jpg", mime: "image/jpeg", lossy: true },
};

export interface NameParts {
  workspace: string;
  board: string;
  canvas: string;
  at: Date;
  /** Other name-like words: {name} the source file's name, {position} where in it (frames). */
  extra?: Record<string, string>;
}

const p2 = (n: number): string => String(n).padStart(2, "0");

/** How the words of a name are written in a file name. */
export type NameStyle = "snake" | "kebab" | "camel" | "pascal" | "keep" | "underscores";
export const NAME_STYLES: ReadonlyArray<[NameStyle, string]> = [
  ["snake", "snake_case (lower_case_with_underscores)"],
  ["kebab", "kebab-case (lower-case-with-hyphens)"],
  ["camel", "camelCase (firstWordLowerThenCapitals)"],
  ["pascal", "PascalCase (EveryWordCapitalised)"],
  ["keep", "As written"],
];

/** One name part as a file name word, in a naming style; characters a file system refuses become "-". */
export function nameWord(text: string, style: NameStyle): string {
  const base = text.normalize("NFC").replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "-").trim();
  const words = base.split(/[\s_]+|-+/).filter(Boolean);
  const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  let out: string;
  switch (style) {
    case "snake":
    case "underscores":
      out = base.toLowerCase().replace(/[\s_]+/g, "_").replace(/_+/g, "_");
      break;
    case "kebab":
      out = base.toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
      break;
    case "camel":
      out = words.map((w, i) => (i === 0 ? w.toLowerCase() : cap(w))).join("");
      break;
    case "pascal":
      out = words.map(cap).join("");
      break;
    default:
      out = base;
  }
  return out.replace(/^[.\-_]+|[.\-_]+$/g, "") || "untitled";
}

/**
 * The file name from a template. Tokens: {workspace} {board} {canvas} {ddmmyyyy} {yyyymmdd} {yyyy} {mm} {dd} {hhmmss} {hhmm} {hh} {min} {ss}.
 * An unknown word in braces is left as it is; an empty result falls back to "screenshot". The extension is added by the caller.
 */
export function shotFileName(template: string, parts: NameParts, style: NameStyle): string {
  const d = parts.at;
  const t: Record<string, string> = {
    workspace: nameWord(parts.workspace, style),
    board: nameWord(parts.board, style),
    canvas: nameWord(parts.canvas, style),
    ...Object.fromEntries(Object.entries(parts.extra ?? {}).map(([k, v]) => [k, nameWord(v, style)])),
    yyyy: String(d.getFullYear()),
    mm: p2(d.getMonth() + 1),
    dd: p2(d.getDate()),
    hh: p2(d.getHours()),
    min: p2(d.getMinutes()),
    ss: p2(d.getSeconds()),
  };
  t["ddmmyyyy"] = `${t["dd"]}${t["mm"]}${t["yyyy"]}`;
  t["yyyymmdd"] = `${t["yyyy"]}${t["mm"]}${t["dd"]}`;
  t["hhmmss"] = `${t["hh"]}${t["min"]}${t["ss"]}`;
  t["hhmm"] = `${t["hh"]}${t["min"]}`;
  const raw = template.replace(/\{([a-z]+)\}/g, (m, k: string) => t[k] ?? m);
  const clean = raw.normalize("NFC").replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "-").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 150);
  return clean || "screenshot";
}

export interface TagChoices {
  screenshot: boolean;
  board: boolean;
  canvas: boolean;
  items: boolean;
  /** The person's own tags, separated by commas or lines. */
  custom: string;
}

/** Tags typed by the person: separated by commas, semicolons or lines. */
export const parseTags = (text: string): string[] => text.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);

/** The tags to put on the screenshot: "screenshot", the board and canvas names, the in-canvas tags of the items in it, and the person's own. */
export function shotTags(choices: TagChoices, board: string, canvas: string, itemTags: readonly string[]): string[] {
  const out: string[] = [];
  if (choices.screenshot) out.push("screenshot");
  if (choices.board) out.push(board);
  if (choices.canvas) out.push(canvas);
  if (choices.items) out.push(...itemTags);
  out.push(...parseTags(choices.custom));
  return out.map((t) => t.replace(/\s+/g, " ").trim().replace(/^#+/, "").slice(0, 64)).filter(Boolean);
}

/** Encode a canvas. WebP falls back to PNG where the browser cannot write it (the format that was used is returned). */
export async function encodeShot(canvas: HTMLCanvasElement, format: ShotFormat, quality: number): Promise<{ blob: Blob; format: ShotFormat }> {
  const make = (f: ShotFormat): Promise<Blob | null> => new Promise((r) => canvas.toBlob(r, SHOT_FORMATS[f].mime, SHOT_FORMATS[f].lossy ? quality / 100 : undefined));
  const first = await make(format);
  if (first && first.type === SHOT_FORMATS[format].mime) return { blob: first, format };
  const png = await make("png");
  if (!png) throw new Error("the browser could not make the picture");
  return { blob: png, format: "png" };
}

/**
 * Lay the floating interface over the picture of the canvas: the open document's bars and panels are copied into an SVG image (the page's own
 * styles inline, the canvas as a picture) and drawn onto `base`. Throws when the browser refuses (the caller saves without the interface).
 */
export async function withInterface(base: HTMLCanvasElement, host: HTMLElement, nav: HTMLElement, cssWidth: number, cssHeight: number): Promise<HTMLCanvasElement> {
  const clone = host.cloneNode(true) as HTMLElement;
  const live = host.querySelector("canvas");
  const shot = document.createElement("img");
  shot.setAttribute("style", `position:absolute;left:0;top:0;width:${cssWidth}px;height:${cssHeight}px`);
  shot.src = base.toDataURL("image/png");
  clone.querySelector("canvas")?.replaceWith(shot);
  void live;
  const navClone = nav.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll("[hidden], dialog:not([open])")) el.remove();
  for (const el of navClone.querySelectorAll("[hidden]")) el.remove();
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
  const root = document.documentElement;
  const attrs = [...root.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `${a.name}="${a.value.replace(/"/g, "&quot;")}"`).join(" ");
  const ser = new XMLSerializer();
  const body = `<body xmlns="http://www.w3.org/1999/xhtml" data-view="canvas" style="margin:0;width:${cssWidth}px;height:${cssHeight}px;position:relative;overflow:hidden;font-family:system-ui,sans-serif">${ser.serializeToString(navClone)}${ser.serializeToString(clone)}</body>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cssWidth}" height="${cssHeight}" ${attrs}><style>${css.replace(/]]>/g, "]]&gt;")}</style><foreignObject x="0" y="0" width="100%" height="100%">${body}</foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const out = document.createElement("canvas");
  out.width = base.width;
  out.height = base.height;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(base, 0, 0);
  ctx.drawImage(img, 0, 0, base.width, base.height);
  // A canvas the browser marked as unsafe to read cannot be saved: say so instead of saving nothing.
  out.toDataURL("image/png", 0.1);
  return out;
}
