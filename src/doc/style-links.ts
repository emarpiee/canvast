import type { CanvasObject } from "./model";

/** Which part of an object a saved style is on: its fill (a text's letters, a pen stroke's colour), its outline, or the adjustments of a picture. */
export type StylePart = "fill" | "stroke" | "adjust";

/**
 * `o` with the links to saved styles of some parts set (a style id) or taken away (null); the others are kept. No link left: no field.
 * A link says "this part follows that style": the paint itself is stored on the object as ever, so a canvas without the style still draws.
 */
export function withStyleLinks<T extends CanvasObject>(o: T, parts: Partial<Record<StylePart, string | null>>): T {
  const next: Record<string, string> = { ...(o.styles ?? {}) };
  for (const part of ["fill", "stroke", "adjust"] as const) {
    const v = parts[part];
    if (v === undefined) continue;
    if (v === null) delete next[part];
    else next[part] = v;
  }
  if (JSON.stringify(next) === JSON.stringify(o.styles ?? {})) return o;
  const { styles: _s, ...rest } = o;
  return (Object.keys(next).length ? { ...rest, styles: next } : rest) as T;
}
