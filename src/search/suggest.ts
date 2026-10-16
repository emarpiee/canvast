/**
 * Suggestions while typing a search (ADR 0083): what could complete the word under the cursor. A `.` word suggests the file types in the
 * library, a `#` word the tags, a plain word the tags and file types that match it, a capital letter the operator it starts (AND, OR, XOR,
 * NOT), and after a finished word the operators that could follow. Pure: the caller supplies what exists.
 */
export interface SuggestSources {
  readonly tags: ReadonlyArray<{ readonly label: string; readonly n: number }>;
  readonly types: ReadonlyArray<{ readonly ext: string; readonly n: number }>;
}

export interface Suggestion {
  /** What replaces the word under the cursor. */
  readonly insert: string;
  /** What the chip says. */
  readonly label: string;
  /** A small note: how many, or what kind. */
  readonly note: string;
  readonly kind: "tag" | "type" | "operator";
}

export interface Suggested {
  /** The part of the text the suggestions replace. */
  readonly start: number;
  readonly end: number;
  readonly items: readonly Suggestion[];
}

const OPERATORS = ["AND", "OR", "XOR", "NOT"] as const;
const MAX = 6;

/** The word around `caret`: runs of anything but spaces, brackets and the symbols & | ^. A leading `-` or `!` (not) is kept out of it. */
export function wordAt(value: string, caret: number): { start: number; end: number; text: string } {
  const stop = /[\s()&|^"]/;
  let start = caret;
  while (start > 0 && !stop.test(value[start - 1]!)) start--;
  let end = caret;
  while (end < value.length && !stop.test(value[end]!)) end++;
  while (start < end && (value[start] === "-" || value[start] === "!")) start++;
  return { start, end, text: value.slice(start, end) };
}

const rank = (label: string, q: string): number => (label.toLowerCase().startsWith(q) ? 0 : 1);

export function suggest(value: string, caret: number, src: SuggestSources): Suggested {
  const w = wordAt(value, caret);
  const none: Suggested = { start: w.start, end: w.end, items: [] };
  const q = w.text.toLowerCase();
  if (!w.text) {
    // Nothing typed here: after a finished word, what could come next.
    const before = value.slice(0, w.start).trimEnd();
    if (!before || /[(&|^!-]$/.test(before) || /(?:^|\s)(?:AND|OR|XOR|NOT)$/.test(before)) return none;
    return { start: w.start, end: w.end, items: OPERATORS.map((o) => ({ insert: `${o} `, label: o, note: o === "NOT" ? "leave out" : o === "XOR" ? "one, not both" : o === "OR" ? "either" : "both", kind: "operator" as const })).slice(0, 3) };
  }
  if (w.text.startsWith(".")) {
    const ext = q.slice(1);
    const items = src.types.filter((t) => t.ext.startsWith(ext) && t.ext !== ext).sort((a, b) => b.n - a.n).slice(0, MAX);
    return { ...none, items: items.map((t) => ({ insert: `.${t.ext} `, label: `.${t.ext}`, note: String(t.n), kind: "type" as const })) };
  }
  if (w.text.startsWith("#")) {
    const t = q.slice(1);
    const items = src.tags.filter((x) => x.label.toLowerCase().includes(t) && x.label.toLowerCase() !== t).sort((a, b) => rank(a.label, t) - rank(b.label, t) || b.n - a.n).slice(0, MAX);
    return { ...none, items: items.map((x) => ({ insert: /\s/.test(x.label) ? `"#${x.label}" ` : `#${x.label} `, label: `#${x.label}`, note: String(x.n), kind: "tag" as const })) };
  }
  const items: Suggestion[] = [];
  // A capital letter typed: the operator it could be the start of.
  if (/^[A-Z]+$/.test(w.text)) {
    for (const o of OPERATORS) if (o.startsWith(w.text) && o !== w.text) items.push({ insert: `${o} `, label: o, note: "operator", kind: "operator" });
    if (items.length) return { ...none, items }; // a capital word that starts an operator is about the operator
  }
  for (const x of src.tags.filter((t) => t.label.toLowerCase().includes(q) && t.label.toLowerCase() !== q).sort((a, b) => rank(a.label, q) - rank(b.label, q) || b.n - a.n).slice(0, 3)) {
    items.push({ insert: /\s/.test(x.label) ? `"#${x.label}" ` : `#${x.label} `, label: `#${x.label}`, note: String(x.n), kind: "tag" });
  }
  for (const t of src.types.filter((x) => x.ext.startsWith(q) && x.ext !== q).sort((a, b) => b.n - a.n).slice(0, 2)) items.push({ insert: `.${t.ext} `, label: `.${t.ext}`, note: String(t.n), kind: "type" });
  return { ...none, items: items.slice(0, MAX) };
}

/** Put a suggestion into the text: returns the new text and where the cursor goes. */
export function applySuggestion(value: string, s: Suggested, item: Suggestion): { value: string; caret: number } {
  const head = value.slice(0, s.start);
  const tail = value.slice(s.end).replace(/^\s+/, "");
  const next = head + item.insert + tail;
  return { value: next, caret: (head + item.insert).length };
}
