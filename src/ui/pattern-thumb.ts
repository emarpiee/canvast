import { defaultValues, generate, generatorById, toSvg } from "../gen";
import type { Generator, Values } from "../gen";

/** A small picture of what a generator makes with its own defaults (an inline SVG), for the picker of the Pattern panel. */
export const THUMB_W = 150;
export const THUMB_H = 100;

/** A small picture of a pattern as it was saved (its settings and seed), for a card of the Styles panel; "" when it cannot be made. */
export const styleThumbSvg = (id: string, v: Values, seed: number): string => {
  const g = generatorById(id);
  if (!g) return "";
  try {
    return toSvg(generate(g, v, seed, THUMB_W, THUMB_H), THUMB_W, THUMB_H, { idPrefix: `ps-${id}-${seed}-`, fit: "xMidYMid slice" });
  } catch {
    return "";
  }
};

export const thumbSvg = (g: Generator): string => toSvg(generate(g, defaultValues(g), 7, THUMB_W, THUMB_H), THUMB_W, THUMB_H, { idPrefix: `pg-${g.id}-`, fit: "xMidYMid slice" });
