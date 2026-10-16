/**
 * Tags follow Obsidian's rules (ADR 0084): letters (of any script), numbers, `_`, `-` and `/` (a nested tag: `project/design`); no spaces
 * or other punctuation; at least one character that is not a digit (`#1984` is not a tag, `#y1984` is); upper and lower case are the same
 * tag (the first spelling is kept). Whatever is typed or already stored is formatted to fit, never refused.
 */
export const MAX_TAG_LENGTH = 64;

/** One tag in its proper form: "" when nothing usable is left. A leading `#` is dropped; spaces become `-`; other characters go. */
export function formatTag(raw: string): string {
  let t = raw.normalize("NFC").trim().replace(/^#+/, "");
  t = t.replace(/\s+/g, "-"); // a tag cannot hold a space
  t = t.replace(/[^\p{L}\p{N}_\-/]/gu, ""); // nor punctuation, emoji or symbols
  t = t.replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, ""); // a nested path has no empty part
  t = t.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  if (/^\p{N}+$/u.test(t)) t = `tag-${t}`; // all digits is not a tag
  return t.slice(0, MAX_TAG_LENGTH).replace(/\/+$/, "");
}

/** True when the text is already a proper tag (no leading `#`). */
export const isTag = (t: string): boolean => t !== "" && formatTag(t) === t && !t.startsWith("#");

/** Format a list: drop what is left empty and repeats that differ only in case (the first spelling wins). */
export function formatTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = formatTag(raw);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/** `#project` is `project` and everything nested under it (`project/design`). `word` is lower case. */
export const tagIsOrUnder = (tag: string, word: string): boolean => {
  const t = tag.toLowerCase();
  return t === word || t.startsWith(`${word}/`);
};

/** After renaming the tag `from` (lower case) to `to`: the new form of `tag`, or undefined when `tag` is not `from` or nested under it. */
export function renamedTag(tag: string, from: string, to: string): string | undefined {
  const t = tag.toLowerCase();
  if (t === from) return to;
  if (t.startsWith(`${from}/`)) return `${to}${tag.slice(from.length)}`;
  return undefined;
}

/** What to tell the person when what they typed was formatted to fit; null when every tag was fine as typed. */
export function tagFormatNote(typed: readonly string[]): string | null {
  const changed = typed.map((t) => t.trim().replace(/^#+/, "")).filter((t) => t && formatTag(t) !== t);
  if (!changed.length) return null;
  const first = changed[0]!;
  return `Tags use letters, numbers, _ - and / (nested), no spaces: “${first}” was saved as #${formatTag(first) || "?"}${changed.length > 1 ? ` (and ${changed.length - 1} more formatted)` : ""}.`;
}
