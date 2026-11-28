// What a picture's link says besides its file: `![[cat.png|words|200]]`, `![words|200](cat.png)`. The size is the part that is only a number
// (`200`, `200x100`), as notes apps write it; the rest is its alt text, where the words `rotate-90`, `rotate-180`, `rotate-270`, `flip-x` and
// `flip-y` turn or flip it as it is drawn (the file itself is never changed; another notes app shows them as its alt text).
export interface PictureAlt {
  alt: string;
  width: number | null;
  height: number | null;
  rotate: 0 | 90 | 180 | 270;
  flipX: boolean;
  flipY: boolean;
}

const SIZE = /^\s*(\d+)(?:x(\d+))?\s*$/;
const LOOK = /(?:^|\s)(rotate-(?:90|180|270)|flip-x|flip-y)(?=\s|$)/g;

/** Read the part after a picture's target (an embed's text after `|`, or an image's text in `[ ]`). */
export function readAlt(raw: string): PictureAlt {
  const parts = raw.split("|");
  const at = parts.map((p) => SIZE.test(p)).lastIndexOf(true);
  const size = at >= 0 ? SIZE.exec(parts[at]!) : null;
  const words = parts.filter((_p, i) => i !== at).join("|");
  const look = [...words.matchAll(LOOK)].map((m) => m[1]!);
  const rotate = look.find((l) => l.startsWith("rotate-"));
  return {
    alt: words.replace(LOOK, " ").replace(/\s+/g, " ").trim(),
    width: size ? Number(size[1]) : null,
    height: size?.[2] ? Number(size[2]) : null,
    rotate: (rotate ? Number(rotate.slice(7)) : 0) as PictureAlt["rotate"],
    flipX: look.includes("flip-x"),
    flipY: look.includes("flip-y"),
  };
}

/** The same, written back (empty when there is nothing to say). */
export function writeAlt(a: PictureAlt): string {
  const words = [a.alt, a.rotate ? `rotate-${a.rotate}` : "", a.flipX ? "flip-x" : "", a.flipY ? "flip-y" : ""].filter(Boolean).join(" ");
  const size = a.width ? `${a.width}${a.height ? `x${a.height}` : ""}` : "";
  return [words, size].filter(Boolean).join("|");
}

/** The CSS transform that draws its turn and flips ("" for none). */
export function lookTransform(a: PictureAlt): string {
  return [a.rotate ? `rotate(${a.rotate}deg)` : "", a.flipX ? "scaleX(-1)" : "", a.flipY ? "scaleY(-1)" : ""].filter(Boolean).join(" ");
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
