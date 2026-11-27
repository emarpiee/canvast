// Behaviour: a numbered list keeps counting in order whatever is moved, pasted or deleted in it, in the same undo step; a list started at
// another number keeps it (as notes apps do). Test: notes.spec "lists as notes apps write them".
import { EditorState, type ChangeSpec, type Extension } from "@codemirror/state";

/** Numbered lists keep counting in order whatever is moved, pasted or deleted in them: the touched lists are numbered again in the same step. */
export const renumberLists: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;
  const doc = tr.newDoc;
  const touched = new Set<number>();
  const ranges: Array<[number, number]> = [];
  tr.changes.iterChangedRanges((_a, _b, fromB, toB) => {
    ranges.push([fromB, toB]);
    for (let l = doc.lineAt(fromB).number; l <= doc.lineAt(Math.min(toB, doc.length)).number; l++) touched.add(l);
  });
  /** Whether a change put this line's start in (a line moved, pasted or left in the first place by a deletion): its number was not written there. */
  const placed = (n: number): boolean => ranges.some(([f, t]) => f <= doc.line(n).from && t > doc.line(n).from && t - f > 1);
  const item = (n: number) => (n >= 1 && n <= doc.lines ? /^(\s*(?:>\s?)*)(\d{1,9})([.)])(\s)/.exec(doc.line(n).text) : null);
  const changes: ChangeSpec[] = [];
  const done = new Set<number>();
  for (const t of touched) {
    // (the list round a touched line: items of its indent, met going up and down until a line that is not one)
    let n = item(t) ? t : item(t + 1) ? t + 1 : item(t - 1) ? t - 1 : 0;
    if (!n || done.has(n)) continue;
    const indent = item(n)![1]!;
    const sameList = (k: number): boolean => {
      const m = item(k);
      return !!m && m[1] === indent;
    };
    const skip = (k: number, dir: number): number => {
      while (k >= 1 && k <= doc.lines && !item(k) && /^\s+\S/.test(doc.line(k).text) && doc.line(k).text.search(/\S/) > indent.length) k += dir;
      return k;
    };
    let first = n;
    for (let k = skip(n - 1, -1); sameList(k); k = skip(k - 1, -1)) first = k;
    let num = Number(item(first)![2]);
    if (placed(first) && doc.lines !== tr.startState.doc.lines) num = 1;
    for (let k = first; sameList(k); k = skip(k + 1, 1)) {
      done.add(k);
      const m = item(k)!;
      const line = doc.line(k);
      if (Number(m[2]) !== num) changes.push({ from: line.from + m[1]!.length, to: line.from + m[1]!.length + m[2]!.length, insert: String(num) });
      num++;
    }
  }
  return changes.length ? [tr, { changes, sequential: true }] : tr;
});
