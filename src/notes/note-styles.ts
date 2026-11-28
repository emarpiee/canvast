// Note styles (Settings > Notes > Note styles) as the notes editor's `--me-*` properties: one text the app sets on its notes editors and
// their drawn pages, and that a note's card draws with, so the three look alike. A colour left empty is the theme's (no property).
import type { SettingKey } from "../settings/settings";

type Get = (key: SettingKey) => unknown;

/** Rainbow headings: red, orange, yellow, green, blue, violet (H1 to H6). */
export const RAINBOW = ["#e5484d", "#f76b15", "#e2a336", "#30a46c", "#3e63dd", "#8e4ec6"] as const;

/**
 * The headings' sizes from H1's (in em of the text): H1 is always larger than the text; H2 to H6 come down from it in even steps of one
 * ratio, so H6 is the text's size (each a step smaller than the one above: a hierarchy that holds at any H1), or all are H1's size.
 */
export function headingSizes(h1: number, mode: "steps" | "same"): number[] {
  const top = Math.max(1.05, h1);
  return [1, 2, 3, 4, 5, 6].map((n) => (mode === "same" ? top : Math.pow(top, (6 - n) / 5)));
}

/** The properties for the note styles chosen now. */
export function noteStyleVars(get: Get): string {
  const out: string[] = [];
  const colour = (name: string, key: SettingKey): void => {
    const v = get(key);
    if (typeof v === "string" && v) out.push(`--me-${name}: ${v};`);
  };
  colour("strong-fg", "notes.style.boldColour");
  colour("em-fg", "notes.style.italicColour");
  colour("strong-em-fg", "notes.style.boldItalicColour");
  colour("wikilink-fg", "notes.style.internalLinkColour");
  colour("link-fg", "notes.style.externalLinkColour");
  colour("th-bg", "notes.style.tableHeaderColour");
  colour("td-bg", "notes.style.tableCellColour");
  colour("tr-bg", "notes.style.tableRowColour");
  colour("col-bg", "notes.style.tableColumnColour");
  out.push(`--me-strong-weight: ${Number(get("notes.style.boldWeight")) || 700};`);
  out.push(`--me-list-gap: ${Number(get("notes.style.listGap") ?? 0.3)}em;`);
  const rainbow = get("notes.style.headingColours") === "rainbow";
  for (let i = 1; i <= 6; i++) {
    if (rainbow) out.push(`--me-h${i}-fg: ${RAINBOW[i - 1]};`);
    else colour(`h${i}-fg`, `notes.style.h${i}Colour` as SettingKey);
  }
  headingSizes(Number(get("notes.style.h1Size")) || 1.9, get("notes.style.headingSizes") === "same" ? "same" : "steps").forEach((em, i) => out.push(`--me-h${i + 1}: ${em.toFixed(3)}em;`));
  return out.join(" ");
}
