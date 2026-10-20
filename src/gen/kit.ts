import type { Setting, Values } from "./types";

/** Short builders for the settings of a generator. */
export const R = (k: string, label: string, min: number, max: number, def: number, step = 1): Setting => ({ k, label, t: "range", min, max, step, def });
export const C = (k: string, label: string, def: string, hide?: true): Setting => ({ k, label, t: "colour", def, ...(hide ? { hide } : {}) });
export const T = (k: string, label: string, def: boolean): Setting => ({ k, label, t: "toggle", def });
export const Ch = (k: string, label: string, opts: readonly (readonly [string, string])[], def: string): Setting => ({ k, label, t: "choice", opts, def });

/** Read the settings inside `run`. */
export const reader = (v: Values) => ({
  n: (k: string): number => v[k] as number,
  s: (k: string): string => v[k] as string,
  b: (k: string): boolean => v[k] as boolean,
  /** A colour that may be hidden: null when it is. */
  c: (k: string): string | null => ((v[k] as string) || null),
});

export const STYLE = Ch("style", "Style", [["solid", "Solid"], ["outline", "Outline"]], "solid");
