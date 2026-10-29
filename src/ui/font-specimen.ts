import { esc } from "./format";

/**
 * A font file shown in its own letters: the standard sample sentence, the alphabet and the digits, in the font itself. One sample for
 * the details panel and the viewer (the details show it small, the viewer at several sizes).
 */
const PANGRAM = "The quick brown fox jumps over the lazy dog";
const LETTERS = ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz", "0123456789 .,;:!?&@()"];
/** Fonts kept loaded at once (the last ones shown); an older one is let go. */
const KEEP = 6;
const loaded = new Map<string, Promise<string | null>>();

/** The font of a file loaded under a family name of its own, or null when the browser cannot read it. */
export function loadFontFile(hash: string, file: () => Promise<Blob | undefined>): Promise<string | null> {
  const had = loaded.get(hash);
  if (had) {
    loaded.delete(hash);
    loaded.set(hash, had); // (the most recent one last)
    return had;
  }
  const family = `canvast-font-${hash.slice(0, 16)}`;
  const face = file().then(async (blob) => {
    const f = new FontFace(family, await blob!.arrayBuffer());
    await f.load();
    document.fonts.add(f);
    return f;
  });
  const p = face.then(() => family, () => null);
  loaded.set(hash, p);
  void p.then((fam) => fam || loaded.delete(hash)); // (a failed read is tried again next time)
  if (loaded.size > KEEP) {
    const [old, oldP] = loaded.entries().next().value!;
    loaded.delete(old);
    void oldP.then((fam) => {
      if (fam) for (const f of document.fonts) if (f.family === fam || f.family === `"${fam}"`) document.fonts.delete(f);
    });
  }
  return p;
}

/** The sample's markup; `large` is the viewer's (the sentence at several sizes). Filled in with `showFont`. */
export const fontSampleHtml = (name: string, large: boolean): string =>
  `<div class="font-sample${large ? " is-large" : ""}" data-testid="font-sample" aria-label="Sample of ${esc(name)}">` +
  `<span class="font-sample-aa">Aa</span>` +
  (large ? ["is-xl", "is-lg", "is-md", "is-sm"].map((s) => `<p class="font-sample-line ${s}">${PANGRAM}</p>`).join("") : `<p class="font-sample-line">${PANGRAM}</p>`) +
  LETTERS.map((l) => `<p class="font-sample-chars">${esc(l)}</p>`).join("") +
  `</div>`;

/** Load the font (its file is read only when it is not loaded yet) and draw the sample in it; a font the browser cannot read says so. */
export async function showFont(sample: HTMLElement, hash: string, file: () => Promise<Blob | undefined>): Promise<void> {
  const family = await loadFontFile(hash, file);
  if (!sample.isConnected) return;
  if (!family) {
    sample.textContent = "This font cannot be read here.";
    sample.classList.add("is-unreadable");
    return;
  }
  sample.style.fontFamily = `"${family}"`;
  sample.classList.add("is-ready");
}
