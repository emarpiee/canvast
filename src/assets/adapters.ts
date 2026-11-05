import { CARD_SCALE, noteCardSize, notePicture } from "../notes/note-preview";
import { noteKindOf, tooBigForNote } from "../notes/note-file";
import { isFontFile, isModelFile, isPdfFile } from "./file-kind";
import { modelPicture } from "./model-engine";
import { pdfPicture } from "./pdf-engine";
import { FILE_CARD_H, FILE_CARD_W, cardContext, makeFileCard, fillTextCentred, groundFill, inkOnGround } from "./card";
import type { ViewGround } from "../storage/workspace-repo";

/** What a kind of file's picture is drawn for. */
export interface PictureOptions {
  /** The card's pixel size: a stored item's, or a copy's (else its own, by what the file is). */
  size?: { w: number; h: number } | undefined;
  /** Without a size, its longer side (a thumbnail). */
  edge?: number | undefined;
  /** What this object shows of the file (doc/model.ts `preview`): a PDF's page, a 3D view. */
  preview?: string | undefined;
  hash?: string | undefined;
  /** A note's page width (a smaller copy keeps the full card's). */
  layoutW?: number | undefined;
}

/**
 * The kinds of file whose card is drawn from their bytes. A new kind of file is one row here (and one in ui/file-views.ts, to open it). A kind that
 * answers null leaves the file's plain card.
 */
const PICTURE_KINDS: ReadonlyArray<{ claims(name: string): boolean; picture(name: string, chip: string, read: () => Promise<Uint8Array>, o: PictureOptions): Promise<ImageBitmap | null> }> = [
  {
    // A note: its page, as big as the note when it is a new card, else laid out at the card's own size.
    claims: (name) => !!noteKindOf(name),
    picture: async (name, _chip, read, o) => {
      const bytes = await read();
      if (tooBigForNote(name, bytes.length)) return null;
      const text = new TextDecoder().decode(bytes);
      const page = await (async () => { const s = o.size ?? (await noteCardSize(name, text, o.hash)); return notePicture(name, text, s.w, s.h, o.hash, o.layoutW ?? s.w / CARD_SCALE); })().catch(() => null);
      return page ? createImageBitmap(page) : null;
    },
  },
  { claims: (name) => isFontFile({ type: "", name }), picture: async (_name, chip, read) => fontCard(chip, await read()).catch(() => null) },
  { claims: (name) => isPdfFile({ name }), picture: (_name, _chip, read, o) => pdfPicture(read, { hash: o.hash, page: Number(o.preview) || 1, size: o.size, edge: o.edge }) },
  { claims: isModelFile, picture: (name, _chip, read, o) => modelPicture(read, name, o) },
];

/** The card of a file, with what can be drawn from its bytes. Never fails: the plain card is the fallback. */
export async function makeFileCardFrom(name: string, chip: string, /** Read only by what needs it: a kind may still hold the file open. */ read: () => Promise<Uint8Array>, o: PictureOptions = {}): Promise<ImageBitmap> {
  try {
    const drawn = await PICTURE_KINDS.find((k) => k.claims(name))?.picture(name, chip, read, o);
    if (drawn) return drawn;
  } catch {
    // (the plain card)
  }
  return makeFileCard(chip);
}

/** How a font's card looks: the sample sentence and the ground chosen in the viewer. */
let fontLook: { sample: string; ground: ViewGround } = { sample: "The quick brown fox jumps over the lazy dog", ground: "checker" };
export const setFontCardLook = (look: typeof fontLook): void => void (fontLook = look);

/** A sentence in lines that fit a width, at the largest size from `start` that takes at most `most` lines. */
function fitLines(x: CanvasRenderingContext2D, text: string, family: string, start: number, width: number, most: number): { lines: string[]; size: number } {
  for (let size = start; ; size *= 0.85) {
    x.font = `${size}px "${family}"`;
    const lines: string[] = [];
    for (const word of text.split(" ")) {
      const with_ = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
      if (lines.length && x.measureText(with_).width <= width) lines[lines.length - 1] = with_;
      else lines.push(word);
    }
    if (size < 9 || (lines.length <= most && lines.every((l) => x.measureText(l).width <= width))) return { lines, size };
  }
}

/** A font's card: "Aa" in the font itself, large, its sample sentence and its type under it (null when the browser cannot read the font). */
async function fontCard(chip: string, bytes: Uint8Array): Promise<ImageBitmap | null> {
  const face = new FontFace(`canvast-card-${Math.random().toString(36).slice(2)}`, bytes.slice().buffer);
  await face.load();
  document.fonts.add(face);
  try {
    const c = document.createElement("canvas");
    c.width = FILE_CARD_W;
    c.height = FILE_CARD_H;
    const x = cardContext(c);
    const fg = inkOnGround(fontLook.ground);
    x.fillStyle = groundFill(x, fontLook.ground, 16);
    x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = fg;
    x.globalAlpha = 0.1;
    x.lineWidth = 2;
    x.strokeRect(1, 1, c.width - 2, c.height - 2);
    x.globalAlpha = 1;
    x.textAlign = "center";
    x.textBaseline = "middle";
    // As large as fits, measured once at a reference size (the same way as the library's thumbnail).
    x.font = `100px "${face.family}"`;
    const w = x.measureText("Aa").width || 100;
    const size = Math.min(c.height * 0.34, (100 * c.width * 0.6) / w);
    x.font = `${size}px "${face.family}"`;
    x.fillStyle = fg;
    fillTextCentred(x, "Aa", c.width / 2, c.height * 0.27);
    const { lines, size: small } = fitLines(x, fontLook.sample, face.family, c.height * 0.085, c.width * 0.86, 3);
    x.font = `${small}px "${face.family}"`;
    const step = small * 1.3;
    lines.forEach((line, i) => fillTextCentred(x, line, c.width / 2, c.height * 0.66 + (i - (lines.length - 1) / 2) * step));
    x.font = "14px system-ui, sans-serif";
    x.globalAlpha = 0.75;
    x.fillText(chip, c.width / 2, c.height - 22);
    x.globalAlpha = 1;
    return await createImageBitmap(c);
  } finally {
    document.fonts.delete(face);
  }
}
