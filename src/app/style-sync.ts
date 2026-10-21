import type { DocumentStore } from "../doc/document-store";
import type { CanvasObject, ImageObject } from "../doc/model";
import { cleanAdjust } from "../doc/adjust";
import type { Adjust } from "../doc/adjust";
import type { Paint } from "../doc/paint";
import { withStyleLinks } from "../doc/style-links";
import type { StyleItem } from "../assets/styles";
import { paintedWithRaw } from "./actions";

type Painted = Extract<CanvasObject, { kind: "path" | "text" | "stroke" | "image" }>;

/** The paint a saved colour or gradient gives, or undefined: the style is not one that paints. */
const paintOf = (s: StyleItem | undefined): Paint | undefined => (s && (s.kind === "colour" || s.kind === "gradient") ? (s.data as Paint) : undefined);

/** What a paint edit can change on an object, as text (the position holds exact numbers that JSON cannot write). */
const looks = (o: Painted): string => JSON.stringify([o.adjust, o.styles, "fill" in o ? o.fill : 0, "stroke" in o ? o.stroke : 0, "color" in o ? o.color : 0, "gradient" in o ? o.gradient : 0, "outline" in o ? o.outline : 0]);

/**
 * The objects whose paint no longer matches the saved style they follow (ADR 0157), with the paint of the style put on them. A style that
 * is gone (deleted) leaves its objects as they are and unlinks them.
 */
export function linkedUpdates(doc: DocumentStore, styles: readonly StyleItem[]): CanvasObject[] {
  const byId = new Map(styles.map((s) => [s.id, s]));
  const out: CanvasObject[] = [];
  for (const o of doc.all()) {
    if (!o.styles || (o.kind !== "path" && o.kind !== "text" && o.kind !== "stroke" && o.kind !== "image")) continue;
    let n: Painted = o;
    if (o.styles["adjust"] !== undefined) {
      // an object that follows a saved adjustment
      const style = byId.get(o.styles["adjust"]);
      const clean = style?.kind === "adjustment" ? cleanAdjust(style.data as Adjust) : undefined;
      if (!style || style.kind !== "adjustment") n = withStyleLinks(n, { adjust: null });
      else if (JSON.stringify(o.adjust ?? null) !== JSON.stringify(clean ?? null)) {
        const { adjust: _a, ...rest } = n;
        n = (clean ? { ...rest, adjust: clean } : rest) as Painted;
      }
    }
    for (const part of ["fill", "stroke"] as const) {
      const id = o.styles[part];
      if (id === undefined) continue;
      const paint = paintOf(byId.get(id));
      if (paint === undefined) n = withStyleLinks(n, { [part]: null });
      else n = paintedWithRaw(n, { [part]: paint }) as Painted;
    }
    if (looks(n) !== looks(o)) out.push(n);
  }
  return out;
}
