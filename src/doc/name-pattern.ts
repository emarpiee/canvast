/**
 * Name patterns: how a name is made from words, numbers, dates and tokens. One rule for every place that names things in a run (the bulk
 * Rename of the Library, the files of Export…, and whatever names a series next), so a pattern written in one works the same in another.
 *
 * | Write | It becomes |
 * | --- | --- |
 * | `#`, `###` | the number, zero-padded to the run's length (`###` → 001); `{n}` is `##` |
 * | `{name}` | the name the thing has |
 * | `{date}`, `{date:FORMAT}` | a date: 2026-11-11, or in FORMAT with YYYY YY MM DD HH mm ss (anything else stays as written) |
 * | `{key}` | a value the caller gives (Export: `{w}` `{h}` `{canvas}` `{format}`); an unknown token stays as written |
 *
 * One pass over the pattern: what a token puts in (a name with a `#` in it) is never read again as a pattern. Pure, no page.
 */

/** Which date `{date}` is: today, one date set by year, month and day, or (where things have one) each thing's own date. */
export type DateSource = "today" | "fixed" | "own";

export interface PatternParts {
  /** What `{name}` is. */
  readonly name: string;
  /** What `#` is. */
  readonly number: number;
  /** What `{date}` is. */
  readonly date: Date;
  /** Other tokens, by their name without braces (`w`, `canvas` …). */
  readonly values?: Readonly<Record<string, string>>;
}

/** The tokens a pattern can hold, with what each stands for and an example: the chips of a dialog and its help come from here. */
export const PATTERN_TOKENS: ReadonlyArray<{ readonly token: string; readonly what: string }> = [
  { token: "{name}", what: "its name" },
  { token: "###", what: "a number, as many digits as #: 001, 002 …" },
  { token: "{date}", what: "a date: 2026-11-11" },
  { token: "{date:YYYYMMDD}", what: "a date in your own format: YYYY YY MM DD HH mm ss, anything else stays" },
];

const pad = (v: number, n: number): string => String(v).padStart(n, "0");

/** A date in a format of YYYY YY MM DD HH mm ss; every other character stays as written. No format: YYYY-MM-DD. */
export function formatDate(d: Date, format = "YYYY-MM-DD"): string {
  const parts: Record<string, string> = { YYYY: String(d.getFullYear()), YY: pad(d.getFullYear() % 100, 2), MM: pad(d.getMonth() + 1, 2), DD: pad(d.getDate(), 2), HH: pad(d.getHours(), 2), mm: pad(d.getMinutes(), 2), ss: pad(d.getSeconds(), 2) };
  return format.replace(/YYYY|YY|MM|DD|HH|mm|ss/g, (k) => parts[k]!);
}

/** A date from YYYY-MM-DD (a date field's value), at midnight here; null when it is not one. */
export function parseDay(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

/** The date `{date}` stands for: today (now), the day set (a YYYY-MM-DD), or the thing's own (a time in ms), falling back to today. */
export function dateOf(source: DateSource, fixed: string, own?: number): Date {
  if (source === "fixed") return parseDay(fixed) ?? new Date();
  if (source === "own" && own !== undefined && Number.isFinite(own)) return new Date(own);
  return new Date();
}

const TOKEN = /\{([a-z]+)(?::([^{}]*))?\}|#+/g;

/** Whether a pattern holds a number (`#` or `{n}`): without one, the callers that need a number add it. */
export const hasNumber = (pattern: string): boolean => /#|\{n\}/.test(pattern);
/** Whether a pattern holds a date. */
export const hasDate = (pattern: string): boolean => /\{date(?::[^{}]*)?\}/.test(pattern);

/** The pattern filled in (not yet cleaned as a file name: the caller does that by its own rules). */
export function fillPattern(pattern: string, p: PatternParts): string {
  return pattern.replace(TOKEN, (whole, key: string | undefined, arg: string | undefined) => {
    if (!key) return pad(p.number, whole.length); // a run of #
    if (key === "name") return p.name;
    if (key === "n") return pad(p.number, 2);
    if (key === "date") return formatDate(p.date, arg || undefined);
    return p.values?.[key] ?? whole;
  });
}
