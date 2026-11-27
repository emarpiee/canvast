// A guess at the language of a code block that names none, from words and shapes only that language has. Only a clear lead counts: a
// block that could be anything is plain text. The guess colours the block and shows on its label; it is never written into the note.
const SIGNS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [RegExp, number]>]> = [
  ["python", [[/^\s*def \w+\(.*\):\s*$/m, 4], [/^\s*(from \w[\w.]* )?import \w/m, 2], [/^\s*class \w+(\(.*\))?:\s*$/m, 3], [/\bself\b/, 2], [/\belif\b|\bNone\b|\bTrue\b|\bFalse\b/, 2], [/^\s*print\(/m, 2]]],
  ["javascript", [[/\b(const|let|var) \w+ =/, 2], [/\bfunction\s*\w*\s*\(/, 3], [/=>/, 2], [/\bconsole\.\w+\(/, 3], [/\b(document|window)\./, 3], [/\brequire\(|\bmodule\.exports\b/, 3]]],
  ["typescript", [[/:\s*(string|number|boolean|void|unknown|any)\b/, 3], [/\binterface \w+\s*\{/, 4], [/\btype \w+ =/, 3], [/\bas const\b|<\w+>\(/, 2], [/\bimport .* from ['"]/, 2]]],
  ["rust", [[/\bfn \w+\s*\(/, 4], [/\blet mut\b/, 4], [/\bimpl\b|\bpub fn\b|\buse \w+::/, 3], [/println!\(|&str\b|Vec</, 3]]],
  ["go", [[/^package \w+/m, 4], [/\bfunc \w*\s*\(/, 3], [/:=/, 2], [/\bfmt\.\w+\(/, 3]]],
  ["java", [[/\bpublic (static )?(class|void|final)\b/, 4], [/System\.out\.print/, 4], [/\bprivate \w+ \w+;/, 3]]],
  ["c", [[/#include\s*<\w+\.h>/, 4], [/\bint main\s*\(/, 3], [/\bprintf\(/, 3], [/\bmalloc\(|\bsizeof\(/, 2]]],
  ["cpp", [[/#include\s*<\w+>/, 3], [/\bstd::/, 4], [/\bcout\s*<</, 4], [/\btemplate\s*</, 3]]],
  ["csharp", [[/\busing System\b/, 4], [/\bnamespace \w+/, 2], [/Console\.Write/, 4]]],
  ["ruby", [[/^\s*def \w+[^:]*$/m, 2], [/^\s*end\s*$/m, 3], [/\bputs\b/, 3], [/\.each do\b|\|\w+\|/, 3]]],
  ["php", [[/<\?php/, 6], [/\$\w+\s*=/, 2], [/\becho\b/, 2]]],
  ["bash", [[/^#!\/bin\/(ba)?sh/m, 6], [/^\s*(echo|cd|export|sudo|apt|npm|git|ls|mkdir) /m, 3], [/\$\{?\w+\}?/, 1], [/\bfi\b|\bdone\b|\bthen\b/, 2]]],
  ["sql", [[/\bSELECT\b[\s\S]*\bFROM\b/i, 5], [/\b(INSERT INTO|CREATE TABLE|UPDATE \w+ SET|DELETE FROM)\b/i, 5], [/\bWHERE\b/i, 1]]],
  ["html", [[/<!DOCTYPE html>|<html\b/i, 6], [/<(div|span|p|a|body|head|ul|li)\b[^>]*>/, 3], [/<\/\w+>/, 1]]],
  ["css", [[/^\s*[.#]?[\w-]+(\s*[.#:][\w-]+)*\s*\{\s*$/m, 2], [/^\s*[\w-]+\s*:\s*[^;]+;\s*$/m, 3], [/@media\b|!important/, 3]]],
  ["json", [[/^\s*[[{]/, 1], [/^\s*"[\w-]+"\s*:/m, 4]]],
  ["yaml", [[/^\s*[\w-]+:\s*\S/m, 2], [/^\s*-\s+\w/m, 1], [/^---\s*$/m, 1]]],
];

/** The language of `code`, or null when nothing leads clearly. */
export function guessLanguage(code: string): string | null {
  if (code.trim().length < 12) return null;
  let best: string | null = null, top = 0, second = 0;
  for (const [lang, signs] of SIGNS) {
    let score = 0;
    for (const [re, w] of signs) if (re.test(code)) score += w;
    if (score > top) (second = top), (top = score), (best = lang);
    else if (score > second) second = score;
  }
  return top >= 4 && top - second >= 2 ? best : null;
}
