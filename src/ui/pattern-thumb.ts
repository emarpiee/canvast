import { defaultValues, generate, toSvg } from "../gen";
import type { Generator } from "../gen";

/** A small picture of what a generator makes with its own defaults (an inline SVG), for the picker of the Pattern panel. */
export const THUMB_W = 150;
export const THUMB_H = 100;

export const thumbSvg = (g: Generator): string => toSvg(generate(g, defaultValues(g), 7, THUMB_W, THUMB_H), THUMB_W, THUMB_H, { idPrefix: `pg-${g.id}-`, fit: "xMidYMid slice" });
