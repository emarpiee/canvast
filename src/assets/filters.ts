/**
 * Search words that filter by what an image is (ADR 0114), beside `#tag` and `.png`: `width>1000`, `h<=1080`, `pixels>2mp`, `size<500kb`,
 * `ratio>1.5` or `ratio:16x9`, `orientation:portrait`, `colour:red` or `colour:#2563eb`. Size words compare pixel sizes and the file size;
 * a colour word needs the picture's look (read from its thumbnail), which may not be known yet.
 *
 * Keywords about the item in the library: `is:hidden|missing|favourite|used|unused|filed|unfiled|tagged|untagged|thumbed|unthumbed`, `uses>2` (times placed),
 * `canvases>1`, `date:2026-10` (the day it was added, also `date>2026-01-01`, `date:today|yesterday|week|month|year`), `on:board` (the name of
 * a canvas it is placed on), `folder:refs` (a folder of its path), `description:word` (or `note:`), `property:source`, `property:source=web` and
 * `property:created>2025-01` or `property:rating>=4` (or `field:`), `kind:picture|video|audio|gif|font|file` and `duration>30s` (`1m`, `1h`,
 * `1:30`). A duration is read from the file and may not be known yet.
 */
import type { Look } from "./look";
import { colourMatches } from "./look";
import { kindFolder } from "../storage/workspace-names";

export interface Subject {
  readonly pixelW: number;
  readonly pixelH: number;
  readonly size: number;
  readonly name?: string;
  readonly type?: string;
  readonly card?: boolean;
  readonly importedAt?: number;
  readonly instances?: number;
  readonly canvases?: number;
  readonly present?: boolean;
}

/** What a library keyword reads besides the entry itself, all in lower case (made by the caller once per item). */
export interface Extra {
  readonly hidden: boolean;
  readonly favorite: boolean;
  readonly tags: number;
  /** It has a custom thumbnail. */
  readonly thumbed?: boolean;
  readonly folders: readonly string[];
  readonly note: string;
  readonly fields: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  /** The names of the canvases it is placed on. */
  readonly on: () => readonly string[];
  /** Seconds; undefined while unknown, null when the file has none (a picture). */
  readonly duration: () => number | null | undefined;
}

export type Verdict = boolean | "unknown";

export interface Filter {
  /** The word needs the picture's look (colour). */
  readonly needsLook: boolean;
  /** The word needs the file's length (read from the file). */
  readonly needsDuration?: boolean;
  test(s: Subject, look: Look | null | undefined, extra?: Extra): Verdict;
}

const OPS = [">=", "<=", ">", "<", "=", ":"] as const;
const compare = (a: number, op: (typeof OPS)[number], b: number): boolean => {
  const eps = Math.abs(b) * 1e-9;
  return op === ">" ? a > b : op === ">=" ? a >= b - eps : op === "<" ? a < b : op === "<=" ? a <= b + eps : Math.abs(a - b) <= Math.max(eps, 0.5);
};

const UNITS: Record<string, number> = { "": 1, k: 1e3, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, mp: 1e6, px: 1 };
const KEYS: Record<string, "w" | "h" | "pixels" | "size" | "ratio"> = { width: "w", w: "w", height: "h", h: "h", pixels: "pixels", px: "pixels", mp: "pixels", size: "size", bytes: "size", ratio: "ratio", aspect: "ratio" };

/** The filter a search word stands for, or null when it is an ordinary word. */
export function parseFilter(word: string, now = Date.now()): Filter | null {
  const w = word.toLowerCase();
  const kw = libraryKeyword(w, now);
  if (kw) return kw;
  const orient = /^orientation:(landscape|portrait|square)$/.exec(w);
  if (orient) {
    const want = orient[1]!;
    return { needsLook: false, test: (s) => (want === "square" ? Math.abs(s.pixelW - s.pixelH) <= Math.max(1, 0.02 * Math.max(s.pixelW, s.pixelH)) : want === "landscape" ? s.pixelW > s.pixelH * 1.02 : s.pixelH > s.pixelW * 1.02) };
  }
  if (/^colou?r:/.test(w) && w.replace(/^colou?r:/, "")) {
    return { needsLook: true, test: (_s, look) => (look ? colourMatches(look.colour, w) : "unknown") };
  }
  const m = /^([a-z]+)(>=|<=|>|<|=|:)(.+)$/.exec(w);
  if (!m || !(m[1]! in KEYS)) return null;
  const key = KEYS[m[1]!]!;
  const op = m[2] as (typeof OPS)[number];
  const val = m[3]!;
  if (key === "ratio") {
    const r = /^(\d+(?:\.\d+)?)[x/:](\d+(?:\.\d+)?)$/.exec(val);
    const want = r ? Number(r[1]) / Number(r[2]) : Number(val);
    if (!(want > 0) || !Number.isFinite(want)) return null;
    // `:` is "about": within three percent
    return { needsLook: false, test: (s) => (op === ":" || op === "=" ? Math.abs(s.pixelW / s.pixelH - want) <= want * 0.03 : compare(s.pixelW / s.pixelH, op, want)) };
  }
  const n = /^(\d+(?:\.\d+)?)([a-z]*)$/.exec(val);
  if (!n || !(n[2]! in UNITS)) return null;
  const amount = Number(n[1]) * UNITS[n[2]!]!;
  const of = (s: Subject): number => (key === "w" ? s.pixelW : key === "h" ? s.pixelH : key === "pixels" ? s.pixelW * s.pixelH : s.size);
  return { needsLook: false, test: (s) => compare(of(s), op, amount) };
}

/** The kind of a library item, as `kind:` names it. */
export const kindOf = (s: Subject): "picture" | "video" | "audio" | "gif" | "font" | "file" => {
  const t = s.type ?? "";
  if (/^font\//.test(t) || /\.(ttf|otf|woff2?|ttc)$/i.test(s.name ?? "")) return "font";
  if (s.card) return "file";
  if (t === "image/gif") return "gif";
  if (t.startsWith("image/")) return "picture";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  return "file";
};
const KINDS: Record<string, ReturnType<typeof kindOf>> = { picture: "picture", pictures: "picture", image: "picture", images: "picture", video: "video", videos: "video", audio: "audio", sound: "audio", gif: "gif", gifs: "gif", font: "font", fonts: "font", file: "file", files: "file", card: "file" };
/** Kinds by what the file is: the kind folders of a workspace folder (notes, vectors, documents...). */
const FILE_KINDS: Record<string, string> = { note: "notes", notes: "notes", vector: "vectors", vectors: "vectors", document: "documents", documents: "documents", archive: "archives", archives: "archives", "3d": "3d", model: "3d", models: "3d", preset: "presets", presets: "presets", icon: "icons", icons: "icons", art: "art_sources" };

const DAY = 86_400_000;
/** The span of days a date word names, [start, end) in local time, or null. */
export function dateSpan(v: string, now: number): [number, number] | null {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  if (v === "today") return [t0, t0 + DAY];
  if (v === "yesterday") return [t0 - DAY, t0];
  if (v === "week") return [t0 - 6 * DAY, t0 + DAY];
  if (v === "month") return [t0 - 29 * DAY, t0 + DAY];
  if (v === "year") return [t0 - 364 * DAY, t0 + DAY];
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(v);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) - 1 : null;
  const d = m[3] ? Number(m[3]) : null;
  if ((mo !== null && (mo < 0 || mo > 11)) || (d !== null && (d < 1 || d > 31))) return null;
  const start = new Date(y, mo ?? 0, d ?? 1).getTime();
  const end = d !== null ? new Date(y, mo!, d + 1).getTime() : mo !== null ? new Date(y, mo + 1, 1).getTime() : new Date(y + 1, 0, 1).getTime();
  return [start, end];
}

/** Seconds a duration word names: `90`, `90s`, `1.5m`, `2h`, `500ms`, `1:30`, `1:02:03`; null when it is not one. */
export function parseSeconds(v: string): number | null {
  if (/^\d+(:\d{1,2}){1,2}$/.test(v)) return v.split(":").reduce((a, x) => a * 60 + Number(x), 0);
  const m = /^(\d+(?:\.\d+)?)(ms|s|sec|m|min|h)?$/.exec(v);
  if (!m) return null;
  const k = m[2] === "ms" ? 0.001 : m[2] === "m" || m[2] === "min" ? 60 : m[2] === "h" ? 3600 : 1;
  return Number(m[1]) * k;
}

/** A property's value as what it says: a date (`2024-09-03`, `2024-09-03T01:47`), a number, or words. */
export function typedValue(v: string): { n: number } | { t: string } {
  const s = v.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return { n: Number(s) };
  if (/^\d{4}-\d{1,2}(?:-\d{1,2})?(?:[t ]\d{1,2}:\d{2}(?::\d{2})?)?/i.test(s)) {
    const [y, mo, d, h, mi] = s.split(/[-t: ]/i).map(Number);
    return { n: new Date(y!, mo! - 1, d ?? 1, h ?? 0, mi ?? 0).getTime() };
  }
  return { t: s.toLowerCase() };
}

/** A list's items (a property written as a list is joined with commas); a text with no comma is one item. */
const listItems = (v: string): string[] => v.split(/,\s+/);

/** Whether a property's value holds for `>2025-01`, `<=4` or `>m`: a date against the span a date word names (after a month is after its last day), a number against a number, else by the alphabet. */
function typedTest(op: ">=" | "<=" | ">" | "<", want: string, now: number): ((value: string) => boolean) | null {
  if (!want) return null;
  const NUMBER = /^-?\d+(?:\.\d+)?$/;
  const span = /^\d{4}(?:-\d{1,2}(?:-\d{1,2})?)?$|^(?:today|yesterday|week|month|year)$/.test(want) ? dateSpan(want, now) : null;
  const number = NUMBER.test(want) ? Number(want) : null;
  return (value) => {
    const t = typedValue(value);
    if ("t" in t) {
      if (span || number !== null) return false;
      const c = t.t.localeCompare(want);
      return op === ">" ? c > 0 : op === ">=" ? c >= 0 : op === "<" ? c < 0 : c <= 0;
    }
    if (NUMBER.test(value.trim())) return number !== null && compare(t.n, op, number);
    if (!span) return false;
    return op === ">" ? t.n >= span[1] : op === ">=" ? t.n >= span[0] : op === "<" ? t.n < span[0] : t.n < span[1];
  };
}

const IS: Record<string, (s: Subject, x: Extra) => boolean> = {
  hidden: (_s, x) => x.hidden,
  missing: (s) => s.present === false,
  favourite: (_s, x) => x.favorite,
  favorite: (_s, x) => x.favorite,
  fav: (_s, x) => x.favorite,
  used: (s) => (s.instances ?? 0) > 0,
  unused: (s) => (s.instances ?? 0) === 0,
  filed: (_s, x) => x.folders.length > 0,
  unfiled: (_s, x) => x.folders.length === 0,
  tagged: (_s, x) => x.tags > 0,
  untagged: (_s, x) => x.tags === 0,
  thumbed: (_s, x) => !!x.thumbed,
  unthumbed: (_s, x) => !x.thumbed,
};

function libraryKeyword(w: string, now: number): Filter | null {
  const plain = (test: (s: Subject, x: Extra) => Verdict): Filter => ({ needsLook: false, test: (s, _l, x) => (x ? test(s, x) : "unknown") });
  const is = /^is:([a-z]+)$/.exec(w);
  if (is) {
    const f = IS[is[1]!];
    return f ? plain(f) : null;
  }
  const kind = /^kind:([a-z0-9]+)$/.exec(w);
  if (kind) {
    const k = KINDS[kind[1]!];
    if (k) return { needsLook: false, test: (s) => kindOf(s) === k };
    const f = FILE_KINDS[kind[1]!];
    return f ? { needsLook: false, test: (s) => kindFolder(s.type ?? "", s.name ?? "") === f } : null;
  }
  const text = /^(on|folder|note|description|field|property):(.+)$/.exec(w);
  if (text) {
    const v = text[2]!;
    if (text[1] === "on") return plain((_s, x) => x.on().some((n) => n.includes(v)));
    if (text[1] === "folder") return plain((_s, x) => x.folders.some((n) => n.includes(v)));
    if (text[1] === "note" || text[1] === "description") return plain((_s, x) => x.note.includes(v));
    const at = /^(.+?)(>=|<=|>|<|=)(.*)$/.exec(v);
    const key = at ? at[1]! : v;
    if (at && at[2] !== "=") {
      const holds = typedTest(at[2] as ">=" | "<=" | ">" | "<", at[3]!, now);
      return holds ? plain((_s, x) => x.fields.some((f) => f.key.includes(key) && listItems(f.value).some(holds))) : null;
    }
    const val = at ? at[3]! : null;
    return plain((_s, x) => x.fields.some((f) => f.key.includes(key) && (val === null || f.value.includes(val))));
  }
  const m = /^(uses|canvases|date|added|duration|length)(>=|<=|>|<|=|:)(.+)$/.exec(w);
  if (!m) return null;
  const op = m[2] as (typeof OPS)[number];
  const v = m[3]!;
  if (m[1] === "uses" || m[1] === "canvases") {
    if (!/^\d+$/.test(v)) return null;
    const n = Number(v);
    const key = m[1] === "uses" ? "instances" : "canvases";
    return { needsLook: false, test: (s) => compare(s[key] ?? 0, op, n) };
  }
  if (m[1] === "date" || m[1] === "added") {
    const span = dateSpan(v, now);
    if (!span) return null;
    const [a, b] = span;
    return {
      needsLook: false,
      test: (s) => {
        const t = s.importedAt ?? 0;
        return op === ">" ? t >= b : op === ">=" ? t >= a : op === "<" ? t < a : op === "<=" ? t < b : t >= a && t < b;
      },
    };
  }
  const secs = parseSeconds(v);
  if (secs === null) return null;
  return {
    needsLook: false,
    needsDuration: true,
    test: (_s, _l, x) => {
      const d = x?.duration();
      return d === undefined ? "unknown" : d === null ? false : op === ":" || op === "=" ? Math.abs(d - secs) <= Math.max(0.5, secs * 0.02) : compare(d, op, secs);
    },
  };
}
