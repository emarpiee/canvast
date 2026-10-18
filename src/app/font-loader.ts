import { FontError, parseFont } from "../text/font";
import { sfntOf } from "../text/font-file";
import { registerFont } from "../text/fonts";

export type FontState = "loading" | "ready" | "failed";

/**
 * Reads the fonts texts are set in from the library, once each (ADR 0127): the original's bytes become a font we can lay out and draw
 * outlines from, and a `FontFace` the page and a canvas can draw with. A font that cannot be read is remembered as failed, with the reason.
 */
export class FontLoader {
  private readonly states = new Map<string, FontState>();
  private readonly reasons = new Map<string, string>();
  private readonly running = new Map<string, Promise<FontState>>();

  constructor(private readonly bytesOf: (hash: string) => Promise<Blob | undefined>) {}

  state(hash: string): FontState | undefined {
    return this.states.get(hash);
  }

  reason(hash: string): string {
    return this.reasons.get(hash) ?? "";
  }

  /** Load a font once; resolves when it is settled (ready or failed). */
  ensure(hash: string): Promise<FontState> {
    let p = this.running.get(hash);
    if (!p) {
      this.states.set(hash, "loading");
      p = this.load(hash).then((s) => {
        this.states.set(hash, s);
        return s;
      });
      this.running.set(hash, p);
    }
    return p;
  }

  private async load(hash: string): Promise<FontState> {
    try {
      const blob = await this.bytesOf(hash);
      if (!blob) throw new FontError("The font file is not in the library.");
      const sfnt = await sfntOf(new Uint8Array(await blob.arrayBuffer()));
      const font = parseFont(sfnt);
      // One CSS family for every file of a family, each with its weight and slant, so the page picks the bold or italic file by itself.
      const names = font.names;
      const family = `canvast-fam-${names.family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || hash.slice(0, 8)}`;
      const wght = font.axes.find((a) => a.tag === "wght");
      let face = false;
      try {
        const f = new FontFace(family, sfnt as BufferSource, { weight: wght ? `${wght.min} ${wght.max}` : String(names.weight), style: names.italic ? "italic" : "normal" });
        document.fonts.add(f);
        await f.load();
        face = true;
      } catch {
        // the browser refused the file: letters are drawn from the outlines we read instead
      }
      registerFont(hash, font, family, face);
      return "ready";
    } catch (e) {
      this.reasons.set(hash, e instanceof Error ? e.message : "This font cannot be read.");
      return "failed";
    }
  }
}

/** Whether these bytes are a font we can use; the reason when not (null: fine). */
export async function whyNotFont(bytes: Uint8Array): Promise<string | null> {
  try {
    parseFont(await sfntOf(bytes));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "This font cannot be read.";
  }
}
