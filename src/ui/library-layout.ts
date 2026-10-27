/**
 * Where each card of the library goes, worked out in code so that only the cards near the view need to be in the page.
 * Three shapes: the justified gallery (every picture at its own proportions, each full row stretched to the width, the
 * last row left as it is), squares in columns (phones) and the list (one row per item).
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Row {
  y: number;
  h: number;
  /** The first item of the row, and one past the last. */
  start: number;
  end: number;
}
export interface GridLayout {
  boxes: Box[];
  rows: Row[];
  height: number;
}

/** No card is narrower than this, however tall and thin its picture. */
export const MIN_CARD_W = 64;

export function justifiedLayout(ratios: readonly number[], width: number, rowH: number, gap: number): GridLayout {
  const boxes: Box[] = [];
  const rows: Row[] = [];
  let y = 0;
  let i = 0;
  while (i < ratios.length) {
    const start = i;
    let used = 0;
    let sumAr = 0;
    do {
      const b = Math.max(MIN_CARD_W, ratios[i]! * rowH);
      if (i > start && used + gap + b > width) break;
      used += (i > start ? gap : 0) + b;
      sumAr += ratios[i]!;
      i++;
    } while (i < ratios.length);
    const free = width - used;
    const last = i === ratios.length;
    // A full row is stretched to the width, each card by its share of the proportions, and grows taller by the same rule; a picture wider
    // than the view alone is shrunk to it. Every card of a row is as tall as the row (one held at the narrowest width shows its picture cropped).
    const stretch = !last && free > 0;
    const h = free < 0 ? Math.max(MIN_CARD_W, width) / ratios[start]! : stretch ? rowH + free / sumAr : rowH;
    let x = 0;
    for (let k = start; k < i; k++) {
      const ar = ratios[k]!;
      const b = Math.max(MIN_CARD_W, ar * rowH);
      const w = free < 0 ? Math.max(MIN_CARD_W, width) : stretch ? b + (free * ar) / sumAr : b;
      boxes.push({ x, y, w, h });
      x += w + gap;
    }
    rows.push({ y, h, start, end: i });
    y += h + gap;
  }
  return { boxes, rows, height: Math.max(0, y - gap) };
}

export function squaresLayout(n: number, width: number, size: number, gap: number): GridLayout {
  const cols = Math.max(1, Math.floor((width + gap) / (Math.min(size, width) + gap)));
  const w = Math.max(1, (width - gap * (cols - 1)) / cols);
  const boxes: Box[] = [];
  const rows: Row[] = [];
  for (let start = 0, y = 0; start < n; start += cols, y += w + gap) {
    const end = Math.min(n, start + cols);
    for (let k = start; k < end; k++) boxes.push({ x: (k - start) * (w + gap), y, w, h: w });
    rows.push({ y, h: w, start, end });
  }
  return { boxes, rows, height: rows.length ? rows.length * (w + gap) - gap : 0 };
}

export function listLayout(n: number, width: number, rowH: number, gap: number): GridLayout {
  const boxes: Box[] = [];
  const rows: Row[] = [];
  for (let k = 0; k < n; k++) {
    const y = k * (rowH + gap);
    boxes.push({ x: 0, y, w: width, h: rowH });
    rows.push({ y, h: rowH, start: k, end: k + 1 });
  }
  return { boxes, rows, height: n ? n * (rowH + gap) - gap : 0 };
}

/** The items whose rows reach into [top, bottom]: [first, one past the last]. */
export function itemsIn(layout: GridLayout, top: number, bottom: number): [number, number] {
  const { rows } = layout;
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.y + rows[mid]!.h < top) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < rows.length && rows[end]!.y <= bottom) end++;
  return lo < end ? [rows[lo]!.start, rows[end - 1]!.end] : [0, 0];
}

/** The row an item is in. */
export function rowOf(layout: GridLayout, index: number): number {
  const { rows } = layout;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rows[mid]!.start <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The item in a row nearest to a horizontal position (up and down with the keyboard). */
export function nearestInRow(layout: GridLayout, row: number, cx: number): number {
  const r = layout.rows[row]!;
  let best = r.start;
  let bestD = Infinity;
  for (let k = r.start; k < r.end; k++) {
    const b = layout.boxes[k]!;
    const d = Math.abs(b.x + b.w / 2 - cx);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}
