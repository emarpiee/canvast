// What a picture's link says besides its file: `![[cat.png|words|200]]`, `![words|200](cat.png)`. The size is the part that is only a number
// (`200`, `200x100`), as notes apps write it; the rest is its alt text.
export interface PictureAlt {
  alt: string;
  width: number | null;
  height: number | null;
}

const SIZE = /^\s*(\d+)(?:x(\d+))?\s*$/;

/** Read the part after a picture's target (an embed's text after `|`, or an image's text in `[ ]`). */
export function readAlt(raw: string): PictureAlt {
  const parts = raw.replace(/\\\|/g, "|").split("|"); // (in a table the bar is written \|)
  const at = parts.map((p) => SIZE.test(p)).lastIndexOf(true);
  const size = at >= 0 ? SIZE.exec(parts[at]!) : null;
  return { alt: parts.filter((_p, i) => i !== at).join("|").trim(), width: size ? Number(size[1]) : null, height: size?.[2] ? Number(size[2]) : null };
}

/** The same, written back (empty when there is nothing to say). */
export function writeAlt(a: PictureAlt): string {
  const size = a.width ? `${a.width}${a.height ? `x${a.height}` : ""}` : "";
  return [a.alt, size].filter(Boolean).join("|");
}

/** A picture's whole link with its alt part changed (`![[t|…]]` or `![…](url)`); null when `src` is no picture's link. */
export function withAlt(src: string, change: (a: PictureAlt) => PictureAlt): string | null {
  const embed = /^!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(src);
  if (embed) {
    const alt = writeAlt(change(readAlt(embed[2] ?? "")));
    return `![[${embed[1]}${alt ? `|${alt}` : ""}]]`;
  }
  const image = /^!\[([^\]]*)\](\([\s\S]*\))$/.exec(src);
  return image ? `![${writeAlt(change(readAlt(image[1]!)))}]${image[2]}` : null;
}
