/**
 * Any file can go in the library (ADR 0078). What the browser can show is shown (pictures, video, audio, GIF); every other file, and any
 * picture, video or sound the browser cannot read, is kept as it is and shown as a card with its extension, its name and what it is, with
 * the buttons that make sense for it (download it; open it in a tab when a browser can show it).
 */

/** Pictures, videos and sounds are the types the browser may be able to show. */
export const isMediaType = (type: string): boolean => /^(image|video|audio)\//.test(type);

/** Shown as a card: not something the browser can show (any other file), or a picture, video or sound it could not read. */
export const isCard = (x: { type: string; card?: boolean }): boolean => !isMediaType(x.type) || x.card === true;

/** A font file (shown by its letters: a thumbnail of "Aa" in that font). */
export const isFontFile = (x: { type: string; name: string }): boolean => /^font\//.test(x.type) || /^(TTF|OTF|WOFF2?|TTC)$/.test(extOf(x.name));

/** A file card with a thumbnail of its own (a font's letters), else a card shows the file tile. */
export const hasThumb = (x: { type: string; name: string; card?: boolean }): boolean => !isCard(x) || isFontFile(x);

/** The extension of a file name, upper case and at most eight letters or digits; "" when there is none. */
export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1]!.toUpperCase() : "";
}

/** What to say on the chip: the extension, else the subtype of the type ("model/gltf-binary" is GLTF-BINARY, cut to eight), else FILE. */
export function chipOf(name: string, type: string): string {
  const e = extOf(name);
  if (e) return e;
  const sub = /^[a-z]+\/(?:x-|vnd\.)?([a-z0-9+.-]+)/i.exec(type)?.[1];
  return sub && type !== "application/octet-stream" ? sub.toUpperCase().slice(0, 8) : "FILE";
}

interface Category {
  readonly label: string;
  readonly exts: readonly string[];
  /** What to do with it, in one sentence. */
  readonly todo: string;
}

const CATEGORIES: readonly Category[] = [
  { label: "3D model", exts: ["glb", "gltf", "obj", "fbx", "stl", "blend", "3ds", "dae", "usdz", "usd", "usda", "usdc", "ply", "step", "stp", "iges", "igs", "3mf", "skp", "max", "ma", "mb", "c4d", "abc"], todo: "Download it and open it in a 3D viewer or editor, such as Blender." },
  { label: "Document", exts: ["pdf", "doc", "docx", "odt", "rtf", "pages", "epub", "mobi", "tex", "wpd"], todo: "Download it and open it in a reader or word processor." },
  { label: "Spreadsheet", exts: ["xls", "xlsx", "ods", "numbers", "xlsm"], todo: "Download it and open it in a spreadsheet app." },
  { label: "Presentation", exts: ["ppt", "pptx", "odp", "key"], todo: "Download it and open it in a presentation app." },
  { label: "Archive", exts: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "iso", "dmg"], todo: "Download it and unpack it with an archive tool." },
  { label: "Design file", exts: ["psd", "psb", "ai", "xd", "sketch", "fig", "afdesign", "afphoto", "kra", "clip", "xcf", "indd", "eps"], todo: "Download it and open it in the app that made it." },
  { label: "Font", exts: ["ttf", "otf", "woff", "woff2", "eot"], todo: "Download it and install it, or open it in a font viewer." },
  { label: "Text or code", exts: ["txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "toml", "ini", "log", "html", "htm", "css", "js", "mjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "hpp", "cs", "php", "sh", "sql", "tex"], todo: "Download it and open it in a text or code editor." },
  { label: "Data", exts: ["db", "sqlite", "sqlite3", "parquet", "npy", "npz", "h5", "hdf5", "mat", "bin", "dat"], todo: "Download it and open it in the program that reads it." },
  { label: "Camera raw", exts: ["raw", "cr2", "cr3", "nef", "arw", "dng", "orf", "rw2", "raf", "heic", "heif"], todo: "Download it and open it in a photo editor, or convert it to PNG or JPEG." },
];

export interface FileDescription {
  /** The extension on the chip. */
  readonly chip: string;
  /** What kind of file this is, in words ("3D model"). */
  readonly category: string;
  /** What to do with it. */
  readonly todo: string;
  /** How a browser tab can show it when asked: a document (PDF) or plain text, else null. */
  readonly openIn: "pdf" | "text" | null;
}

const TEXT_EXTS = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "toml", "ini", "log"]);

export function describeFile(name: string, type: string): FileDescription {
  const ext = extOf(name).toLowerCase();
  const found = CATEGORIES.find((c) => c.exts.includes(ext));
  const t = type.toLowerCase();
  const openIn = ext === "pdf" || t === "application/pdf" ? "pdf" : TEXT_EXTS.has(ext) || t === "text/plain" || t === "text/csv" || t === "application/json" ? "text" : null;
  const category = found?.label ?? (t.startsWith("image/") ? "Picture" : t.startsWith("video/") ? "Video" : t.startsWith("audio/") ? "Audio" : t.startsWith("text/") ? "Text or code" : "File");
  const todo = found?.todo ?? "Download it and open it in the app that made it.";
  return { chip: chipOf(name, type), category, todo, openIn };
}

/** The blob a browser tab can show for this file (a typed copy: PDF as a PDF, text as plain text, never as a page that could run). */
export function viewableBlob(blob: Blob, how: "pdf" | "text"): Blob {
  return new Blob([blob], { type: how === "pdf" ? "application/pdf" : "text/plain;charset=utf-8" });
}
