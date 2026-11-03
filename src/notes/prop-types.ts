// What kind of value a property holds, as Obsidian's properties have them: a type belongs to a property's name, for the whole library.
// A value is never changed to fit: one that does not fit its type is kept as it is and said to be wrong. Pure, but for the names' types.

export type PropType = "text" | "list" | "number" | "checkbox" | "date" | "datetime";

export const PROP_TYPES: ReadonlyArray<{ id: PropType; label: string; expects: string }> = [
  { id: "text", label: "Text", expects: "any text" },
  { id: "list", label: "List", expects: "items separated by commas" },
  { id: "number", label: "Number", expects: "a number, such as 1977 or 3.14" },
  { id: "checkbox", label: "Checkbox", expects: "true or false" },
  { id: "date", label: "Date", expects: "a date, such as 2025-01-31" },
  { id: "datetime", label: "Date & time", expects: "a date and time, such as 2025-01-31T10:30" },
];

/** The properties that are lists whatever they hold. */
const BUILT_IN: Readonly<Record<string, PropType>> = { aliases: "list", cssclasses: "list" };

const NUMBER = /^-?\d+(?:\.\d+)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

/** A day that is on the calendar (not 2025-02-30). */
const isDate = (v: string): boolean => {
  const m = DATE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};
const isDateTime = (v: string): boolean => {
  const m = DATETIME.exec(v);
  return !!m && isDate(m[1]!) && Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4] ?? 0) < 60;
};

/** Whether a value fits a type; an empty one fits all. */
export function fitsType(type: PropType, value: string): boolean {
  const v = value.trim();
  if (!v || type === "text" || type === "list") return true;
  if (type === "number") return NUMBER.test(v);
  if (type === "checkbox") return /^(?:true|false)$/i.test(v);
  return type === "date" ? isDate(v) : isDateTime(v);
}

/** What a value that does not fit says; "" when it fits. */
export const typeWarning = (type: PropType, value: string): string => (fitsType(type, value) ? "" : `Does not match the type ${PROP_TYPES.find((t) => t.id === type)!.label}: expected ${PROP_TYPES.find((t) => t.id === type)!.expects}.`);

/** The type a value reads as, when its name has none. */
export function guessType(value: string): PropType {
  const v = value.trim();
  if (!v) return "text";
  for (const t of ["number", "checkbox", "date", "datetime"] as const) if (fitsType(t, v)) return t;
  return "text";
}

/** Whether the date and time picker can show this value (it has no place for a time zone or a fraction beyond its own). */
export const pickerShows = (value: string): boolean => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value) && isDateTime(value);

/** The value a picker or a checkbox gives, as the file wrote it while it means the same (`:00` seconds left off, `True`). */
export function asWritten(written: string, shown: string): string {
  if (written.toLowerCase() === shown.toLowerCase()) return written;
  return written.startsWith(shown) && /^:00(?:\.0+)?$/.test(written.slice(shown.length)) ? written : shown;
}

let assigned: Record<string, PropType> = {};

/** The stored types of names (a setting), when valid. */
export function parsePropTypes(text: string): Record<string, PropType> | null {
  try {
    const raw = JSON.parse(text || "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return Object.values(raw).every((t) => PROP_TYPES.some((p) => p.id === t)) ? (raw as Record<string, PropType>) : null;
  } catch {
    return null;
  }
}
export const validPropTypes = (v: unknown): string | undefined => (typeof v === "string" && v.length <= 100_000 && parsePropTypes(v) ? v : undefined);
/** Set by the app from the setting. */
export const setPropTypes = (text: string): void => void (assigned = parsePropTypes(text) ?? {});
/** The stored text with a name's type changed. */
export const withPropType = (text: string, key: string, type: PropType): string => JSON.stringify({ ...(parsePropTypes(text) ?? {}), [key.trim().toLowerCase()]: type });

/** Whether a name has a type of its own (chosen, or built in), rather than one read from a value. */
export const hasPropType = (key: string): boolean => {
  const k = key.trim().toLowerCase();
  return k in assigned || k in BUILT_IN;
};
/** A property's type: its name's, else what its value reads as. */
export function propType(key: string, value: string): PropType {
  const k = key.trim().toLowerCase();
  return assigned[k] ?? BUILT_IN[k] ?? guessType(value);
}
