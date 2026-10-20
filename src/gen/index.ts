import { BLOBS } from "./blobs";
import { EXTRA } from "./extra";
import { FIELDS } from "./fields";
import { LINES } from "./lines";
import { SOFT } from "./soft";
import { TILES } from "./tiles";
import { WAVES } from "./waves";
import { C } from "./kit";
import { makeRng, palette } from "./rng";
import type { Rng } from "./rng";
import { rect } from "./geom";
import type { GenShape, Generator, Section, Setting, Values } from "./types";

export type { GenShape, Generator, Section, Setting, Values } from "./types";
export type { Gradient, GradientStop, Paint, SubPath } from "./core";
export { makeRng, makeNoise } from "./rng";
export type { Rng } from "./rng";
export { pathData, toSvg } from "./svg";
export type { SvgOptions } from "./svg";

/** Every pattern generator, in the order the picker shows them. */
export const GENERATORS: readonly Generator[] = [...WAVES, ...BLOBS, ...SOFT, ...LINES, ...TILES, ...FIELDS, ...EXTRA];

/** The most shapes one pattern is made of (one path may hold many sub-paths). */
export const MAX_SHAPES = 600;

const BG = C("bg", "Background", "#0b1f33", true);

/** The settings of a generator in sections, the background colour in front of its colours. */
export function sectionsOf(g: Generator): readonly Section[] {
  return g.sections.map((s) => (s.title === "Colour" ? { ...s, items: [BG, ...s.items] } : s));
}

export const settingsOf = (g: Generator): Setting[] => sectionsOf(g).flatMap((s) => [...s.items]);

export const generatorById = (id: string): Generator | undefined => GENERATORS.find((g) => g.id === id);

export function defaultValues(g: Generator): Values {
  return Object.fromEntries(settingsOf(g).map((s) => [s.k, s.def]));
}

/** Each value made valid for its setting (a missing or wrong one becomes the default; a number is held to its range). */
export function cleanValues(g: Generator, v: Values): Values {
  const out: Values = {};
  for (const s of settingsOf(g)) {
    const x = v[s.k];
    out[s.k] =
      s.t === "range" ? (typeof x === "number" && Number.isFinite(x) ? Math.min(s.max, Math.max(s.min, x)) : s.def)
      : s.t === "toggle" ? (typeof x === "boolean" ? x : s.def)
      : s.t === "choice" ? (typeof x === "string" && s.opts.some((o) => o[0] === x) ? x : s.def)
      : typeof x === "string" && (/^#[0-9a-f]{6}$/i.test(x) || (s.hide && x === "")) ? x : s.def;
  }
  return out;
}

/** Random values for every setting, inside the middle of each one's range (the ends make poor pictures); the colours go together. */
export function randomValues(g: Generator, rng: Rng): Values {
  const all = settingsOf(g), cols = palette(rng, all.filter((s) => s.t === "colour").length);
  let ci = 0;
  const out: Values = {};
  for (const s of all) {
    out[s.k] =
      s.t === "range" ? Math.min(s.max, Math.max(s.min, s.min + Math.round(((0.15 + 0.7 * ((rng() + rng()) / 2)) * (s.max - s.min)) / s.step) * s.step))
      : s.t === "toggle" ? rng.chance(0.5)
      : s.t === "choice" ? rng.pick(s.opts)[0]
      : cols[ci++]!;
  }
  return out;
}

/** The shapes of a pattern `w` wide and `h` high: the background first, then what the generator makes. The same values and seed always give the same shapes. */
export function generate(g: Generator, values: Values, seed: number, w: number, h: number): GenShape[] {
  const v = cleanValues(g, values);
  const shapes = g.run(v, makeRng(seed), w, h);
  const bg = v["bg"] as string;
  const all = bg ? [{ sub: [rect(0, 0, w, h)], fill: bg, stroke: null, width: 1, name: "Background" }, ...shapes] : shapes;
  return all.filter((s) => s.sub.length > 0).slice(0, MAX_SHAPES);
}
