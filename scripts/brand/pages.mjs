// The canvast brand board: nine pages of 1600 × 1000 units. Each page is an SVG (pasted into the app) plus its labels
// [x, y, text, size, colour, bold] (x = left edge, y = middle of the capitals, both in page units), typed with the Text tool.
export const PW = 1600, PH = 1000;
// The palette is the app's default theme (src/styles.css, hue 178, Viridian) in light mode: ultra = --hud-accent, ink = --hud-fg, paper = --theme-bg, muted = --hud-muted; spark is the orange of --canvas-axis, lifted so the dot reads on the tile.
export const C = { ultra: "#007B69", ink: "#172522", paper: "#E8F3F0", spark: "#FFA460", haze: "#C3E7DE", white: "#F8FDFC", muted: "#4D5C58", mutedD: "#9CA8A4", line: "#CCD7D4", red: "#C92F33", dkLine: "#273A35", dkGrid: "#1C2A26", dkGridMajor: "#20322E" };

// The mark on a 64-unit grid: a canvas (the frame), a window cut from it, a little low and to the right (you lean in to look), and the point in
// the window's middle (the dot). The owner's chosen drawing, made on a 24-unit grid, scaled to 64 exactly: keep these numbers as they are.
const K = 64 / 24, f = (n) => +(n * K).toFixed(3);
const rr = (x, y, w, r) => {
  const n = (v) => +v.toFixed(3), a = n(x + r), b = n(x + w - r), c = n(y + r), d = n(y + w - r), X = n(x + w), Y = n(y + w);
  return `M${a} ${y}H${b}A${r} ${r} 0 0 1 ${X} ${c}V${d}A${r} ${r} 0 0 1 ${b} ${Y}H${a}A${r} ${r} 0 0 1 ${x} ${d}V${c}A${r} ${r} 0 0 1 ${a} ${y}Z`;
};
export const FRAME = { x: f(5.5), w: f(13), r: f(3.575) }, WINDOW = { x: f(9.075), w: f(7.475), r: f(2.21) }, DOT = { x: f(11.5125), w: f(2.6), r: f(0.715) };
export const DOT_C = DOT.x + DOT.w / 2; // the dot's centre (x and y), 34.17 units: the window's centre
export const GLYPH = rr(FRAME.x, FRAME.x, FRAME.w, FRAME.r) + rr(WINDOW.x, WINDOW.x, WINDOW.w, WINDOW.r); // (even-odd: the window is a hole)
const dotRect = (fill) => `<rect x="${DOT.x}" y="${DOT.x}" width="${DOT.w}" height="${DOT.w}" rx="${DOT.r}" fill="${fill}"/>`;
/** The mark in a box of `size` at x, y. tile: the tile colour or null. One drawing serves every size, the favicon too. */
export function mark(x, y, size, { tile = C.ultra, c = C.paper, dot = C.spark, extra = "", tileAttrs = "" } = {}) {
  const s = size / 64;
  const glyph = `<path d="${GLYPH}" fill="${c}" fill-rule="evenodd"/>${dot ? dotRect(dot) : ""}`;
  return `<g transform="translate(${x} ${y}) scale(${s})">${tile ? `<rect width="64" height="64" rx="14" fill="${tile}" ${tileAttrs}/>` : ""}${glyph}${extra}</g>`;
}
/** Standalone SVG files of the mark (for the icon files, not the board). */
export const markSvg = (opts = {}, px = 64) => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64">${mark(0, 0, 64, opts)}</svg>`;

const r = (x, y, w, h, fill, rx = 0, more = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${more}/>`;
const line = (x1, y1, x2, y2, stroke, w = 1, more = "") => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${stroke}" stroke-width="${w}" fill="none" ${more}/>`;
// Cards are the app's panels: radius 12 and, on a light card, the panel's hairline border.
const card = (x, y, w, h, fill = C.white) => r(x, y, w, h, fill, 12, fill === C.white ? `stroke="${C.line}" stroke-width="1.5"` : "");

function page(n, title, lead, { dark = false } = {}) {
  const fg = dark ? C.paper : C.ink, mu = dark ? C.mutedD : C.muted;
  const labels = [
    [100, 62, "canvast brand guidelines", 14, mu, false],
    [1340, 62, `${String(n).padStart(2, "0")}  ${title}`, 14, mu, false],
    [100, 162, String(n).padStart(2, "0"), 20, C.spark, true],
    [100, 214, title, 56, fg, true],
    ...lead.map((t, i) => [100, 292 + i * 32, t, 20, mu, false]),
    [100, 952, "© 2026 canvast · Brand guidelines 1.0", 12, mu, false],
    [1452, 952, `${String(n).padStart(2, "0")} / 09`, 12, mu, false],
  ];
  const body = r(0, 0, PW, PH, dark ? C.ink : C.paper) + line(100, 96, 1500, 96, dark ? C.dkLine : C.line, 1.5);
  return { body, labels };
}
const svg = (body, defs = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}"><defs>${defs}<clipPath id="pg"><rect width="${PW}" height="${PH}"/></clipPath></defs>${body}</svg>`;

// 01 · Cover --------------------------------------------------------------------------------------------------------------
export const HERO = { x: 150, y: 270, size: 400 }; // (the tile whose dot holds the mark again, 1/64 the size, all the way down)
function cover() {
  let grid = "";
  for (let x = 50; x < PW; x += 50) grid += line(x, 0, x, PH, x % 200 ? C.dkGrid : C.dkGridMajor, x % 200 ? 1 : 1.5);
  for (let y = 50; y < PH; y += 50) grid += line(0, y, PW, y, y % 200 ? C.dkGrid : C.dkGridMajor, y % 200 ? 1 : 1.5);
  const body = r(0, 0, PW, PH, C.ink) + grid +
    `<g clip-path="url(#pg)">${mark(1130, -150, 1300, { tile: null, c: "#1B2A26", dot: null })}</g>` +
    mark(HERO.x, HERO.y, HERO.size) +
    line(150, 760, 1450, 760, C.dkLine, 1.5);
  const labels = [
    [150, 120, "Brand guidelines", 18, C.mutedD, false],
    [1268, 120, "1.0 · October 2026", 18, C.mutedD, false],
    [632, 452, "canvast", 168, C.paper, true],
    [640, 590, "Every point is a canvas.", 40, C.haze, false],
    [150, 832, "An endless canvas in one file: zoom without limit, draw, place pictures, all offline.", 22, C.mutedD, false],
    [150, 878, "This board was drawn in canvast itself.", 22, C.mutedD, false],
    [1136, 878, "Zoom into the orange dot.", 22, C.spark, true],
  ];
  return { name: "01 Cover", body: svg(body), labels, bg: C.ink };
}

// 02 · The idea -----------------------------------------------------------------------------------------------------------
function idea() {
  const P = page(2, "One mark, three ideas", ["A canvas, a window into it, and the point in the window. The window sits a little low and to the right, the way", "you lean in to look. Zoom into the point and it is a canvas again."]);
  const xs = [100, 580, 1060], y = 370, w = 440, h = 320;
  let b = P.body + xs.map((x) => card(x, y, w, h)).join("");
  // Canvas: a frame with its handles
  { const x = xs[0] + 140, yy = y + 80, s = 160;
    b += `<rect x="${x}" y="${yy}" width="${s}" height="${s}" rx="22" fill="none" stroke="${C.ultra}" stroke-width="16"/>`;
    for (const [hx, hy] of [[x, yy], [x + s, yy], [x, yy + s], [x + s, yy + s]]) b += r(hx - 9, hy - 9, 18, 18, C.white, 3, `stroke="${C.spark}" stroke-width="4"`); }
  // Window: cut from the frame; the dashed squares are the window at the next zoom steps (×2, ×4)
  { const x = xs[1] + 100, yy = y + 40, s = 240, k = s / 64, cx = x + DOT_C * k, cy = yy + DOT_C * k;
    b += mark(x, yy, s, { tile: null, c: C.ultra, dot: null });
    for (const [d, o] of [[WINDOW.w / 2, 0.9], [WINDOW.w, 0.45]]) b += `<rect x="${cx - d * k}" y="${cy - d * k}" width="${2 * d * k}" height="${2 * d * k}" rx="${d * k * 0.3}" fill="none" stroke="${C.spark}" stroke-width="3" stroke-dasharray="10 8" opacity="${o}"/>`; }
  // Point: the dot, with the views you pass on the way in
  { const x = xs[2] + 100, yy = y + 40, s = 240, k = s / 64, cx = x + DOT_C * k, cy = yy + DOT_C * k;
    for (const [d, o] of [[22, 0.9], [34, 0.6], [48, 0.35], [64, 0.18]]) b += `<rect x="${cx - d}" y="${cy - d}" width="${2 * d}" height="${2 * d}" rx="${d * 0.25}" fill="none" stroke="${C.spark}" stroke-width="3" opacity="${o}"/>`;
    b += mark(x, yy, s, { tile: null, c: C.ultra, dot: C.spark }); }
  const cols = [
    ["Canvas", "Everything starts as a frame:", "the rectangle you draw on."],
    ["Window", "Cut from the frame, low and right:", "you look into it, and zoom in."],
    ["Point", "The dot, in the middle of the window.", "In canvast every point holds a canvas."],
  ];
  const labels = [...P.labels];
  cols.forEach(([t, a, c2], i) => labels.push([xs[i], 752, t, 30, C.ink, true], [xs[i], 806, a, 20, C.muted, false], [xs[i], 838, c2, 20, C.muted, false]));
  return { name: "02 The idea", body: svg(b), labels, bg: C.paper };
}

// 03 · Construction -------------------------------------------------------------------------------------------------------
export const GRID = { x: 110, y: 340, u: 8.5 }; // 64 units → 544
export const MARKERS = [[3, 3], [7.3, 32], [19.4, 32], [34.17, 26.9], [34.17, 41.3], [57, 32]]; // drawn in the app, over the glyph
function construction() {
  const P = page(3, "Construction", ["A 64-unit grid. The window and the dot share one centre, a little low and right of the tile's. The glyph was built", "in canvast with the Shape tool: a rounded rectangle minus another (Subtract), flattened to one path, and the dot."]);
  const { x, y, u } = GRID, S = 64 * u;
  let b = P.body + r(x, y, S, S, C.white);
  for (let i = 0; i <= 64; i++) {
    const major = i % 8 === 0, col = major ? "#BCC7C4" : "#E1EAE8", w = major ? 1.2 : 0.8;
    b += line(x + i * u, y, x + i * u, y + S, col, w) + line(x, y + i * u, x + S, y + i * u, col, w);
  }
  b += `<rect x="${x}" y="${y}" width="${S}" height="${S}" rx="${14 * u}" fill="${C.ultra}" opacity="0.07"/>`;
  b += `<rect x="${x}" y="${y}" width="${S}" height="${S}" rx="${14 * u}" fill="none" stroke="${C.ultra}" stroke-width="2" stroke-dasharray="8 6"/>`;
  // keylines: the frame's box, and the window's two axes, which cross at the dot
  b += `<rect x="${x + FRAME.x * u}" y="${y + FRAME.x * u}" width="${FRAME.w * u}" height="${FRAME.w * u}" fill="none" stroke="${C.spark}" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  b += line(x, y + DOT_C * u, x + S, y + DOT_C * u, C.spark, 1.5, `stroke-dasharray="4 4"`) + line(x + DOT_C * u, y, x + DOT_C * u, y + S, C.spark, 1.5, `stroke-dasharray="4 4"`);
  // numbered markers (the glyph itself is drawn in the app, over the grid)
  const marks = MARKERS;
  const items = [
    ["Tile", "64 × 64 units, corner radius 14"],
    ["Margin", "14.7 units round the frame, on every side"],
    ["Frame", "34.7 units, corner radius 9.5"],
    ["Window", "19.9 units, radius 5.9; 9.5 from the top and left, 5.3 from the right and bottom"],
    ["Dot", "6.9 units, radius 1.9, in the middle of the window"],
    ["Inside the dot", "the mark again at 1/64 (six zoom levels), without end"],
  ];
  const labels = [...P.labels];
  marks.forEach(([mx, my], i) => labels.push([x + mx * u - 5, y + my * u, String(i + 1), 16, C.white, true]));
  items.forEach(([t, d], i) => {
    const yy = 380 + i * 88;
    b += `<circle cx="${790}" cy="${yy}" r="15" fill="${C.ink}"/>`;
    labels.push([785, yy, String(i + 1), 16, C.white, true], [826, yy - 12, t, 22, C.ink, true], [826, yy + 18, d, 18, C.muted, false]);
  });
  return { name: "03 Construction", body: svg(b), labels, bg: C.paper };
}

// 04 · Logo set -----------------------------------------------------------------------------------------------------------
function logos() {
  const P = page(4, "The logo set", ["Use the app icon wherever the mark stands alone. On a light or dark ground, the mark may drop its tile.", "Pick the version with the most contrast; the one-colour versions are for single-ink printing and embossing."]);
  const xs = [100, 590, 1080], ys = [370, 640], w = 420, h = 240;
  const cells = [
    [C.white, (x, y) => mark(x + 150, y + 50, 120), "App icon · primary", C.muted],
    [C.white, (x, y) => mark(x + 150, y + 50, 120, { tile: null, c: C.ultra }), "Mark on light", C.muted],
    [C.ink, (x, y) => mark(x + 150, y + 50, 120, { tile: null, c: C.paper }), "Mark on dark", C.mutedD],
    [C.white, (x, y) => mark(x + 40, y + 60, 100), "Horizontal lockup", C.muted],
    [C.white, (x, y) => mark(x + 150, y + 50, 120, { tile: null, c: C.ink, dot: C.ink }), "One colour, dark", C.muted],
    [C.ultra, (x, y) => mark(x + 150, y + 50, 120, { tile: null, c: C.white, dot: C.white }), "One colour, light", C.haze],
  ];
  let b = P.body;
  const labels = [...P.labels];
  cells.forEach(([bg, draw, cap, capc], i) => {
    const x = xs[i % 3], y = ys[Math.floor(i / 3)];
    b += card(x, y, w, h, bg) + draw(x, y);
    labels.push([x + 24, y + h - 26, cap, 14, capc, false]);
  });
  labels.push([xs[0] + 162, ys[1] + 106, "canvast", 64, C.ink, true]);
  return { name: "04 Logo set", body: svg(b), labels, bg: C.paper };
}

// 05 · Clear space and size -----------------------------------------------------------------------------------------------
export const PIXELS = { x: 760, y: 640, cell: 13 }; // the 16 px favicon, pixel by pixel (filled in from a render)
function space(pixels) {
  const P = page(5, "Space and size", ["Keep at least one dot of clear space round the tile: x is the width of the dot, 6.9/64 of the tile.", "One drawing serves every size, the favicon too: no separate small version."]);
  let b = P.body + card(100, 370, 560, 500);
  const T = 260, tx = 250, ty = 470, xu = (T * DOT.w) / 64;
  b += r(tx - xu, ty - xu, T + 2 * xu, T + 2 * xu, "none", 0, `stroke="${C.spark}" stroke-width="2" stroke-dasharray="6 5"`);
  b += mark(tx, ty, T);
  for (const [cx, cy] of [[tx - xu, ty - xu], [tx + T, ty - xu], [tx - xu, ty + T], [tx + T, ty + T]]) b += r(cx, cy, xu, xu, C.spark, 4, `opacity="0.35"`);
  // the size ladder (units here stand for screen px)
  const sizes = [128, 64, 48, 32, 24, 16];
  let x = 720; const base = 560;
  b += card(700, 370, 800, 240);
  const labels = [...P.labels, [124, 410, "Clear space", 18, C.ink, true], [tx + T / 2 - 6, ty - xu - 26, "x", 18, C.spark, true], [724, 410, "Sizes", 18, C.ink, true]];
  for (const s of sizes) {
    b += mark(x, base - s, s);
    labels.push([x, base + 24, `${s} px`, 14, C.muted, false]);
    x += s + 56;
  }
  // the favicon, pixel by pixel
  const { x: px0, y: py0, cell } = PIXELS;
  b += card(700, 630, 800, 240) ;
  if (pixels) for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
    const [R, G, B, A] = pixels[j * 16 + i];
    if (A < 8) continue;
    b += `<rect x="${px0 + 30 + i * cell}" y="${py0 + 14 + j * cell}" width="${cell - 1}" height="${cell - 1}" fill="rgb(${R},${G},${B})" opacity="${(A / 255).toFixed(3)}"/>`;
  }
  labels.push([1030, 690, "The 16 px favicon, pixel by pixel", 22, C.ink, true],
    [1030, 730, "At 16 px the frame, the window and the dot still", 18, C.muted, false],
    [1030, 760, "read apart: the dot is about 2 px, the frame 3.", 18, C.muted, false],
    [1030, 806, "Smallest sizes: 16 px on screen, 6 mm in print.", 18, C.ink, false]);
  return { name: "05 Space and size", body: svg(b), labels, bg: C.paper };
}

// 06 · Colour -------------------------------------------------------------------------------------------------------------
export const SWATCHES = [
  ["Viridian", C.ultra, "The tile, links, the main", "accent of the interface"],
  ["Spark", C.spark, "The dot. A point, never a", "field: keep it small"],
  ["Ink", C.ink, "Text, dark grounds, the", "one-colour mark"],
  ["Paper", C.paper, "Light grounds; the glyph", "on the tile"],
  ["Haze", C.haze, "Tints, selection, quiet", "text on Ink"],
];
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" · ");
function colour() {
  const P = page(6, "Colour", ["Five colours, the app's default theme. Viridian carries the brand, Spark marks the point, Ink and Paper do the rest.", "White on Viridian is 5.2 : 1, Spark on Viridian 2.7 : 1 (enough for the dot, not for text)."]);
  let b = P.body;
  const labels = [...P.labels];
  const w = 264, gap = 20;
  SWATCHES.forEach(([name, hex, a, c2], i) => {
    const x = 100 + i * (w + gap);
    b += card(x, 370, w, 400) + `<path d="M${x} 382a12 12 0 0 1 12-12h${w - 24}a12 12 0 0 1 12 12v208h-${w}z" fill="${hex}"/>`;
    if (hex === C.paper) b += line(x, 590, x + w, 590, C.line, 1);
    labels.push([x + 22, 626, name, 24, C.ink, true], [x + 22, 662, hex, 18, C.ink, false], [x + 22, 690, `RGB ${rgb(hex)}`, 14, C.muted, false],
      [x + 22, 724, a, 14, C.muted, false], [x + 22, 746, c2, 14, C.muted, false]);
  });
  // proportions
  const parts = [[C.ultra, 0.42], [C.paper, 0.3], [C.ink, 0.2], [C.haze, 0.05], [C.spark, 0.03]];
  let x = 100;
  b += r(100, 830, 1400, 44, C.white, 12);
  b += `<clipPath id="bar"><rect x="100" y="830" width="1400" height="44" rx="12"/></clipPath><g clip-path="url(#bar)">`;
  for (const [c, f] of parts) { b += r(x, 830, 1400 * f, 44, c); x += 1400 * f; }
  b += `</g>` + r(100, 830, 1400, 44, "none", 12, `stroke="${C.line}" stroke-width="1.5"`);
  labels.push([100, 806, "In about these proportions", 16, C.ink, true]);
  return { name: "06 Colour", body: svg(b), labels, bg: C.paper };
}

// 07 · Typography ---------------------------------------------------------------------------------------------------------
function type() {
  const P = page(7, "Typography", ["Space Grotesk, in two weights: Bold for the wordmark and headings, Regular for everything else.", "Its squared curves echo the mark's rounded squares. Free under the SIL Open Font License 1.1."]);
  let b = P.body + card(100, 370, 520, 500, C.ultra) + card(660, 370, 840, 500);
  b += mark(500, 400, 90, { tile: null, c: C.paper });
  const labels = [...P.labels,
    [130, 640, "Aa", 240, C.paper, true],
    [134, 820, "Space Grotesk", 26, C.haze, true],
    [690, 420, "abcdefghijklmnopqrstuvwxyz", 30, C.ink, false],
    [690, 466, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", 30, C.ink, false],
    [690, 512, "0123456789  & @ ? ! ( ) · , .", 30, C.ink, false],
    [690, 600, "Display  64", 64, C.ink, true],
    [690, 676, "Heading  40", 40, C.ink, true],
    [690, 734, "Body text  20: what you read on the pages of this board.", 20, C.ink, false],
    [690, 772, "Caption  14: notes, sizes and credits.", 14, C.muted, false],
    [690, 830, "The wordmark is always lowercase: write canvast, also at the start of a sentence.", 16, C.ultra, true],
  ];
  return { name: "07 Typography", body: svg(b), labels, bg: C.paper };
}

// 08 · Misuse -------------------------------------------------------------------------------------------------------------
export const MISUSE = []; // the cards' corners, for the crosses drawn with the Path tool
function misuse() {
  const P = page(8, "Please don't", ["The mark works because it is exact. Use the files as they are, and keep these away from it."]);
  let b = P.body;
  const labels = [...P.labels];
  const w = 320, h = 250, s = 120;
  const items = [
    ["Make it round", (x, y) => `<g transform="translate(${x} ${y}) scale(${s / 64})"><rect width="64" height="64" rx="14" fill="${C.ultra}"/><path d="M14.7 32a17.3 17.3 0 1 0 34.6 0a17.3 17.3 0 1 0-34.6 0ZM24.2 34.2a10 10 0 1 0 20 0a10 10 0 1 0-20 0Z" fill="${C.paper}" fill-rule="evenodd"/><circle cx="34.2" cy="34.2" r="3.5" fill="${C.spark}"/></g>`],
    ["Stretch it", (x, y) => `<g transform="translate(${x - 40} ${y + 18}) scale(1.6 0.7)">${mark(0, 0, s)}</g>`],
    ["Fill the window", (x, y) => `<g transform="translate(${x} ${y}) scale(${s / 64})"><rect width="64" height="64" rx="14" fill="${C.ultra}"/><rect x="${FRAME.x}" y="${FRAME.x}" width="${FRAME.w}" height="${FRAME.w}" rx="${FRAME.r}" fill="${C.paper}"/>${dotRect(C.spark)}</g>`],
    ["Move the dot", (x, y) => `<g transform="translate(${x} ${y}) scale(${s / 64})"><rect width="64" height="64" rx="14" fill="${C.ultra}"/><path d="${GLYPH}" fill="${C.paper}" fill-rule="evenodd"/><rect x="38" y="10" width="${DOT.w}" height="${DOT.w}" rx="${DOT.r}" fill="${C.spark}"/></g>`],
    ["Change its colours", (x, y) => mark(x, y, s, { tile: "#2A33D6", c: "#FFF4C2", dot: "#E83E8C" })],
    ["Add a gradient", (x, y) => mark(x, y, s, { tile: "url(#bad)" })],
    ["Add outlines or shadows", (x, y) => mark(x + 10, y + 10, s, { tile: "#000000", c: "none", dot: null, tileAttrs: `opacity="0.35"` }) + mark(x, y, s, { tileAttrs: `stroke="${C.spark}" stroke-width="3"` })],
    ["Put it on a busy ground", (x, y) => ""],
  ];
  const defs = `<linearGradient id="bad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9B5CF6"/><stop offset="1" stop-color="#F472B6"/></linearGradient>`;
  items.forEach(([cap, draw], i) => {
    const x = 100 + (i % 4) * (w + 40), y = 370 + Math.floor(i / 4) * (h + 40);
    if (i === 7) {
      b += `<g clip-path="url(#busy)">`;
      for (let k = 0; k < 14; k++) b += `<path d="M${x - 200 + k * 48} ${y + h}L${x + k * 48} ${y}" stroke="${[C.ultra, C.spark, "#2F9A86", "#FFC79A", "#008672"][k % 5]}" stroke-width="30"/>`;
      b += `</g>` + mark(x + 100, y + 40, s);
      b = b.replace("<g clip-path=\"url(#busy)\">", `<clipPath id="busy"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/></clipPath><g clip-path="url(#busy)">`);
    } else b += card(x, y, w, h) + draw(x + 100, y + 40);
    MISUSE.push([x + w - 34, y + 34]);
    b += `<circle cx="${x + w - 34}" cy="${y + 34}" r="18" fill="${C.red}"/>`;
    labels.push([x, y + h + 18, cap, 16, C.ink, false]);
  });
  return { name: "08 Please don't", body: svg(b, defs), labels, bg: C.paper };
}

// 09 · In use -------------------------------------------------------------------------------------------------------------
function inUse() {
  const P = page(9, "In use", ["The tile is the favicon, the app icon and the face of every .canvast file. Let it sit on Viridian or Ink,", "and let the frame run off an edge when there is room: the canvas goes on beyond it."]);
  let b = P.body;
  const labels = [...P.labels];
  // a browser tab
  b += card(100, 370, 640, 220, "#DEEBE8") + r(120, 392, 300, 52, C.white, 12) + mark(138, 406, 24) + r(120, 444, 600, 126, C.white, 10) + r(140, 462, 560, 40, "#ECF4F2", 20);
  labels.push([176, 418, "Untitled · canvast", 16, C.ink, false], [164, 482, "file:///home/me/canvast.html", 15, C.muted, false], [100, 610, "Favicon · 16 and 32 px, the same drawing", 14, C.muted, false]);
  // a dock
  b += card(780, 370, 720, 220, "#B7D1CA") + r(860, 470, 560, 100, "#FFFFFF", 26, `opacity="0.55"`);
  const greys = ["#7C958F", "#A4BAB4", "#627B74", "#91ABA4"];
  [0, 1, 2, 3, 4].forEach((k) => { const x = 880 + k * 108; b += k === 2 ? mark(x, 478, 84) + `<circle cx="${x + 42}" cy="${582}" r="4" fill="${C.ink}"/>` : r(x, 478, 84, 84, greys[k % 4], 20); });
  labels.push([780, 610, "App icon · the primary tile, no extra effects", 14, C.muted, false]);
  // a .canvast file
  b += card(100, 650, 300, 240);
  b += `<path d="M200 672h70l40 40v140a10 10 0 0 1-10 10H200a10 10 0 0 1-10-10V682a10 10 0 0 1 10-10z" fill="${C.white}" stroke="${C.line}" stroke-width="2"/><path d="M270 672v30a10 10 0 0 0 10 10h30" fill="none" stroke="${C.line}" stroke-width="2"/>`;
  b += mark(214, 740, 72);
  labels.push([206, 838, ".canvast", 16, C.ink, true], [100, 910, "Document icon", 14, C.muted, false]);
  // a social card (1200 × 630)
  const sx = 440, sy = 650, sw = 457, sh = 240;
  b += `<clipPath id="soc"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="12"/></clipPath><g clip-path="url(#soc)">` + r(sx, sy, sw, sh, C.ultra) + mark(sx + 190, sy - 30, 340, { tile: null, c: "#1C8D7A", dot: C.spark }) + `</g>`;
  labels.push([sx + 30, sy + 150, "canvast", 48, C.white, true], [sx + 32, sy + 196, "An endless canvas, offline.", 16, C.haze, false], [sx, 910, "Social card · 1200 × 630", 14, C.muted, false]);
  // the opening screen
  const lx = 937, ly = 650, lw = 563, lh = 240;
  b += card(lx, ly, lw, lh, C.ink) + mark(lx + lw / 2 - 36, ly + 56, 72) + r(lx + lw / 2 - 60, ly + 160, 120, 4, C.dkLine, 2) + r(lx + lw / 2 - 60, ly + 160, 46, 4, C.spark, 2);
  labels.push([lx, 910, "Opening screen · the tile on Ink", 14, C.muted, false]);
  return { name: "09 In use", body: svg(b), labels, bg: C.paper };
}

export const pages = (pixels) => [cover(), idea(), construction(), logos(), space(pixels), colour(), type(), misuse(), inUse()];
