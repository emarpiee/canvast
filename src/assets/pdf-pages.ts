/** "1-4, 9" as page numbers in the order typed, each once and only those a PDF of `count` pages has. */
export function pageList(text: string, count: number): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[,\s]+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) continue;
    const a = +m[1]!, b = +(m[2] ?? m[1]!);
    for (let n = Math.max(1, Math.min(a, b)), end = Math.min(count, Math.max(a, b)); n <= end && out.size < 10_000; n++) out.add(a <= b ? n : a + b - n);
  }
  return [...out].filter((n) => n >= 1 && n <= count);
}
