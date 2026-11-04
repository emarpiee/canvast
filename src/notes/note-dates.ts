// A note's automatic properties: its title, when it was created and when it was last saved, under names and in a format the settings choose. Pure, but for the settings.
import { withFrontmatter, splitFrontmatter, richMeta, withRichMeta, NO_META, type Prop } from "./frontmatter";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const two = (n: number): string => String(n).padStart(2, "0");

/** A moment in a format's words, as Obsidian's date formats write them: `YYYY-MM-DDTHH:mm`. What is in `[brackets]`, and any other letter, stays as it is. */
export function formatNoteDate(d: Date, format: string): string {
  const h12 = d.getHours() % 12 || 12;
  const words: Record<string, string> = {
    YYYY: String(d.getFullYear()), YY: two(d.getFullYear() % 100),
    MMMM: MONTHS[d.getMonth()]!, MMM: MONTHS[d.getMonth()]!.slice(0, 3), MM: two(d.getMonth() + 1), M: String(d.getMonth() + 1),
    DD: two(d.getDate()), D: String(d.getDate()), dddd: DAYS[d.getDay()]!, ddd: DAYS[d.getDay()]!.slice(0, 3),
    HH: two(d.getHours()), H: String(d.getHours()), hh: two(h12), h: String(h12), mm: two(d.getMinutes()), ss: two(d.getSeconds()),
    A: d.getHours() < 12 ? "AM" : "PM", a: d.getHours() < 12 ? "am" : "pm",
  };
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a/g, (m, plain?: string) => plain ?? words[m]!);
}

export interface AutoDates {
  on: boolean;
  created: string;
  modified: string;
  format: string;
  title: string;
  /** Where a title comes from: the file's name, or the first heading in the note (the file's name when it has none). */
  titleFrom: "name" | "h1";
}
export const DATE_FORMAT = "YYYY-MM-DDTHH:mm";
/** The settings these come from. */
export const AUTO_NOTE_SETTINGS: readonly string[] = ["notes.autoDates", "notes.titleKey", "notes.titleFrom", "notes.createdKey", "notes.modifiedKey", "notes.dateFormat"];
let auto: AutoDates = { on: false, created: "created", modified: "modified", format: DATE_FORMAT, title: "title", titleFrom: "name" };
/** Set by the app from the settings (an empty name or format: the usual one). */
export const setAutoDates = (a: AutoDates): void => void (auto = { on: a.on, created: a.created.trim() || "created", modified: a.modified.trim() || "modified", format: a.format.trim() || DATE_FORMAT, title: a.title.trim() || "title", titleFrom: a.titleFrom });
export const autoDates = (): Readonly<AutoDates> => auto;

const noted = (kind: string | null): boolean => (kind === "md" || kind === "rich") && auto.on;
const same = (a: string, b: string): boolean => a.toLowerCase() === b.trim().toLowerCase();
/** Whether this name is one of the two times. */
export const isAutoDate = (kind: string | null, key: string): boolean => noted(kind) && (same(auto.created, key) || same(auto.modified, key));
/** Whether this name is one of the automatic ones: it stays on the note. */
export const isAutoKey = (kind: string | null, key: string): boolean => isAutoDate(kind, key) || (noted(kind) && same(auto.title, key));
/** Whether the app alone writes its value: the two times, and a title that follows the first heading. (A title from the file's name only fills an empty one, so it can be written by hand.) */
export const isAutoLocked = (kind: string | null, key: string): boolean => isAutoDate(kind, key) || (noted(kind) && same(auto.title, key) && auto.titleFrom === "h1");

/** A file's name without its extension. */
export const stemOf = (name: string): string => name.replace(/\.note\.html$/i, "").replace(/\.[A-Za-z0-9]{1,8}$/, "");

/** The words of a note's first heading, without their marks; "" when it has none. */
export function firstHeading(kind: "md" | "rich", file: string): string {
  if (kind === "rich") {
    const m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(file);
    return m ? m[1]!.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() : "";
  }
  let fence = false;
  for (const line of splitFrontmatter(file).body.split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(line)) fence = !fence;
    const m = fence ? null : /^ {0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (m) return m[1]!.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`~]/g, "").trim();
  }
  return "";
}

/** The note's file as it is saved at `now`: its modified property says so, and its created one is there (when it has none, `created`, as long as the library knows it). */
export function stampNote(kind: "md" | "txt" | "rich", file: string, created: number | undefined, now: number, name: string, pasted: readonly Prop[] = []): string {
  if (!auto.on || kind === "txt") return file;
  // (a note pasted with its own title or created: those are its own, over what this note had. Its modified is now, as for any save.)
  const given = (key: string): Prop | undefined => pasted.find((p) => p.key && !p.raw && same(p.key, key) && p.value.length);
  const words = (p: Prop): string => (Array.isArray(p.value) ? p.value.join(", ") : p.value);
  const made = formatNoteDate(new Date(created ?? now), auto.format);
  const at = formatNoteDate(new Date(now), auto.format);
  const heading = auto.titleFrom === "h1" && !given(auto.title) ? firstHeading(kind, file) : "";
  const title = heading || stemOf(name);
  if (kind === "rich") {
    const m = richMeta(file) ?? NO_META;
    const own = (f: { key: string; value: string }, key: string): boolean => same(f.key, key) && !!given(key);
    const fields = m.fields.map((f) => (same(f.key, auto.modified) ? { key: f.key, value: at } : own(f, auto.created) ? { key: f.key, value: words(given(auto.created)!) } : own(f, auto.title) ? { key: f.key, value: words(given(auto.title)!) } : f));
    if (!fields.some((f) => same(f.key, auto.modified))) fields.push({ key: auto.modified, value: at });
    if (!fields.some((f) => same(f.key, auto.created) && f.value)) fields.push({ key: auto.created, value: made });
    const t = fields.findIndex((f) => same(f.key, auto.title));
    if (t < 0) fields.unshift({ key: auto.title, value: title });
    else if (heading || !fields[t]!.value) fields[t] = { key: fields[t]!.key, value: title };
    return withRichMeta(file, { ...m, fields });
  }
  const { props, body } = splitFrontmatter(file);
  const out: Prop[] = (props ?? []).map((p) => (p.key && !p.raw && same(p.key, auto.modified) ? { key: p.key, value: at } : p.key && same(p.key, auto.created) && given(auto.created) ? { ...given(auto.created)!, key: p.key } : p.key && same(p.key, auto.title) && given(auto.title) ? { ...given(auto.title)!, key: p.key } : p.key && !p.raw && same(p.key, auto.created) && !p.value.length ? { key: p.key, value: made } : p));
  const t = out.findIndex((p) => p.key && same(p.key, auto.title));
  if (t < 0) out.unshift({ key: auto.title, value: title });
  else if (!out[t]!.raw && (heading ? out[t]!.value !== heading : !out[t]!.value.length)) out[t] = { key: out[t]!.key, value: title };
  if (!out.some((p) => same(p.key, auto.created))) out.push({ key: auto.created, value: made });
  if (!out.some((p) => same(p.key, auto.modified))) out.push({ key: auto.modified, value: at });
  return withFrontmatter(body, out);
}
