/**
 * Batch rename rules (ADR 0085): how a list of names becomes a list of new names. Pure, so any list of named things can use it (assets today;
 * layers, bookmarks or boards later) through the dialog in `ui/batch-rename.ts`.
 */
export type RenameRule =
  /** `#` is replaced by ascending numbers from `start`; a run of `#` is zero-padded to its length; no `#`: the number follows a space. `{name}` is the old name. */
  | { mode: "enumerate"; pattern: string; start: number; keepExt: boolean }
  | { mode: "replace"; find: string; with: string; matchCase: boolean; regex: boolean; keepExt: boolean }
  | { mode: "add"; text: string; where: "before" | "after"; keepExt: boolean }
  /** Set the extension (without the dot); empty removes it. */
  | { mode: "extension"; ext: string };

export type RenameMode = RenameRule["mode"];

export const MAX_NAME = 200;

/** A name and its extension (with the dot). An extension is up to eight letters or digits after the last dot of a name that has something before it. */
export function splitName(name: string): { stem: string; ext: string } {
  const m = /^(.+?)(\.[A-Za-z0-9]{1,8})$/.exec(name);
  return m ? { stem: m[1]!, ext: m[2]! } : { stem: name, ext: "" };
}

/** A name safe on every file system: forbidden characters become "-", edges are trimmed, and it is cut to a sensible length. */
export function cleanFileName(name: string): string {
  return name
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "-")
    .replace(/^[.\s]+|\s+$/g, "")
    .slice(0, MAX_NAME);
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Why a rule cannot be applied (an unreadable pattern), or null. */
export function ruleProblem(rule: RenameRule): string | null {
  if (rule.mode === "replace" && rule.regex && rule.find) {
    try {
      new RegExp(rule.find);
    } catch {
      return "That pattern is not a valid regular expression.";
    }
  }
  if (rule.mode === "enumerate" && !(Number.isInteger(rule.start) && rule.start >= 0 && rule.start <= 1e9)) return "The first number must be a whole number from 0.";
  return null;
}

/** The new names, in the order given (the numbers of an enumeration follow that order). A name the rule would empty keeps its old name. */
export function applyRule(names: readonly string[], rule: RenameRule): string[] {
  if (ruleProblem(rule)) return [...names];
  return names.map((old, i) => {
    const { stem, ext } = splitName(old);
    const keep = rule.mode === "extension" ? true : rule.keepExt;
    const body = keep ? stem : old;
    const tail = keep ? ext : "";
    let next: string;
    switch (rule.mode) {
      case "enumerate": {
        const n = rule.start + i;
        const base = rule.pattern.replace(/\{name\}/g, body);
        next = /#/.test(base) ? base.replace(/#+/g, (run) => String(n).padStart(run.length, "0")) : `${base} ${n}`;
        break;
      }
      case "replace": {
        if (!rule.find) {
          next = body;
          break;
        }
        const re = new RegExp(rule.regex ? rule.find : escapeRegex(rule.find), rule.matchCase ? "g" : "gi");
        next = body.replace(re, rule.with);
        break;
      }
      case "add":
        next = rule.where === "before" ? `${rule.text}${body}` : `${body}${rule.text}`;
        break;
      case "extension": {
        const e = rule.ext.trim().replace(/^\.+/, "");
        next = `${stem}${e ? `.${e}` : ""}`;
        return cleanFileName(next) || old;
      }
    }
    if (!next.trim()) return old; // the rule would leave nothing of the name
    return cleanFileName(`${next}${tail}`) || old;
  });
}
