// What a save may change by itself, all of it off until asked for: a note's title, when it was created, when it was last saved, and its file's name. Pure, but for the settings.
import { keptPart, safeBase } from "../storage/workspace-names";
import { fileMeta, withFrontmatter, splitFrontmatter, richMeta, withRichMeta, NO_META, type Prop } from "./frontmatter";

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
  /** The two times. */
  on: boolean;
  created: string;
  modified: string;
  format: string;
  title: string;
  /** Whether the title follows the note's first heading. */
  titleFrom: "off" | "h1";
  /** Whether a save renames the note's file, from `nameFrom`, written as `nameStyle` says. */
  rename: boolean;
  nameFrom: "h1" | "title";
  nameStyle: "kept" | "clean";
}
export const DATE_FORMAT = "YYYY-MM-DDTHH:mm";
/** The settings these come from. */
export const AUTO_NOTE_SETTINGS: readonly string[] = ["notes.autoDates", "notes.titleKey", "notes.titleFrom", "notes.createdKey", "notes.modifiedKey", "notes.dateFormat", "notes.renameOnSave", "notes.nameFrom", "notes.nameStyle"];
let auto: AutoDates = { on: false, created: "created", modified: "modified", format: DATE_FORMAT, title: "title", titleFrom: "off", rename: false, nameFrom: "h1", nameStyle: "kept" };
/** Set by the app from the settings (an empty name or format: the usual one). */
export const setAutoDates = (a: AutoDates): void => void (auto = { ...a, created: a.created.trim() || "created", modified: a.modified.trim() || "modified", format: a.format.trim() || DATE_FORMAT, title: a.title.trim() || "title" });
export const autoDates = (): Readonly<AutoDates> => auto;

const hasProps = (kind: string | null): boolean => kind === "md" || kind === "rich";
const same = (a: string, b: string): boolean => a.toLowerCase() === b.trim().toLowerCase();
/** Whether this name is one of the two times, kept up by the app. */
export const isAutoDate = (kind: string | null, key: string): boolean => hasProps(kind) && auto.on && (same(auto.created, key) || same(auto.modified, key));
/** Whether this name is one the app alone writes: it stays on the note and is not edited in the panel. */
export const isAutoKey = (kind: string | null, key: string): boolean => isAutoDate(kind, key) || (hasProps(kind) && auto.titleFrom === "h1" && same(auto.title, key));

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

/**
 * The note's file as it is saved at `now`, with what the settings ask for: its modified property says so, its created one is there (when it has none, `created`,
 * as long as the library knows it), its title is its first heading. Nothing asked for: the file as it is.
 */
export function stampNote(kind: "md" | "txt" | "rich", file: string, created: number | undefined, now: number, pasted: readonly Prop[] = []): string {
  if (kind === "txt") return file;
  const titled = auto.titleFrom === "h1";
  if (!auto.on && !titled) return file;
  // (a note pasted with its own title or created: those are its own, over what this note had. Its modified is now, as for any save.)
  const given = (key: string): Prop | undefined => pasted.find((p) => p.key && !p.raw && same(p.key, key) && p.value.length);
  const words = (p: Prop): string => (Array.isArray(p.value) ? p.value.join(", ") : p.value);
  const givenCreated = auto.on ? given(auto.created) : undefined;
  const givenTitle = titled ? given(auto.title) : undefined;
  const made = formatNoteDate(new Date(created ?? now), auto.format);
  const at = formatNoteDate(new Date(now), auto.format);
  const heading = titled && !givenTitle ? firstHeading(kind, file) : "";
  if (kind === "rich") {
    const m = richMeta(file) ?? NO_META;
    let fields = [...m.fields];
    const put = (key: string, value: string, first = false): void => {
      const at2 = fields.findIndex((f) => same(f.key, key));
      if (at2 >= 0) fields[at2] = { key: fields[at2]!.key, value };
      else fields = first ? [{ key, value }, ...fields] : [...fields, { key, value }];
    };
    if (givenTitle) put(auto.title, words(givenTitle), true);
    else if (heading) put(auto.title, heading, true);
    if (auto.on) {
      put(auto.modified, at);
      if (givenCreated) put(auto.created, words(givenCreated));
      else if (!fields.some((f) => same(f.key, auto.created) && f.value)) put(auto.created, made);
    }
    return withRichMeta(file, { ...m, fields });
  }
  const { props, body } = splitFrontmatter(file);
  const titleNow: Prop | undefined = givenTitle ?? (heading ? { key: auto.title, value: heading } : undefined);
  const out: Prop[] = (props ?? []).map((p) => {
    if (!p.key || p.raw) return p;
    if (auto.on && same(p.key, auto.modified)) return { key: p.key, value: at };
    if (auto.on && same(p.key, auto.created)) return givenCreated ? { ...givenCreated, key: p.key } : p.value.length ? p : { key: p.key, value: made };
    if (titleNow && same(p.key, auto.title)) return words(p as Prop) === words(titleNow) ? p : { ...titleNow, key: p.key };
    return p;
  });
  if (titleNow && !out.some((p) => p.key && same(p.key, auto.title))) out.unshift(titleNow);
  if (auto.on && !out.some((p) => p.key && same(p.key, auto.created))) out.push(givenCreated ?? { key: auto.created, value: made });
  if (auto.on && !out.some((p) => p.key && same(p.key, auto.modified))) out.push({ key: auto.modified, value: at });
  // (nothing changed: the file, not a copy written again)
  if (props && out.length === props.length && out.every((p, i) => p === props[i])) return file;
  if (!props && !out.length) return file;
  return withFrontmatter(body, out);
}

/**
 * The name a save gives the note's file, or null to leave it: nothing asked for, nothing usable to name it by (no heading or title, or only marks: `# ???`),
 * or it has that name already (`name-2` counts: another note of that name had it first). `itemTitle`: the title the library has, when the file has none.
 */
export function noteFileName(kind: "md" | "txt" | "rich", file: string, current: string, itemTitle?: string): string | null {
  if (!auto.rename || kind === "txt") return null;
  const said = auto.nameFrom === "h1" ? firstHeading(kind, file) : ((fileMeta(kind, file)?.fields.find((f) => same(f.key, auto.title))?.value || itemTitle) ?? "");
  const words = said.split("\n")[0]!.trim();
  if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(words)) return null;
  const base = auto.nameStyle === "clean" ? safeBase(words) : keptPart(words);
  if (base === "file" && words.toLowerCase() !== "file") return null; // (all of it was cleaned away)
  const ext = kind === "rich" ? ".note.html" : (/\.[A-Za-z0-9]{1,8}$/.exec(current)?.[0] ?? ".md");
  const stem = current.toLowerCase().endsWith(ext.toLowerCase()) ? current.slice(0, -ext.length) : current;
  if (stem === base || (stem.startsWith(`${base}-`) && /^\d+$/.test(stem.slice(base.length + 1)))) return null;
  return `${base}${ext}`;
}
