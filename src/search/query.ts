/**
 * Search queries with AND, OR, XOR and NOT (ADR 0069), shared by the library and the canvas search.
 *
 * Plain words behave as before: a space means AND. Operators (upper case, so a lower-case "or" is still a word):
 *   AND  &        both          red AND cat    red & cat
 *   OR   |        either        red OR blue    red | blue
 *   XOR  ^        exactly one   red XOR blue
 *   NOT  ! -      not           NOT red        -red    !red
 *   ( )           grouping      (red OR blue) -cat
 *   "..."         one phrase    "red cat"
 * Precedence is NOT, then AND, then XOR, then OR. A term keeps its `#` (a `#tag` term); the caller decides what a term matches.
 * A query that cannot be read (an unclosed bracket, a missing operand) is not an error: it falls back to every word joined by AND.
 */
export interface Term {
  /** Lower-cased text, including a leading `#`. */
  readonly text: string;
  readonly quoted: boolean;
}

export type Query =
  | { readonly op: "term"; readonly term: Term }
  | { readonly op: "not"; readonly a: Query }
  | { readonly op: "and" | "or" | "xor"; readonly a: Query; readonly b: Query };

export interface Parsed {
  /** null for an empty query (matches everything). */
  readonly query: Query | null;
  /** True when the text could not be read as a boolean expression and was treated as plain words. */
  readonly fallback: boolean;
}

type Tok = { readonly t: "(" | ")" | "and" | "or" | "xor" | "not" } | { readonly t: "term"; readonly term: Term };

type OpTok = "and" | "or" | "xor" | "not";
const WORD_OPS: Record<string, OpTok> = { AND: "and", OR: "or", XOR: "xor", NOT: "not" };
const CHAR_OPS: Record<string, OpTok> = { "&": "and", "|": "or", "^": "xor", "!": "not" };

const tokenize = (src: string): Tok[] => {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(" || c === ")") { out.push({ t: c }); i++; continue; }
    if (c === "&" || c === "|" || c === "^" || c === "!") { out.push({ t: CHAR_OPS[c]! }); i++; continue; }
    // A leading "-" negates the word that follows it; inside a word it is just a hyphen.
    if (c === "-" && i + 1 < src.length && !/[\s)]/.test(src[i + 1]!)) { out.push({ t: "not" }); i++; continue; }
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      const text = src.slice(i + 1, end < 0 ? src.length : end);
      if (text.trim()) out.push({ t: "term", term: { text: text.trim().toLowerCase(), quoted: true } });
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    let j = i;
    while (j < src.length && !/[\s()&|^!"]/.test(src[j]!)) j++;
    const word = src.slice(i, j);
    i = j;
    const op = WORD_OPS[word];
    out.push(op ? { t: op } : { t: "term", term: { text: word.toLowerCase(), quoted: false } });
  }
  return out;
};

const plainWords = (toks: readonly Tok[]): Query | null => {
  let q: Query | null = null;
  for (const k of toks) {
    if (k.t !== "term") continue;
    const node: Query = { op: "term", term: k.term };
    q = q ? { op: "and", a: q, b: node } : node;
  }
  return q;
};

export const parseQuery = (src: string): Parsed => {
  const toks = tokenize(src);
  if (!toks.length) return { query: null, fallback: false };
  let p = 0;
  const bad = new Error("unreadable");
  const startsOperand = (k: Tok | undefined): boolean => !!k && (k.t === "term" || k.t === "(" || k.t === "not");
  const unary = (): Query => {
    const k = toks[p++];
    if (!k) throw bad;
    if (k.t === "not") return { op: "not", a: unary() };
    if (k.t === "term") return { op: "term", term: k.term };
    if (k.t === "(") {
      const inner = either();
      if (toks[p++]?.t !== ")") throw bad;
      return inner;
    }
    throw bad;
  };
  const both = (): Query => {
    let a = unary();
    // "a b", "a AND b" and "a & b" are all AND.
    for (;;) {
      const k = toks[p];
      if (k?.t === "and") { p++; a = { op: "and", a, b: unary() }; }
      else if (startsOperand(k)) a = { op: "and", a, b: unary() };
      else return a;
    }
  };
  const xor = (): Query => {
    let a = both();
    while (toks[p]?.t === "xor") { p++; a = { op: "xor", a, b: both() }; }
    return a;
  };
  const either = (): Query => {
    let a = xor();
    while (toks[p]?.t === "or") { p++; a = { op: "or", a, b: xor() }; }
    return a;
  };
  try {
    const query = either();
    if (p < toks.length) throw bad;
    return { query, fallback: false };
  } catch {
    return { query: plainWords(toks), fallback: true };
  }
};

/** Evaluate a parsed query; `has` says whether one term matches the item being tested. */
export const evalQuery = (q: Query | null, has: (term: Term) => boolean): boolean => {
  if (!q) return true;
  switch (q.op) {
    case "term": return has(q.term);
    case "not": return !evalQuery(q.a, has);
    case "and": return evalQuery(q.a, has) && evalQuery(q.b, has);
    case "or": return evalQuery(q.a, has) || evalQuery(q.b, has);
    case "xor": return evalQuery(q.a, has) !== evalQuery(q.b, has);
  }
};
