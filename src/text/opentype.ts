/**
 * The OpenType layout tables a text needs (ADR 0132): the names of a font (family, style, weight, italic), kerning (`GPOS` pair
 * adjustment for the `kern` feature, or the old `kern` table), and the glyph substitutions of `GSUB` that a feature turns on: single,
 * multiple and alternate substitution, and ligatures (the contextual lookups are not read). Features are chosen by tag across every script
 * and language of the font, which is what a person who picks "ligatures" or "small caps" for a text means.
 */

export interface FontNames {
  readonly family: string;
  readonly style: string;
  readonly weight: number;
  readonly italic: boolean;
}

type Tables = ReadonlyMap<string, { o: number; len: number }>;

/** One string of the `name` table, English first, or "" when the font has none. */
export function nameReader(v: DataView, tables: Tables): (id: number) => string {
  const t = tables.get("name");
  if (!t) return () => "";
  const count = v.getUint16(t.o + 2);
  const base = t.o + v.getUint16(t.o + 4);
  const recs: Array<{ platform: number; encoding: number; lang: number; id: number; len: number; off: number }> = [];
  for (let i = 0; i < count; i++) {
    const o = t.o + 6 + 12 * i;
    recs.push({ platform: v.getUint16(o), encoding: v.getUint16(o + 2), lang: v.getUint16(o + 4), id: v.getUint16(o + 6), len: v.getUint16(o + 8), off: v.getUint16(o + 10) });
  }
  const text = (r: (typeof recs)[number]): string => {
    let s = "";
    if (r.platform === 3 || r.platform === 0) for (let k = 0; k + 1 < r.len; k += 2) s += String.fromCharCode(v.getUint16(base + r.off + k));
    else for (let k = 0; k < r.len; k++) s += String.fromCharCode(v.getUint8(base + r.off + k));
    return s;
  };
  return (id) => {
    const of = recs.filter((r) => r.id === id);
    const pick = of.find((r) => r.platform === 3 && r.lang === 0x409) ?? of.find((r) => r.platform === 3) ?? of.find((r) => r.platform === 1) ?? of[0];
    return pick ? text(pick) : "";
  };
}

export function readNames(v: DataView, tables: Tables, name: (id: number) => string): FontNames {
  const os2 = tables.get("OS/2");
  const weight = os2 ? v.getUint16(os2.o + 4) : 400;
  const sel = os2 && os2.len >= 64 ? v.getUint16(os2.o + 62) : 0;
  const post = tables.get("post");
  const angle = post ? v.getInt32(post.o + 4) : 0;
  return { family: name(16) || name(1) || "Font", style: name(17) || name(2) || "Regular", weight: weight || 400, italic: (sel & 1) === 1 || angle !== 0 };
}

// ---- common structures -----------------------------------------------------------------------------------------------------------

const popcount = (n: number): number => {
  let c = 0;
  for (; n; n &= n - 1) c++;
  return c;
};

/** The glyph's index in a coverage table, or −1. */
function coverage(v: DataView, o: number, gid: number): number {
  const fmt = v.getUint16(o);
  const n = v.getUint16(o + 2);
  if (fmt === 1) {
    let lo = 0, hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = v.getUint16(o + 4 + 2 * mid);
      if (g === gid) return mid;
      if (g < gid) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
  let lo = 0, hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = o + 4 + 6 * mid;
    if (gid < v.getUint16(r)) hi = mid - 1;
    else if (gid > v.getUint16(r + 2)) lo = mid + 1;
    else return v.getUint16(r + 4) + gid - v.getUint16(r);
  }
  return -1;
}

function classOf(v: DataView, o: number, gid: number): number {
  const fmt = v.getUint16(o);
  if (fmt === 1) {
    const start = v.getUint16(o + 2), n = v.getUint16(o + 4);
    return gid >= start && gid < start + n ? v.getUint16(o + 6 + 2 * (gid - start)) : 0;
  }
  const n = v.getUint16(o + 2);
  let lo = 0, hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = o + 4 + 6 * mid;
    if (gid < v.getUint16(r)) hi = mid - 1;
    else if (gid > v.getUint16(r + 2)) lo = mid + 1;
    else return v.getUint16(r + 4);
  }
  return 0;
}

interface Layout {
  /** The lookup indices of every feature with this tag, in order. */
  lookups(tag: string): number[];
  tags(): string[];
  lookupType(i: number): number;
  /** The subtables of a lookup, extensions unwrapped: [offset, type]. */
  subtables(i: number): Array<[number, number]>;
}

function layoutOf(v: DataView, at: number): Layout {
  const featureList = at + v.getUint16(at + 6);
  const lookupList = at + v.getUint16(at + 8);
  const featureCount = v.getUint16(featureList);
  const feats: Array<{ tag: string; lookups: number[] }> = [];
  for (let i = 0; i < featureCount; i++) {
    const rec = featureList + 2 + 6 * i;
    const tag = String.fromCharCode(v.getUint8(rec), v.getUint8(rec + 1), v.getUint8(rec + 2), v.getUint8(rec + 3));
    const f = featureList + v.getUint16(rec + 4);
    const n = v.getUint16(f + 2);
    feats.push({ tag, lookups: Array.from({ length: n }, (_, k) => v.getUint16(f + 4 + 2 * k)) });
  }
  const lookupAt = (i: number): number => lookupList + v.getUint16(lookupList + 2 + 2 * i);
  return {
    lookups: (tag) => [...new Set(feats.filter((f) => f.tag === tag).flatMap((f) => f.lookups))].sort((a, b) => a - b),
    tags: () => [...new Set(feats.map((f) => f.tag))].sort(),
    lookupType: (i) => v.getUint16(lookupAt(i)),
    subtables(i) {
      const l = lookupAt(i);
      const type = v.getUint16(l);
      const n = v.getUint16(l + 4);
      const out: Array<[number, number]> = [];
      for (let k = 0; k < n; k++) {
        let s = l + v.getUint16(l + 6 + 2 * k);
        let t = type;
        // an extension subtable points at the real one, which may be far away (a 32-bit offset)
        if ((type === 9 && v.getUint16(s) === 1) || (type === 7 && v.getUint16(s) === 1)) {
          t = v.getUint16(s + 2);
          s += v.getUint32(s + 4);
        }
        out.push([s, t]);
      }
      return out;
    },
  };
}

// ---- kerning ---------------------------------------------------------------------------------------------------------------------

/** The kerning of a pair of glyphs in font units (to add to the advance of the first); 0 for most pairs. */
export function readKerning(v: DataView, tables: Tables): (a: number, b: number) => number {
  const cache = new Map<number, number>();
  const memo = (fn: (a: number, b: number) => number) => (a: number, b: number): number => {
    const key = a * 65536 + b;
    let r = cache.get(key);
    if (r === undefined) cache.set(key, (r = fn(a, b)));
    return r;
  };
  const gpos = tables.get("GPOS");
  if (gpos) {
    const lay = layoutOf(v, gpos.o);
    const lookups = lay.lookups("kern").filter((i) => lay.lookupType(i) === 2 || lay.lookupType(i) === 9);
    if (lookups.length) {
      const pair = (s: number, a: number, b: number): number => {
        const fmt = v.getUint16(s);
        const cov = coverage(v, s + v.getUint16(s + 2), a);
        if (cov < 0) return NaN;
        const f1 = v.getUint16(s + 4), f2 = v.getUint16(s + 6);
        const xa1 = f1 & 4 ? popcount(f1 & 3) * 2 : -1;
        const size1 = popcount(f1) * 2, size2 = popcount(f2) * 2;
        if (fmt === 1) {
          const set = s + v.getUint16(s + 10 + 2 * cov);
          const n = v.getUint16(set);
          const rec = 2 + size1 + size2;
          let lo = 0, hi = n - 1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const o = set + 2 + rec * mid;
            const g = v.getUint16(o);
            if (g === b) return xa1 >= 0 ? v.getInt16(o + 2 + xa1) : 0;
            if (g < b) lo = mid + 1;
            else hi = mid - 1;
          }
          return NaN;
        }
        const c1 = classOf(v, s + v.getUint16(s + 8), a);
        const c2 = classOf(v, s + v.getUint16(s + 10), b);
        const n2 = v.getUint16(s + 14);
        const o = s + 16 + (c1 * n2 + c2) * (size1 + size2);
        return xa1 >= 0 ? v.getInt16(o + xa1) : 0;
      };
      return memo((a, b) => {
        let total = 0;
        for (const i of lookups) {
          for (const [s, t] of lay.subtables(i)) {
            if (t !== 2) continue;
            const r = pair(s, a, b);
            if (!Number.isNaN(r)) {
              total += r;
              break; // the first subtable that has the pair is the one that applies in this lookup
            }
          }
        }
        return total;
      });
    }
  }
  const kern = tables.get("kern");
  if (kern && v.getUint16(kern.o) === 0) {
    const nTables = v.getUint16(kern.o + 2);
    let p = kern.o + 4;
    const pairs = new Map<number, number>();
    for (let t = 0; t < nTables; t++) {
      const len = v.getUint16(p + 2);
      const cov = v.getUint16(p + 4);
      if ((cov >> 8) === 0 && (cov & 1) === 1) {
        const n = v.getUint16(p + 6);
        for (let i = 0; i < n; i++) pairs.set(v.getUint16(p + 14 + 6 * i) * 65536 + v.getUint16(p + 16 + 6 * i), v.getInt16(p + 18 + 6 * i));
      }
      p += len;
    }
    if (pairs.size) return (a, b) => pairs.get(a * 65536 + b) ?? 0;
  }
  return () => 0;
}

// ---- substitution ----------------------------------------------------------------------------------------------------------------

export interface Shaped {
  readonly gid: number;
  /** How many of the glyphs it was given this one stands for (a ligature: several). */
  readonly n: number;
}

export interface Substitution {
  /** The feature tags of the font's `GSUB`. */
  features(): readonly string[];
  /**
   * The glyphs after the lookups of the features in `tags`, each with how many glyphs it covers. `forms` (Arabic) names the form of each
   * glyph (isolated, initial, medial, final): the lookups of that form's feature are applied to that glyph only, before the others.
   */
  shape(gids: readonly number[], tags: readonly string[], forms?: ReadonlyArray<string | null>): Shaped[];
}

export function readSubstitution(v: DataView, tables: Tables): Substitution {
  const gsub = tables.get("GSUB");
  if (!gsub) return { features: () => [], shape: (gids) => gids.map((gid) => ({ gid, n: 1 })) };
  const lay = layoutOf(v, gsub.o);
  /** Apply one lookup to the run: returns the new run. */
  const apply = (run: Shaped[], lookup: number, allow?: (position: number) => boolean): Shaped[] => {
    const subs = lay.subtables(lookup);
    const out: Shaped[] = [];
    for (let i = 0; i < run.length; ) {
      const g = run[i]!;
      let done = false;
      for (const [s, type] of allow && !allow(i) ? [] : subs) {
        if (type === 1) {
          const cov = coverage(v, s + v.getUint16(s + 2), g.gid);
          if (cov < 0) continue;
          const gid = v.getUint16(s) === 1 ? (g.gid + v.getInt16(s + 4)) & 0xffff : v.getUint16(s + 6 + 2 * cov);
          out.push({ gid, n: g.n });
          i++;
          done = true;
        } else if (type === 2 || type === 3) {
          const cov = coverage(v, s + v.getUint16(s + 2), g.gid);
          if (cov < 0) continue;
          const seq = s + v.getUint16(s + 6 + 2 * cov);
          const count = v.getUint16(seq);
          if (type === 3) {
            if (!count) continue;
            out.push({ gid: v.getUint16(seq + 2), n: g.n }); // the first alternate
          } else {
            if (!count) continue;
            for (let k = 0; k < count; k++) out.push({ gid: v.getUint16(seq + 2 + 2 * k), n: k === 0 ? g.n : 0 });
          }
          i++;
          done = true;
        } else if (type === 4) {
          const cov = coverage(v, s + v.getUint16(s + 2), g.gid);
          if (cov < 0) continue;
          const set = s + v.getUint16(s + 6 + 2 * cov);
          const nLig = v.getUint16(set);
          for (let k = 0; k < nLig && !done; k++) {
            const lig = set + v.getUint16(set + 2 + 2 * k);
            const comps = v.getUint16(lig + 2);
            if (i + comps > run.length) continue;
            let ok = true;
            for (let c = 1; c < comps && ok; c++) ok = run[i + c]!.gid === v.getUint16(lig + 4 + 2 * (c - 1));
            if (!ok) continue;
            let n = 0;
            for (let c = 0; c < comps; c++) n += run[i + c]!.n;
            out.push({ gid: v.getUint16(lig), n });
            i += comps;
            done = true;
          }
        }
        if (done) break;
      }
      if (!done) {
        out.push(g);
        i++;
      }
    }
    return out;
  };
  return {
    features: () => lay.tags(),
    shape(gids, tags, forms) {
      let run: Shaped[] = gids.map((gid) => ({ gid, n: 1 }));
      if (forms) {
        // each form's lookups touch only the letters in that form (the positions are those of the letters given, none has merged yet)
        for (const f of ["isol", "fina", "medi", "init"]) for (const l of lay.lookups(f)) run = apply(run, l, (pos) => forms[pos] === f);
      }
      const lookups = [...new Set(tags.flatMap((t) => lay.lookups(t)))].sort((a, b) => a - b);
      for (const l of lookups) run = apply(run, l);
      return run;
    },
  };
}
