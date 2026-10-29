/**
 * Search words that filter by what an image is (ADR 0114), beside `#tag` and `.png`: `width>1000`, `h<=1080`, `pixels>2mp`, `size<500kb`,
 * `ratio>1.5` or `ratio:16x9`, `orientation:portrait`, `colour:red` or `colour:#2563eb`. Size words compare pixel sizes and the file size;
 * a colour word needs the picture's look (read from its thumbnail), which may not be known yet.
 *
 * Keywords about the item in the library: `is:hidden|missing|favourite|used|unused|filed|unfiled|tagged|untagged`, `uses>2` (times placed),
 * `canvases>1`, `date:2026-10` (the day it was added, also `date>2026-01-01`, `date:today|yesterday|week|month|year`), `on:board` (the name of
 * a canvas it is placed on), `folder:refs` (a folder of its path), `note:word`, `field:source` or `field:source=web`, `kind:picture|video|
 * audio|gif|font|file` and `duration>30s` (`1m`, `1h`, `1:30`). A duration is read from the file and may not be known yet.
 */
import type { Look } from "./look";
import { colourMatches } from "./look";

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
};

function libraryKeyword(w: string, now: number): Filter | null {
  const plain = (test: (s: Subject, x: Extra) => Verdict): Filter => ({ needsLook: false, test: (s, _l, x) => (x ? test(s, x) : "unknown") });
  const is = /^is:([a-z]+)$/.exec(w);
  if (is) {
    const f = IS[is[1]!];
    return f ? plain(f) : null;
  }
  const kind = /^kind:([a-z]+)$/.exec(w);
  if (kind) {
    const k = KINDS[kind[1]!];
    return k ? { needsLook: false, test: (s) => kindOf(s) === k } : null;
  }
  const text = /^(on|folder|note|field):(.+)$/.exec(w);
  if (text) {
    const v = text[2]!;
    if (text[1] === "on") return plain((_s, x) => x.on().some((n) => n.includes(v)));
    if (text[1] === "folder") return plain((_s, x) => x.folders.some((n) => n.includes(v)));
    if (text[1] === "note") return plain((_s, x) => x.note.includes(v));
    const eq = v.indexOf("=");
    const key = eq < 0 ? v : v.slice(0, eq);
    const val = eq < 0 ? null : v.slice(eq + 1);
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
