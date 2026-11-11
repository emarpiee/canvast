// Retroma, the default theme: its colours, light and every customisation, as one pure function of its settings.
// A port of the reviewed demo (the owner's Retroma for Obsidian, adapted to canvast): every number is the demo's own, so the look is
// the same (tests/unit/retroma.test.ts compares the output with the demo's for every preset, light and dark). OKLCH throughout: colours
// are kept inside sRGB and texts are moved only as far as needed for contrast; a colour the person chose is kept exactly.
// Inside, settings and colours are plain objects as in the demo (typed loosely); the API at the end is typed.
// @ts-nocheck: the demo's code kept as it is (its numbers are the spec); typed at the API below and checked number by number by the golden test.
type Any = any;
type Col = { L: number; C: number; h: number; a: number; user?: boolean };

function oklchToLinear(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707612701 * s];
}
const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
const maxC = (L, h) => { let lo = 0, hi = 0.4; for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (inGamut(oklchToLinear(L, mid, h))) lo = mid; else hi = mid; } return lo; };
const norm = (h) => ((h % 360) + 360) % 360;
export const rc = (L: number, C: number, h: number, a = 1): Col => { L = Math.max(0, Math.min(1, L)); return { L, C: Math.min(Math.max(0, C), maxC(L, norm(h))), h: norm(h), a }; };
const css = (c) => `oklch(${c.L.toFixed(4)} ${c.C.toFixed(4)} ${c.h.toFixed(1)}${c.a < 1 ? ` / ${+c.a.toFixed(3)}` : ""})`;
const toSrgb = (c) => oklchToLinear(c.L, c.C, c.h).map((v) => Math.max(0, Math.min(1, v)));
const enc = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055), dec = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const over = (c, g) => { const f = toSrgb(c), b = toSrgb(g); return f.map((v, i) => dec(enc(v) * c.a + enc(b[i]) * (1 - c.a))); };
const Y = (lin) => 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
const contrast = (fg, bg) => { const a = Y(over(fg, bg)), b = Y(toSrgb(bg)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
function solveL(make, bg, want, min) { const dir = Y(toSrgb(bg)) > 0.18 ? -1 : 1; let L = want; for (let i = 0; i < 80 && contrast(make(L), bg) < min; i++) L += dir * 0.01; return Math.max(0, Math.min(1, L)); }
const fix = (c, bg, min) => (c.user || contrast(c, bg) >= min ? c : rc(solveL((L) => rc(L, c.C, c.h, c.a), bg, c.L, min), c.C, c.h, c.a));
function hexToOklch(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => dec(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: norm((Math.atan2(B, A) * 180) / Math.PI) };
}
const hexCol = (hex, a = 1) => { const o = hexToOklch(hex); return rc(o.L, o.C, o.h, a); };



const B3 = (sL, sO, hL, hO, aSL, aSO, aHL, aHO) => ({ n: { sT: 3, sL, sO, sB: 0, sC: "", hT: 3, hL, hO, hB: 0, hC: "" }, a: { sT: 3, sL: aSL, sO: aSO, sB: 0, sC: "", hT: 3, hL: aHL, hO: aHO, hB: 0, hC: "" } });
const FONTS = [['"Atkinson Hyperlegible", system-ui, sans-serif', "Atkinson Hyperlegible"], ["system-ui, sans-serif", "System UI"], ['"Space Grotesk", system-ui, sans-serif', "Space Grotesk"], ['"Courier Prime", monospace', "Courier Prime"], ['"Fraunces", Georgia, serif', "Fraunces"], ['"Special Elite", monospace', "Special Elite"], ['"VT323", monospace', "VT323"], ['"Press Start 2P", monospace', "Press Start 2P"], ['"Caveat", cursive', "Caveat"], ['"DM Mono", monospace', "DM Mono"]];
const INHERIT = [["inherit", "The theme font"], ...FONTS];
const BASE = {
  // colour
  mode: "light", hue: 293, chroma: 0.218, accentL: 0.6, cf: 0.4, cfDark: 0.3, lDark: 0.16, scheme: "330,30", boost: 0, grey: false,
  txtCLt: 0.1, txtCDk: 0.15, txtLLt: 0.5, txtLDk: 0.75, cText: "", cMuted: "", cFaint: "", cWorkspace: "", cPane: "", cPaneContent: "", cRingO: "", cRingI: "", cSelection: "",
  sel: "accent", selhue: 200,
  // buttons
  btn: "skeuo", em: "lt", es: "n", lt: { angle: 135, iconL: 0.5, ...B3(0.4, 0.7, 1, 0.8, 0.2, 0.7, 0.8, 0.3) }, dk: { angle: 135, iconL: 0.75, ...B3(0.1, 1, 1, 0.3, 0.2, 0.7, 0.8, 0.3) },
  cfact: 2, ol: 1, olStyle: "solid", hoverOl: 1, hoverOlStyle: "solid", br: 6, corner: "round", press: 60, elev: 0, tintsh: "retroma",
  cBtn: "", cBtnHover: "", cBtnOn: "", cIcon: "", cIconOn: "", cOutline: "", cOutlineHover: "",
  // interface
  font: FONTS[0][0], text: 1, iconw: 2, dens: "1", r: 10, paneOut: 14, paneIn: 14, fwo: 2, fwi: 2, ring: "groove", ringOStyle: "solid",
  simpleHdr: false, hdrR: 10, cHdr: "", cHdrText: "",
  tabStyle: "key", tabR: 8, tabFontOn: "inherit", tabFontOff: "inherit", cTabOutline: "", cTabOn: "", cTabOff: "",
  simpleMenu: false, menuR: 10, menuOl: 1, menuOlStyle: "solid", cMenu: "", cMenuOl: "", modalCorner: "round", modalR: 14, cScrim: "",
  statusH: 30, cStatus: "", cStatusText: "", focused: true, cTitle: "", cTitleText: "", cTitleOff: "", cTitleTextOff: "",
  sbW: 10, sbR: 8, tagR: 999, tagOl: 1, tagLeft: 1, tagW: 700, tagSize: 1, tagPad: 9, tagFont: "inherit", imgR: 6, imgOl: 1, cImgOl: "",
  // canvas and library
  ground: "theme", cCanvas: "", grid: "dots", gridk: 0.5, cDots: "", canvasFont: "inherit", simpleBars: false, fadeOnPan: true, fadeOut: 0, fadeIn: 0.3, fadeSpeed: 200, controlsAt: "br",
  ccardR: 10, ccardOl: 2, ccardPad: 10, cCcard: "", cCcardOl: "", grpR: 14, grpOl: 2, cGrp: "", cGrpOl: "", mat: "white",
  rainbow: true, folderIcon: "folder", folderR: 6, folderOl: 1, folderOlStyle: "solid", folderLeft: 1, folderOpenOl: 2, indentStyle: "solid", indentW: 2, treeGap: 3, wrap: "nowrap", folderFont: "inherit", sideW: 190, cFolderPane: "",
  simplePdf: false, cPdf: "", cPdfThumbs: "", pdfThumbR: 6,
  zen: false, zenO: 0.15, pinTop: false,
  simpleNav: false, cMobileTool: "", mSideW: 75,
  // notes
  edFont: "inherit", cEd: "", cEdHdr: "", edWidth: 680, edLh: 1.6, pattern: "none", patZoom: 22, patW: 1, cPattern: "",
  hFont: "inherit", rainbowH: true, hScale: 1, h1W: 800, h2W: 700, h3W: 700, hLh: 1.2, hGap: 18, hash: false, hashO: 0.4, hashS: 0.7, hUl: "h1h2", hUlStyle: "solid", hUlW: 2, hUlOff: 6, cHUl: "",
  bqFont: "inherit", cBq: "", cBqOl: "", bqR: 8, bqOl: 1, bqLeft: 5, bqIn: 14,
  coR: 10, coOl: 1.5, coOp: 0.7, coPad: 12, coTW: 700, coTS: 1, coColourText: false, retroCallout: false, cTip: "", cWarn: "",
  codeFont: '"DM Mono", monospace', codeSize: 0.88, codeR: 8, codeOl: 1, codeOlStyle: "solid", cCode: "", cCodeOl: "", icodeR: 5, icodeOl: 1, icodeOlStyle: "solid", cIcode: "", cIcodeText: "",
  cSynK: "", cSynS: "", cSynF: "", cSynC: "", cSynN: "",
  cLink: "", cElink: "", linkW: 700, linkUl: "underline", linkUlStyle: "solid", linkUlW: 1.5, linkUlOff: 3, cLinkUl: "",
  cMarker: "", cGuide: "", guideW: 2, listIndent: 22, listGap: 2, paraGap: 12, paraIndent: 0, cPara: "", cBold: "", cItal: "", boldFont: "inherit", italFont: "inherit",
  checkR: 4, doneStrike: true, acb: true, acbText: true,
  tblR: 8, tblOl: 1, tblOlStyle: "solid", cTh: "", cThText: "", thW: 700, thFont: "inherit", cTd: "", tdPad: 6, tdOl: 1, tdVa: "top", cTsel: "", tselW: 2,
  hrStyle: "dashed", hrW: 2, hrGap: 18, cHr: "", fnSize: 0.8, cMark: "", markR: 4, markPad: 3, markFont: "inherit", cStrike: "",

  // ---- v4 (each default draws exactly what v3 drew) ----
  motion: "system", rot1: 330, rot2: 30, cFocus: "", focusW: 3, focusStyle: "solid", inputStyle: "well", cSuccess: "", cWarning: "", cError: "",
  cornerPane: "", cornerContent: "", cornerHdr: "", cornerMenu: "", cornerFolder: "", cornerCallout: "", cornerCode: "", cornerBq: "", cornerCard: "", cornerProps: "",
  ringIStyle: "solid", paneSh: 4, simplePanes: false, tabOlStyle: "solid", tabAngle: -1, tabHl: 0,
  cCardBg: "", cCardOl: "", cCardOlHover: "", cCardCover: "", cardR: -1, cardOl: -1, cardOlStyle: "solid", libItems: "cards",
  cLvHdr: "", lvHdrW: 700, cLvHover: "", lvRowH: 34, cLvActive: "", fileR: 6, fileFont: "inherit", fileOlStyle: "solid", fileWrap: "nowrap",
  folderStyle: "fill", fi: 1, fc: { 1: "", 2: "", 3: "", 4: "", 5: "", 6: "", 7: "", 8: "", 9: "", 10: "", 11: "", 12: "", 13: "", 14: "", 15: "" }, cFolderBg: "", cFolderBgOpen: "", cFolderText: "", cFolderTextOpen: "", cFolderHdr: "", simpleFolderHdr: false, simpleFolderContent: false,
  cMatch: "", cResHdr: "", cResBody: "", previewW: 300, previewH: 130,
  cZenBg: "", zenDelay: 0, pinTitle: false, pinStatus: false, pinLeft: false, pinRight: false, mSbW: 4, mSbR: 4, navAt: "bottom",
  simpleEdHdr: false, simpleEdBox: false, edTop: 22,
  hl: 1, hd: { 1: { c: "", s: 1.9, w: 0, lh: 0, ul: "", ulStyle: "", ulW: 0, ulOff: -1, ulC: "" }, 2: { c: "", s: 1.45, w: 0, lh: 0, ul: "", ulStyle: "", ulW: 0, ulOff: -1, ulC: "" }, 3: { c: "", s: 1.15, w: 0, lh: 0, ul: "", ulStyle: "", ulW: 0, ulOff: -1, ulC: "" }, 4: { c: "", s: 1.05, w: 0, lh: 0, ul: "", ulStyle: "", ulW: 0, ulOff: -1, ulC: "" }, 5: { c: "", s: 0.95, w: 0, lh: 0, ul: "", ulStyle: "", ulW: 0, ulOff: -1, ulC: "" }, 6: { c: "", s: 0.9, w: 0, lh: 0, ul: "", ulStyle: "", ulW: 0, ulOff: -1, ulC: "" } },
  ct: "note", co: {}, coTPad: -1, at: "/", acbEach: false, acbc: {},
  cSynNormal: "", cSynI: "", cSynO: "", cSynP: "", cSynU: "", cSynT: "",
  linkFont: "inherit", elinkFont: "", eUl: "", eUlStyle: "", eUlW: -1, eUlOff: -1, cElinkUl: "",
  cMarkerCollapsed: "", listNum: "decimal", bullets: "browser", bulletS: 6, bulletR: 999, cBi: "", biFont: "", cStrikeText: "", bqOut: 0, picTop: 8, picBottom: 8,
  cTdText: "", cTdOl: "", cTselOl: "",
  simpleProps: false, cProps: "", cPropsOl: "", cProp: "", propsR: 10, propsOl: 1, propsOlStyle: "solid", propR: 6, propGap: 6, propsGap: 8,
  schedOn: false, schedDay: "Retroma", schedNight: "Green CRT Terminal", schedDayFrom: 7, schedNightFrom: 19, schedSim: -1,
  // filters
  greyBg: false, greyText: false, greyFiles: false, greyImg: false, greyVid: false, greyAll: false,
  crt: false, crtMove: false, scan: 4, cScan1: "", cScan2: "", cVigIn: "", cVigOut: "",
  glow: false, g1: 0.7, g2: 0.4, g3: 0.2, g1s: 2, g2s: 6, g3s: 12, pixelIcons: false, pixelW: 2,
};
const clone = (o) => JSON.parse(JSON.stringify(o));
// (as in v2: a preset sets the thickness and blur of the shadow and the highlight, the same at rest and pressed)
const P3 = (mode, sT, sB, hT, hB) => { const m = clone(BASE[mode]); for (const s of ["n", "a"]) Object.assign(m[s], { sT, sB, hT, hB }); return m; };
const PRESETS = [
  ["Retroma", "#8a5cf5", {}],
  ["Warm Earthy Vintage", "#FFDF7F", { ring: "ridge", fwo: 2, fwi: 1 }],
  ["Blancka", "#8a5cf5", { grey: true, lDark: 0.08 }],
  ["Warm Strawberry", "#F55C5C", { scheme: "30,330", cf: 0.45, br: 8, r: 12, lt: P3("lt", 4, 2, 6, 16) }],
  ["Y2K Holographic", "#C04CFD", { scheme: "210,150", cf: 0.5, r: 16, fwo: 2, fwi: 1, font: FONTS[2][0], lt: P3("lt", 6, 4, 6, 16) }],
  ["Green CRT Terminal", "#1ED573", { mode: "dark", scheme: "0,0", btn: "neu", r: 14, lDark: 0.05, crt: true, scan: 8, glow: true, font: FONTS[6][0], text: 1.15, dk: P3("dk", 2, 0, 3, 0) }],
  ["Gray Newspaper", "#9E9A95", { scheme: "0,0", btn: "neu", r: 6, fwo: 1, fwi: 1, ring: "ridge", grey: true, font: FONTS[3][0] }],
  ["Warm Newspaper", "#9C8D7B", { scheme: "0,180", btn: "neu", r: 6, fwo: 1, fwi: 1, ring: "ridge", font: FONTS[5][0] }],
];


const CO_KINDS = { note: 250, abstract: 200, summary: 200, tldr: 200, info: 250, todo: 250, tip: "tip", hint: "tip", important: 200, success: 145, check: 145, done: 145, question: 60, help: 60, faq: 60, warning: "warn", caution: "warn", attention: "warn", failure: 25, fail: 25, missing: 25, danger: 25, error: 25, bug: 25, example: 300, quote: "grey", cite: "grey" };
const ACB_KINDS = [["/", "Incomplete"], ["-", "Cancelled"], [">", "Forwarded"], ["<", "Scheduling"], ["?", "Question"], ["!", "Important"], ["*", "Star"], ['"', "Quote"], ["l", "Location"], ["b", "Bookmark"], ["i", "Information"], ["S", "Savings"], ["I", "Idea"], ["p", "Pros"], ["c", "Cons"], ["f", "Fire"], ["k", "Key"], ["w", "Win"], ["u", "Up"], ["d", "Down"], ["D", "Draft pull request"], ["P", "Open pull request"], ["M", "Merged pull request"]];

const FOLDER_ICON_KINDS = ["folder", "chevron", "dot", "none"] as const;
export { FONTS, BASE, PRESETS, CO_KINDS, ACB_KINDS, FOLDER_ICON_KINDS, clone, hexToOklch, css, contrast };

/** A picked accent colour as Retroma keeps it: hue, chroma and lightness (and the colour itself). */
export function accentFromHex(hex: string): { hue: number; chroma: number; accentL: number; hex: string } {
  const o = hexToOklch(hex);
  return { hue: Math.round(o.h), chroma: +o.C.toFixed(3), accentL: +o.L.toFixed(2), hex };
}

/** A preset's settings: Retroma's defaults, the preset over them, its accent. */
export function presetSettings(name: string): Any | null {
  const p = PRESETS.find((x) => x[0] === name);
  return p ? { ...clone(BASE), ...clone(p[2]), ...accentFromHex(p[1]) } : null;
}

export interface RetromaOutput {
  /** Custom properties for :root, by name (each starts with --). */
  vars: Record<string, string>;
  /** Switches for :root's dataset (on/off and a few words). */
  data: Record<string, string>;
  /** Each rainbow folder's colours (1 to 15). */
  folders: Array<{ bg: string; bgOpen: string; fg: string; fgOpen: string; ol: string }>;
  /** Each callout kind's colour, and each alternative checkbox's. */
  callouts: Record<string, string>;
  checkboxes: Record<string, string>;
  /** What is not a custom property: the canvas grid, the editor's pattern, where the zoom controls sit, pins, classes. */
  parts: Record<string, string | boolean>;
}

/** The theme for these settings, in light or dark, with or without movement. */
export function computeRetroma(settings: Any, o: { dark: boolean; reducedMotion: boolean }): RetromaOutput {
  const S: Any = settings;
  const dark = (): boolean => o.dark;
const own = (hex, fallback, a = 1) => (hex ? { ...hexCol(hex, a), user: true } : fallback);
const stillNow = (): boolean => S.motion === "reduce" || (S.motion === "system" && o.reducedMotion);
const contrastMix = (fg, top, ground) => { const b = Y(over(top, ground)), a = Y(toSrgb(fg)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
/** A text on a see-through ground, its lightness moved only as far as needed for `min` (none when it already passes, or when it is your own colour). */
const fixOn = (c, top, ground, min) => { if (c.user || contrastMix(c, top, ground) >= min) return c; const dir = Y(over(top, ground)) > 0.18 ? -1 : 1; let L = c.L; for (let i = 0; i < 80 && contrastMix(rc(L, c.C, c.h), top, ground) < min; i++) L += dir * 0.01; return rc(L, c.C, c.h); };


function palette() {
  const [rot1, rot2] = S.scheme === "custom" ? [S.rot1, S.rot2] : S.scheme.split(",").map(Number);
  const H = S.hue, H1 = H + rot1, H2 = H + rot2, D = dark();
  const C = S.chroma, cf = S.grey || S.greyBg ? 0 : D ? S.cfDark : S.cf, bg = C * cf, b = S.boost;
  const tC = S.greyText ? 0 : C * (D ? S.txtCDk : S.txtCLt) * 4;   // Retroma's text chroma (0.1 light, 0.15 dark) on the accent's
  const tL = D ? S.txtLDk : S.txtLLt;
  const T = {};
  if (!D) {
    T.paper = rc(0.98, bg, H1); T.pane = rc(0.93, bg, H1); T.paneAlt = rc(0.90, bg, H1); T.frame = rc(0.80, bg, H); T.frameDeep = rc(0.35, bg * 1.2, H);
    T.btnBg = T.paper; T.btnHover = rc(1, bg, H); T.btnOn = rc(0.85, bg, H1); T.field = rc(1, bg, H1); T.chip = T.pane;
    T.second = rc(0.86, C * cf * 1.5, H2);
    T.fg = rc(tL - b * 0.2, tC, H); T.fgMuted = rc(tL * 0.8 - b * 0.15, tC, H); T.fgFaint = rc(Math.min(0.85, tL * 1.4), tC, H);
    T.icon = rc(S.lt.iconL, tC, H); T.outline = rc(0.2, C * cf * 2 * cf, H);
  } else {
    const la = S.lDark;
    T.paper = rc(la, bg, H1); T.pane = rc(la - 0.02, bg, H1); T.paneAlt = rc(la - 0.04, bg, H1); T.frame = rc(la - 0.06, bg, H); T.frameDeep = rc(Math.max(0.03, la - 0.1), bg, H);
    T.btnBg = T.paper; T.btnHover = rc(la - 0.06 + 0.4, bg, H); T.btnOn = rc(Math.max(0.05, la - 0.11), bg, H1); T.field = rc(Math.max(0.03, la - 0.08), bg, H1); T.chip = T.pane;
    T.second = rc(0.32, C * cf * 1.5, H2);
    T.fg = rc(tL + b * 0.2, tC, H); T.fgMuted = rc(tL * (14 / 15) + b * 0.2, tC, H); T.fgFaint = rc(tL * (2 / 3), tC, H);
    T.icon = rc(S.dk.iconL, tC, H); T.outline = rc(0.5 + b * 0.25, C * cf * 2 * cf, H);
  }
  // your colours (any of these left empty keeps Retroma's)
  T.frame = own(S.cWorkspace, T.frame); T.pane = own(S.cPane, T.pane); T.paneContent = own(S.cPaneContent, T.pane);
  T.btnBg = own(S.cBtn, T.btnBg); T.btnHover = own(S.cBtnHover, T.btnHover); T.btnOn = own(S.cBtnOn, T.btnOn);
  T.fg = own(S.cText, T.fg); T.fgMuted = own(S.cMuted, T.fgMuted); T.fgFaint = own(S.cFaint, T.fgFaint);
  T.icon = own(S.cIcon, T.icon); T.iconOn = own(S.cIconOn, T.fg); T.outline = own(S.cOutline, T.outline); T.outlineHover = own(S.cOutlineHover, T.outline);
  // fixes, only where a pair falls short
  const k = 4.5 + b;
  T.fg = fix(T.fg, T.pane, k);
  T.fgMuted = [T.pane, T.paneAlt, T.btnBg, T.btnOn].reduce((c, g) => fix(c, g, k), T.fgMuted);
  T.icon = fix(T.icon, T.btnBg, 3); T.iconOn = fix(T.iconOn, T.btnOn, k);
  T.fgOnFrame = fix(T.fg, T.frame, k); T.fgOnFrameMuted = fix(T.fgMuted, T.frame, k);
  T.fgOnOn = fix(T.fg, T.btnOn, k); T.fgOnSecond = fix(T.fg, T.second, k);
  T.onFrameDeep = fix(rc(D ? 0.85 : 0.97, bg, H), T.frameDeep, k);
  T.outline = fix(T.outline, T.pane, 3);
  // the accent as picked; its lightness moves only if its text falls under 4.5:1
  T.accent = rc(S.accentL, C, H); T.onAccent = rc(1, D ? C * 0.15 : bg * 0.1, H1);
  if (contrast(T.onAccent, T.accent) < k) {
    const ink = rc(0.17, C * 0.3, H);
    const w = rc(solveL((L) => rc(L, C, H), T.onAccent, S.accentL, k), C, H), i = rc(solveL((L) => rc(L, C, H), ink, S.accentL, k), C, H);
    if (Math.abs(w.L - S.accentL) <= Math.abs(i.L - S.accentL)) T.accent = w; else { T.accent = i; T.onAccent = ink; }
  }
  T.accentHover = rc(T.accent.L + (Y(toSrgb(T.onAccent)) > 0.5 ? -0.04 : 0.04), C, H);
  T.focus = own(S.cFocus, rc(0.5, C, H, 0.6), 0.8);
  T.selection = own(S.cSelection, rc(D ? 0.75 : 0.25, C * cf, H, 0.2), 0.35);
  // headers, tabs, menus, title bar, status bar
  T.hdr = own(S.cHdr, T.pane); T.hdrFg = fix(own(S.cHdrText, T.fg), T.hdr, k); T.mhdr = own(S.cHdr, T.frame); T.mhdrFg = fix(own(S.cHdrText, T.fg), T.mhdr, k);
  T.tabOutline = own(S.cTabOutline, T.outline); T.tabOn = fix(own(S.cTabOn, T.fg), T.pane, k); T.tabOff = fix(own(S.cTabOff, T.fgMuted), T.frame, k);
  T.menu = own(S.cMenu, T.btnBg); T.menuOl = own(S.cMenuOl, T.outline);
  T.title = S.focused ? own(S.cTitle, T.frame) : own(S.cTitleOff, T.frame);
  T.titleFg = fix(S.focused ? own(S.cTitleText, T.fgOnFrame) : own(S.cTitleTextOff, T.fgOnFrameMuted), T.title, S.focused ? k : 3);
  T.status = own(S.cStatus, T.paneAlt); T.statusFg = fix(own(S.cStatusText, T.fgMuted), T.status, k); T.info = own(S.cStatus, T.frameDeep); T.infoFg = fix(own(S.cStatusText, T.onFrameDeep), T.info, k);
  // canvas, cards on it, groups
  const sh = S.sel === "comp" ? H + 180 : S.sel === "custom" ? S.selhue : H;
  T.canvas = own(S.cCanvas, S.ground === "grey" ? rc(D ? 0.42 : 0.62, 0, 0) : S.ground === "dark" ? rc(0.18, 0, 0) : (D ? T.paneAlt : T.paper));
  const canvasDark = Y(toSrgb(T.canvas)) < 0.18;
  T.grid = own(S.cDots, rc(canvasDark ? T.canvas.L + 0.12 + S.gridk * 0.2 : T.canvas.L - 0.1 - S.gridk * 0.25, S.ground === "theme" ? bg * 1.5 : 0, H, 0.35 + S.gridk * 0.65));
  T.fgOnCanvas = fix(rc(canvasDark ? 0.9 : 0.25, C * cf, H), T.canvas, k);
  T.select = fix(rc(canvasDark ? 0.75 : S.accentL, C, sh), T.canvas, 3);
  T.ccard = own(S.cCcard, T.btnBg); T.ccardOl = own(S.cCcardOl, T.outline); T.grp = own(S.cGrp, rc(T.canvas.L + (canvasDark ? 0.05 : -0.04), bg, H, 0.5)); T.grpOl = own(S.cGrpOl, rc(canvasDark ? 0.6 : 0.5, C * cf, H));
  T.mat = S.mat === "white" ? rc(1, 0, 0) : S.mat === "grey" ? rc(0.6, 0, 0) : S.mat === "black" ? rc(0.12, 0, 0) : T.paper;
  T.imgOl = own(S.cImgOl, T.outline);
  T.rule = { ...T.outline, a: 0.22 };
  T.scrim = own(S.cScrim, D ? rc(0.05, bg, H, 0.6) : rc(0.25, bg * 2, H, 0.4), 0.45);
  T.paneInner = rc(0.25, bg * 2, H, 0.5);
  T.danger = S.cError ? own(S.cError, null) : fix(rc(D ? 0.72 : 0.5, 0.2, 25), T.pane, k);
  // notices: success, warning, error
  const tone = (hex, h, c) => own(hex, rc(D ? 0.34 : 0.91, c, h));
  T.ok = tone(S.cSuccess, 145, 0.08); T.warn = tone(S.cWarning, 80, 0.09); T.err = tone(S.cError, 25, 0.08);
  T.okFg = fix(rc(D ? 0.92 : 0.3, 0.1, 145), T.ok, k); T.warnFg = fix(rc(D ? 0.92 : 0.3, 0.1, 80), T.warn, k); T.errFg = fix(rc(D ? 0.92 : 0.3, 0.1, 25), T.err, k);
  T.hover = rc(D ? 0.9 : 0.5, bg, H, 0.1);
  // rings
  T.ringO = own(S.cRingO, D ? rc(T.frame.L + 0.08, T.frame.C, T.frame.h) : rc(0.8, T.frame.C, T.frame.h));
  T.ringI = own(S.cRingI, D ? rc(T.pane.L + 0.1, T.pane.C, T.pane.h) : rc(0.9, T.pane.C, T.pane.h));
  // folders: the rainbow (15 hues round the wheel from the accent), or the theme's own colour
  T.folders = Array.from({ length: 15 }, (_, i) => S.rainbow && !S.greyFiles ? rc(D ? 0.3 : 0.9, C * 0.35, H + i * 24) : rc(D ? 0.2 : 0.95, S.greyFiles ? 0 : bg, H1));
  T.folderPane = own(S.cFolderPane, T.paneAlt);
  // PDF, phone
  T.pdf = own(S.cPdf, rc(D ? 0.22 : 0.6, bg * 0.5, H)); T.pdfThumbs = own(S.cPdfThumbs, T.paneAlt); T.mTool = own(S.cMobileTool, T.paneAlt);
  // notes
  T.ed = own(S.cEd, T.paper); T.edHdr = own(S.cEdHdr, T.paneAlt); T.pattern = own(S.cPattern, rc(D ? T.ed.L + 0.08 : T.ed.L - 0.06, bg * 1.5, H));
  const hc = (i, L) => S.rainbowH ? fix(rc(L, C * 0.9, H + i * 40), T.ed, k) : fix(T.fg, T.ed, k);
  T.h1 = hc(0, D ? 0.8 : 0.45); T.h2 = hc(1, D ? 0.8 : 0.45); T.h3 = hc(2, D ? 0.8 : 0.45);
  T.hUl = own(S.cHUl, rc(D ? 0.6 : 0.75, C * 0.7, H));
  T.para = fix(own(S.cPara, T.fg), T.ed, k); T.bold = fix(own(S.cBold, T.para), T.ed, k); T.ital = fix(own(S.cItal, T.para), T.ed, k);
  T.link = fix(own(S.cLink, rc(D ? 0.78 : 0.45, C, H + 330)), T.ed, k); T.elink = fix(own(S.cElink, rc(D ? 0.78 : 0.45, C, H + 30)), T.ed, k); T.linkUl = own(S.cLinkUl, { ...T.link, a: 0.5 });
  T.mark = own(S.cMark, rc(D ? 0.4 : 0.9, 0.12, 95), 0.75); T.strikeC = own(S.cStrike, T.danger); T.strikeFg = T.fgMuted;
  T.bq = own(S.cBq, T.paneAlt); T.bqOl = own(S.cBqOl, rc(D ? 0.6 : 0.6, C, H));
  // callouts: 27 kinds, each its own colour (Tip and Warning as before)
  T.co = {};
  for (const [kind, d] of Object.entries(CO_KINDS)) {
    const base = d === "tip" ? rc(D ? 0.72 : 0.55, 0.13, 160) : d === "warn" ? rc(D ? 0.75 : 0.6, 0.15, 70) : d === "grey" ? rc(D ? 0.72 : 0.55, 0, 0) : rc(D ? 0.72 : 0.55, 0.13, d);
    T.co[kind] = own(S.co[kind], base);
  }
  T.coTip = T.co.tip; T.coWarn = T.co.warning;
  T.coText = S.coColourText ? null : T.fg;
  T.code = own(S.cCode, T.paneAlt); T.codeOl = own(S.cCodeOl, T.outline); T.icode = own(S.cIcode, T.pane); T.icodeText = fix(own(S.cIcodeText, rc(D ? 0.8 : 0.45, C, H + 330)), T.icode, k);
  const syn = (hex, dh, L) => fix(own(hex, rc(D ? 0.8 : L, 0.14, H + dh)), T.code, k);
  T.synK = syn(S.cSynK, 0, 0.45); T.synS = syn(S.cSynS, 120, 0.45); T.synF = syn(S.cSynF, 230, 0.45); T.synN = syn(S.cSynN, 60, 0.45); T.synC = fix(own(S.cSynC, T.fgMuted), T.code, k);
  T.marker = own(S.cMarker, rc(D ? 0.75 : 0.55, C, H)); T.guide = own(S.cGuide, rc(D ? 0.4 : 0.8, bg * 2, H)); T.markerCollapsed = own(S.cMarkerCollapsed, T.marker);
  T.synO = syn(S.cSynO, 180, 0.45); T.synP = syn(S.cSynP, 300, 0.45); T.synU = fix(own(S.cSynU, T.fgMuted), T.code, k); T.synT = syn(S.cSynT, 30, 0.45); T.synI = syn(S.cSynI, 20, 0.45); T.codeFg = fix(own(S.cSynNormal, T.para), T.code, k);
  T.bi = fix(own(S.cBi, T.bold), T.ed, k); T.strikeFg = own(S.cStrikeText, T.strikeFg);
  const hcol = (n) => n <= 3 ? T["h" + n] : hc(n - 1, D ? 0.8 : 0.45);
  T.hs = [1, 2, 3, 4, 5, 6].map((n) => own(S.hd[n].c, hcol(n)));
  T.hUls = [1, 2, 3, 4, 5, 6].map((n) => (S.hd[n].ulC ? own(S.hd[n].ulC, null) : null));
  T.elinkUl = own(S.cElinkUl, T.linkUl);
  T.th = own(S.cTh, T.btnOn); T.thText = fix(own(S.cThText, T.fg), T.th, k); T.td = own(S.cTd, T.paper); T.tsel = own(S.cTsel, rc(S.accentL, C, H, 0.15), 0.25);
  T.tdText = own(S.cTdText, T.para); T.tdOl = own(S.cTdOl, T.rule); T.tselOl = own(S.cTselOl, T.select);
  // Library cards and list view, files, search, the link preview, note properties
  T.cardBg = own(S.cCardBg, T.btnBg); T.cardOl = own(S.cCardOl, T.outline); T.cardOlHover = own(S.cCardOlHover, T.cardOl); T.cardCover = S.cCardCover ? own(S.cCardCover, null) : null;
  T.lvHdr = own(S.cLvHdr, T.btnOn); T.lvHdrFg = fix(T.fg, T.lvHdr, k); T.lvHover = own(S.cLvHover, T.hover); T.lvActive = own(S.cLvActive, T.outline);
  T.match = own(S.cMatch, T.mark); T.resHdr = own(S.cResHdr, T.paneAlt); T.resHdrFg = fix(T.fg, T.resHdr, k); T.resBody = own(S.cResBody, T.paper);
  T.props = own(S.cProps, T.paneAlt); T.propsOl = own(S.cPropsOl, T.outline); T.prop = own(S.cProp, T.paper);
  T.markFg = fixOn(T.para, T.mark, T.ed, 4.5 + b); T.matchFg = fixOn(T.fg, T.match, T.resBody, 4.5 + b);
  T.zenBg = own(S.cZenBg, T.canvas); T.fhdr = own(S.cFolderHdr, rc(0, 0, 0, 0));

  T.hr = own(S.cHr, rc(D ? 0.5 : 0.7, C * cf, H)); T.acb = rc(D ? 0.6 : 0.5, 0.15, H);
  // alternative checkboxes: one colour for all, or each kind its own
  T.acbs = Object.fromEntries(ACB_KINDS.map(([key], i) => [key, own(S.acbc[key], S.acbEach ? rc(D ? 0.62 : 0.5, 0.15, H + i * 15) : T.acb)]));
  // filters
  T.scan1 = own(S.cScan1, rc(0, 0, 0, D ? 0.35 : 0.12)); T.scan2 = own(S.cScan2, rc(1, 0, 0, 0), 0); T.vigIn = own(S.cVigIn, rc(0, 0, 0, D ? 0.2 : 0.08)); T.vigOut = own(S.cVigOut, rc(0, 0, 0, D ? 0.55 : 0.25));
  return T;
}


function lighting(T) {
  const M = dark() ? S.dk : S.lt, n = M.n, a = M.a;
  const ang = (M.angle * Math.PI) / 180, lx = Math.cos(ang), ly = -Math.sin(ang), r = Math.round;
  const accentShade = (L, A, hex, mult) => hex ? css({ ...rc(L, hexToOklch(hex).C, hexToOklch(hex).h), a: A }) : S.tintsh === "neutral" ? css(rc(Math.min(L, 0.3), 0, 0, A)) : S.tintsh === "surface" ? `oklch(from var(--surf) max(0, calc(l - ${(1 - L) * 0.5})) calc(c * 1.4) h / ${A})` : css(rc(L, T.frame.C * mult, S.hue, A));
  const hl = (L, A, hex, mult) => hex ? css({ ...rc(L, hexToOklch(hex).C, hexToOklch(hex).h), a: A }) : css(rc(L, T.frame.C * mult, S.hue, A));
  const mult = dark() ? 1 : S.cf * 16, hmult = dark() ? 1 : S.cf * 4;
  const v = {};
  const nhx = r(lx * n.sT), nhy = r(ly * n.sT), nsx = r(-lx * n.hT), nsy = r(-ly * n.hT);
  const asx = r(-lx * a.sT), asy = r(-ly * a.sT), ahx = r(lx * a.hT), ahy = r(ly * a.hT);
  const nx = r(-lx * n.sT), ny = r(-ly * n.sT);
  if (S.btn === "skeuo") {
    v.raise = `inset ${nhx}px ${nhy}px ${n.sB}px ${accentShade(n.sL, n.sO, n.sC, mult)}, inset ${nsx}px ${nsy}px ${n.hB}px ${hl(n.hL, n.hO, n.hC, hmult)}`;
    v.raiseSm = `inset ${r(nhx / 2)}px ${r(nhy / 2)}px 0 ${accentShade(n.sL, n.sO, n.sC, mult)}, inset ${r(nsx / 2)}px ${r(nsy / 2)}px 0 ${hl(n.hL, n.hO, n.hC, hmult)}`;
    v.sink = `inset ${asx}px ${asy}px ${a.sB}px ${accentShade(a.sL, a.sO, a.sC, 1)}, inset ${ahx}px ${ahy}px ${a.hB}px ${hl(a.hL, a.hO, a.hC, 1)}`;
    v.px = v.py = 0;
    const f = Math.max(1, S.cfact);
    v.cx = stillNow() ? 0 : nhx / f; v.cy = stillNow() ? 0 : nhy / f; v.cxa = stillNow() ? 0 : asx / f; v.cya = stillNow() ? 0 : asy / f;
  } else if (S.btn === "neu") {
    v.raise = `${nx}px ${ny}px ${n.sB}px ${accentShade(n.sL, n.sO, n.sC, mult)}`;
    v.raiseSm = `${r(nx / 2)}px ${r(ny / 2)}px 0 ${accentShade(n.sL, n.sO, n.sC, mult)}`;
    v.sink = "0 0 0 transparent"; v.px = stillNow() ? 0 : nx; v.py = stillNow() ? 0 : ny; v.cx = v.cy = v.cxa = v.cya = 0;
  } else {
    v.raise = v.raiseSm = "0 0 0 transparent"; v.sink = `inset 0 0 0 99px ${css(T.hover)}`; v.px = v.py = v.cx = v.cy = v.cxa = v.cya = 0;
  }
  v.well = `inset ${r(nsx / 2)}px ${r(nsy / 2)}px 0 ${accentShade(n.sL, 0.25, n.sC, mult)}`;
  // tabs: a highlight of their own, at their own angle (or the buttons')
  const ta = ((S.tabAngle < 0 ? M.angle : S.tabAngle) * Math.PI) / 180;
  v.tabHl = S.tabHl > 0 ? `inset ${r(-Math.cos(ta) * S.tabHl)}px ${r(Math.sin(ta) * S.tabHl)}px 0 ${hl(n.hL, n.hO, n.hC, hmult)}` : "0 0 0 transparent";
  const e = S.elev, castCol = S.btn === "neu" ? accentShade(n.sL, n.sO, n.sC, mult) : css(rc(0.15, T.frame.C, S.hue, 0.25));
  const cast = (k, blur) => `${r(-lx * e * k)}px ${r(-ly * e * k)}px ${r(blur)}px ${castCol}`;
  v.lift = e === 0 ? "none" : S.btn === "neu" ? cast(0.6, 0) : `${cast(0.5, e * 1.5)}, ${cast(0.15, e * 0.4)}`;
  v.liftModal = e === 0 ? `${nx * 2}px ${ny * 2}px 0 ${accentShade(n.sL, n.sO, n.sC, mult)}` : S.btn === "neu" ? cast(1, 0) : `${cast(1.5, e * 4)}, ${cast(0.4, e)}`;
  v.liftSheet = `${r(-lx * 3)}px ${r(-ly * 3)}px 8px oklch(0 0 0 / 0.18)`;
  const sides = { t: [0, -1], r: [1, 0], b: [0, 1], l: [-1, 0] };
  const lit = (nn, up) => ((nn[0] * lx + nn[1] * ly) * (up ? 1 : -1) + 1) / 2;
  const shadeRing = (base, kk) => css(rc(base.L * (0.62 + 0.38 * kk) + (1 - base.L) * Math.max(0, kk - 0.5) * 0.6, base.C, base.h));
  const kind = S.ring, outerUp = kind === "ridge" || kind === "bevel-out", innerUp = kind === "groove" || kind === "bevel-out";
  for (const [s, nn] of Object.entries(sides)) {
    v[`ring-o-${s}`] = kind === "flat" ? css(T.ringO) : shadeRing(T.ringO, lit(nn, outerUp));
    v[`ring-i-${s}`] = kind === "flat" ? "transparent" : shadeRing(T.ringI, lit(nn, innerUp));
  }
  return v;
}


  const T = palette(), L = lighting(T), D = dark();
  const col = { frame: T.frame, "frame-deep": T.frameDeep, "on-frame-deep": T.onFrameDeep, pane: T.pane, "pane-content": T.paneContent, "pane-alt": T.paneAlt, paper: T.paper, canvas: T.canvas, grid: T.grid,
    "btn-bg": T.btnBg, "btn-hover": T.btnHover, "btn-on": T.btnOn, "field-bg": T.field, chip: T.chip, "second-tint": T.second,
    "outline-c": T.outline, "outline-hover": T.outlineHover, rule: T.rule, fg: T.fg, "fg-muted": T.fgMuted, "fg-on-frame": T.fgOnFrame, "fg-on-frame-muted": T.fgOnFrameMuted, "fg-on-on": T.fgOnOn, "fg-on-second": T.fgOnSecond, "fg-on-canvas": T.fgOnCanvas,
    icon: T.icon, "icon-on": T.iconOn, accent: T.accent, "accent-hover": T.accentHover, "on-accent": T.onAccent, focus: T.focus, select: T.select, selection: T.selection, mat: T.mat, scrim: T.scrim, "pane-inner": T.paneInner, danger: T.danger, hover: T.hover,
    "hdr-bg": T.hdr, "hdr-fg": T.hdrFg, "mhdr-bg": T.mhdr, "mhdr-fg": T.mhdrFg, "tab-outline": T.tabOutline, "tab-fg-on": T.tabOn, "tab-fg-off": T.tabOff, "menu-bg": T.menu, "menu-ol-c": T.menuOl, "title-bg": T.title, "title-fg": T.titleFg, "status-bg": T.status, "status-fg": T.statusFg, "info-bg": T.info, "info-fg": T.infoFg,
    "ccard-bg": T.ccard, "ccard-ol-c": T.ccardOl, "grp-bg": T.grp, "grp-ol-c": T.grpOl, "img-ol-c": T.imgOl, "folder-pane-bg": T.folderPane, "pdf-bg": T.pdf, "pdf-thumbs-bg": T.pdfThumbs, "m-tool-bg": T.mTool,
    "sb-thumb": { ...T.outline, a: 0.55 }, "sb-track": { ...T.outline, a: 0.06 }, "indent-c": T.guide,
    "ed-bg": T.ed, "ed-hdr-bg": T.edHdr, "pat-c": T.pattern, h1: T.h1, h2: T.h2, h3: T.h3, "h-ul-c": T.hUl, "para-fg": T.para, "bold-c": T.bold, "ital-c": T.ital, "link-c": T.link, "elink-c": T.elink, "link-ul-c": T.linkUl,
    mark: T.mark, "strike-c": T.strikeC, "strike-fg": T.strikeFg, "bq-bg": T.bq, "bq-ol-c": T.bqOl, "co-tip": T.coTip, "co-warn": T.coWarn, "code-bg": T.code, "code-ol-c": T.codeOl, "icode-bg": T.icode, "icode-c": T.icodeText, "icode-ol-c": T.codeOl,
    "syn-k": T.synK, "syn-s": T.synS, "syn-f": T.synF, "syn-c": T.synC, "syn-n": T.synN, marker: T.marker, guide: T.guide, "th-bg": T.th, "th-fg": T.thText, "td-bg": T.td, "td-fg": T.para, "td-ol-c": T.rule, "tbl-ol-c": T.outline, tsel: T.tsel, "tsel-ol": T.select, "hr-c": T.hr, "acb-c": T.acb,
    scan1: T.scan1, scan2: T.scan2, "vig-in": T.vigIn, "vig-out": T.vigOut,
    "ok-bg": T.ok, "ok-fg": T.okFg, "warn-bg": T.warn, "warn-fg": T.warnFg, "err-bg": T.err, "err-fg": T.errFg,
    "card-bg": T.cardBg, "card-ol-c": T.cardOl, "card-ol-hover": T.cardOlHover, "lv-hdr": T.lvHdr, "lv-hdr-fg": T.lvHdrFg, "lv-hover": T.lvHover, "lv-active": T.lvActive,
    match: T.match, "mark-fg": T.markFg, "match-fg": T.matchFg, "res-hdr": T.resHdr, "res-hdr-fg": T.resHdrFg, "res-body": T.resBody, "props-bg": T.props, "props-ol-c": T.propsOl, "prop-bg": T.prop, "zen-bg": T.zenBg, "fhdr-bg": T.fhdr,
    "marker-collapsed": T.markerCollapsed, "syn-o": T.synO, "syn-p": T.synP, "syn-u": T.synU, "syn-t": T.synT, "syn-i": T.synI, "code-fg": T.codeFg, "bi-c": T.bi, "elink-ul-c": T.elinkUl,
    h4: T.hs[3], h5: T.hs[4], h6: T.hs[5] };
  col.h1 = T.hs[0]; col.h2 = T.hs[1]; col.h3 = T.hs[2];
  col["td-fg"] = T.tdText; col["td-ol-c"] = T.tdOl; col["tsel-ol"] = T.tselOl;

  const out: Record<string, string> = {};
  for (const [k, c] of Object.entries(col)) out[`--${k}`] = css(c as Any);
  const px = (v) => `${v}px`, f = (k) => (S[k] === "inherit" ? "var(--font)" : S[k]);
  const vars = {
    "--raise": L.raise, "--raise-sm": L.raiseSm, "--sink": L.sink, "--well": L.well, "--press-x": px(L.px), "--press-y": px(L.py), "--cx": px(L.cx), "--cy": px(L.cy), "--cx-a": px(L.cxa), "--cy-a": px(L.cya),
    "--lift": L.lift, "--lift-modal": L.liftModal, "--lift-sheet": L.liftSheet,
    "--font": S.font, "--font-mono": '"DM Mono", ui-monospace, monospace', "--text": S.text, "--icon-w": S.pixelIcons ? S.pixelW : S.iconw, "--icap": S.pixelIcons ? "square" : "round", "--ijoin": S.pixelIcons ? "miter" : "round", "--ishape": S.pixelIcons ? "crispEdges" : "auto", "--dens": S.dens,
    "--outline": px(S.ol), "--outline-style": S.olStyle, "--hover-ol": px(S.hoverOl), "--hover-ol-style": S.hoverOlStyle, "--btn-r": px(S.br), "--corner": S.corner, "--press-ms": `${stillNow() ? 0 : S.press}ms`,
    "--r": px(S.r), "--pane-out": px(S.paneOut), "--pane-in": px(S.paneIn), "--ring-o-w": px(S.fwo), "--ring-i-w": px(S.fwi), "--ring-o-style": S.ringOStyle, "--hdr-r": px(S.hdrR),
    "--tab-r": px(S.tabR), "--tab-font-on": f("tabFontOn"), "--tab-font-off": f("tabFontOff"),
    "--menu-r": px(S.menuR), "--menu-ol": px(S.menuOl), "--menu-ol-style": S.menuOlStyle, "--modal-r": px(S.modalR), "--modal-corner": S.modalCorner,
    "--status-h": px(S.statusH), "--sb-w": px(S.sbW), "--sb-r": px(S.sbR), "--sb-ff": S.sbW < 8 ? "thin" : "auto",
    "--tag-r": px(S.tagR), "--tag-ol": px(S.tagOl), "--tag-left": px(S.tagLeft), "--tag-w": S.tagW, "--tag-size": S.tagSize, "--tag-pad": px(S.tagPad), "--tag-font": f("tagFont"), "--img-r": px(S.imgR), "--img-ol": px(S.imgOl),
    "--canvas-font": f("canvasFont"), "--fade-ms": `${S.fadeSpeed}ms`, "--fade-delay": "0s", "--zen-o": S.zen ? S.zenO : 0.08,
    "--ccard-r": px(S.ccardR), "--ccard-ol": px(S.ccardOl), "--ccard-pad": px(S.ccardPad), "--grp-r": px(S.grpR), "--grp-ol": px(S.grpOl),
    "--folder-r": px(S.folderR), "--folder-ol": px(S.folderOl), "--folder-ol-style": S.folderOlStyle, "--folder-left": px(S.folderLeft), "--folder-open-ol": px(S.folderOpenOl), "--indent-style": S.indentStyle, "--indent-w": px(S.indentW), "--indent": "10px", "--tree-gap": px(S.treeGap), "--wrap": S.wrap, "--folder-font": f("folderFont"), "--side-w": px(S.sideW),
    "--pdf-thumb-r": px(S.pdfThumbR), "--m-side-w": `${S.mSideW}%`,
    "--ed-font": f("edFont"), "--ed-width": px(S.edWidth), "--ed-lh": S.edLh, "--pat-z": px(S.patZoom), "--pat-w": px(S.patW),
    "--h-font": f("hFont"), "--h-scale": S.hScale, "--h1-w": S.h1W, "--h2-w": S.h2W, "--h3-w": S.h3W, "--h-lh": S.hLh, "--h-gap": px(S.hGap), "--hash-o": S.hashO, "--hash-s": `${S.hashS}em`,
    "--h-ul": S.hUl === "none" ? "none" : "underline", "--h3-ul": S.hUl === "all" ? "underline" : "none", "--h-ul-style": S.hUlStyle, "--h-ul-w": px(S.hUlW), "--h-ul-off": px(S.hUlOff),
    "--bq-font": f("bqFont"), "--bq-r": px(S.bqR), "--bq-ol": px(S.bqOl), "--bq-left": px(S.bqLeft), "--bq-in": px(S.bqIn),
    "--co-r": px(S.coR), "--co-ol": px(S.coOl), "--co-op": S.coOp, "--co-pad": px(S.coPad), "--co-t-pad": `${S.coPad * 0.6}px ${S.coPad}px`, "--co-t-w": S.coTW, "--co-t-s": `${S.coTS}em`, "--co-t-c": S.coColourText ? "var(--co-c)" : "var(--fg)",
    "--code-font": S.codeFont, "--code-size": `${S.codeSize}em`, "--code-r": px(S.codeR), "--code-ol": px(S.codeOl), "--code-ol-style": S.codeOlStyle, "--icode-r": px(S.icodeR), "--icode-ol": px(S.icodeOl), "--icode-ol-style": S.icodeOlStyle,
    "--link-w": S.linkW, "--link-ul": S.linkUl, "--link-ul-style": S.linkUlStyle, "--link-ul-w": px(S.linkUlW), "--link-ul-off": px(S.linkUlOff),
    "--guide-w": px(S.guideW), "--list-indent": px(S.listIndent), "--list-gap": px(S.listGap), "--para-gap": px(S.paraGap), "--para-indent": px(S.paraIndent), "--bold-font": f("boldFont"), "--ital-font": f("italFont"),
    "--check-r": px(S.checkR), "--done-strike": S.doneStrike ? "line-through" : "none",
    "--tbl-r": px(S.tblR), "--tbl-ol": px(S.tblOl), "--tbl-ol-style": S.tblOlStyle, "--th-w": S.thW, "--th-font": f("thFont"), "--td-pad": px(S.tdPad), "--td-ol": px(S.tdOl), "--td-va": S.tdVa, "--tsel-w": px(S.tselW),
    "--hr-style": S.hrStyle, "--hr-w": px(S.hrW), "--hr-gap": px(S.hrGap), "--fn-s": `${S.fnSize}em`, "--mark-r": px(S.markR), "--mark-pad": px(S.markPad), "--mark-font": f("markFont"),
    "--scan-w": px(S.scan), "--g1": S.g1, "--g2": S.g2, "--g3": S.g3, "--g1s": px(S.g1s), "--g2s": px(S.g2s), "--g3s": px(S.g3s),
  };
  for (const s of ["t", "r", "b", "l"]) { vars[`--ring-o-${s}`] = L[`ring-o-${s}`]; vars[`--ring-i-${s}`] = L[`ring-i-${s}`]; }
  const cs = (k) => S[k] || S.corner;
  Object.assign(vars, {
    "--corner-pane": cs("cornerPane"), "--corner-content": cs("cornerContent"), "--corner-hdr": cs("cornerHdr"), "--corner-menu": cs("cornerMenu"), "--corner-folder": cs("cornerFolder"), "--corner-callout": cs("cornerCallout"), "--corner-code": cs("cornerCode"), "--corner-bq": cs("cornerBq"), "--corner-card": cs("cornerCard"), "--corner-props": cs("cornerProps"),
    "--ring-i-style": S.ringIStyle, "--pane-sh": px(S.paneSh), "--tab-ol-style": S.tabOlStyle, "--tab-hl": L.tabHl, "--focus-w": px(S.focusW), "--focus-style": S.focusStyle,
    "--field-sh": S.inputStyle === "flat" ? "none" : S.inputStyle === "raised" ? "var(--raise-sm)" : "var(--well)",
    "--card-r": S.cardR < 0 ? "var(--r)" : px(S.cardR), "--card-ol-w": S.cardOl < 0 ? "var(--outline)" : px(S.cardOl), "--card-ol-style": S.cardOlStyle,
    "--lv-hdr-w": S.lvHdrW, "--lv-row-h": px(S.lvRowH), "--file-r": px(S.fileR), "--file-font": f("fileFont"), "--file-ol-style": S.fileOlStyle, "--file-wrap": S.fileWrap,
    "--pv-w": px(S.previewW), "--pv-h": px(S.previewH), "--zen-delay": `${S.zenDelay}s`, "--msb-w": px(S.mSbW), "--msb-r": px(S.mSbR), "--ed-top": px(S.edTop),
    "--link-font": f("linkFont"), "--elink-font": S.elinkFont ? f("elinkFont") : "var(--link-font)", "--elink-ul": S.eUl || S.linkUl, "--elink-ul-style": S.eUlStyle || S.linkUlStyle, "--elink-ul-w": px(S.eUlW < 0 ? S.linkUlW : S.eUlW), "--elink-ul-off": px(S.eUlOff < 0 ? S.linkUlOff : S.eUlOff),
    "--ol-style": S.listNum, "--bullet-s": px(S.bulletS), "--bullet-r": px(S.bulletR), "--bi-font": S.biFont ? f("biFont") : "var(--bold-font)", "--bq-out": px(S.bqOut), "--pic-top": px(S.picTop), "--pic-bottom": px(S.picBottom),
    "--props-r": px(S.propsR), "--props-ol": px(S.propsOl), "--props-ol-style": S.propsOlStyle, "--prop-r": px(S.propR), "--prop-gap": px(S.propGap), "--props-gap": px(S.propsGap),
  });
  if (S.coTPad >= 0) vars["--co-t-pad"] = `${S.coTPad * 0.6}px ${S.coTPad}px`;
  // headings, each level: its own value, or the one all levels share
  for (let n = 1; n <= 6; n++) {
    const h = S.hd[n], ulOn = h.ul ? h.ul === "on" : n <= 2 ? S.hUl !== "none" : S.hUl === "all" && n === 3;
    vars[`--h${n}-s`] = h.s; vars[`--h${n}-w`] = h.w || (n <= 3 ? S[`h${n}W`] : 700); vars[`--h${n}-lh`] = h.lh || S.hLh;
    vars[`--h${n}-ul`] = ulOn ? "underline" : "none"; vars[`--h${n}-ul-style`] = h.ulStyle || S.hUlStyle; vars[`--h${n}-ul-w`] = px(h.ulW || S.hUlW); vars[`--h${n}-ul-off`] = px(h.ulOff < 0 ? S.hUlOff : h.ulOff);
    vars[`--h${n}-ul-c`] = T.hUls[n - 1] ? css(T.hUls[n - 1]) : "currentColor";
  }

  for (const [k, v] of Object.entries(vars)) out[k] = String(v);
  if (T.cardCover) out["--card-cover"] = css(T.cardCover);
  // (what the app's own tokens need beyond the demo's: the accent as text on panes and on the frame, text on a danger fill)
  out["--accent-text"] = css(fix(rc(T.accent.L, T.accent.C, T.accent.h), T.pane, 4.5));
  out["--accent-text-frame"] = css(fix(rc(T.accent.L, T.accent.C, T.accent.h), T.frame, 4.5));
  // (text straight on the frame and on a pressed key, held to the app's 4.5:1 whatever the demo's contrast boost)
  // (what floats, as Retroma's Obsidian modal, prompt and menus: a ridge in the pane's colour at 0.9 (0.3 in dark), a glow of the accent)
  out["--float-ol-c"] = css(rc(dark() ? 0.3 : 0.9, T.pane.C, T.pane.h));
  out["--float-glow-c"] = css(rc(dark() ? 0.75 : 0.25, T.accent.C, T.accent.h));
  out["--fg-on-frame-app"] = css(fix(T.fgOnFrame, T.frame, 4.5));
  out["--muted-on-frame-app"] = css(fix(T.fgOnFrameMuted, T.frame, 4.5));
  out["--fg-on-on-app"] = css(fix(T.fgOnOn, T.btnOn, 4.5));
  out["--fg-on-alt-app"] = css(fix(T.fg, T.paneAlt, 4.5));
  // (Retroma's view header: a bar inside a pane in the frame's colour, or the one set for pane headers)
  const hdrBar = S.cHdr ? T.hdr : T.frame;
  out["--hdrbar-bg"] = css(hdrBar);
  out["--fg-on-hdrbar-app"] = css(fix(T.fg, hdrBar, 4.5));
  out["--muted-on-hdrbar-app"] = css(fix(T.fgMuted, hdrBar, 4.5));
  out["--fg-on-hdr-app"] = css(fix(T.hdrFg ?? T.fg, T.hdr ?? T.pane, 4.5));
  out["--on-danger"] = css(contrast(rc(0.99, 0, 0), T.danger) >= 4.5 ? rc(0.99, 0, 0) : rc(0.17, 0.02, 25));
  const flags = { crt: S.crt, crtmove: S.crtMove, glow: S.glow, greyimg: S.greyImg, greyvid: S.greyVid, simplebars: S.simpleBars, simplemenu: S.simpleMenu, simplepdf: S.simplePdf, simplenav: S.simpleNav, zen: S.zen, retrocallout: S.retroCallout, acb: S.acb, acbtext: S.acbText, cotitle: S.coColourText };

  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(flags)) data[k] = v ? "on" : "off";
  data.tabstyle = S.tabStyle;
  Object.assign(data, { simplepanes: S.simplePanes ? "on" : "off", simplefhdr: S.simpleFolderHdr ? "on" : "off", simpleedbox: S.simpleEdBox ? "on" : "off", simpleprops: S.simpleProps ? "on" : "off", folderstyle: S.simpleFolderContent ? "plain" : S.folderStyle, bullets: S.bullets });
  const folders = Array.from({ length: 15 }, (_, i) => {
    const c = own(S.fc[i + 1], T.folders[i]);
    // (the folder is see-through over the folder pane: its text is held to 4.5:1 on what shows)
    const fg = fixOn(rc(D ? 0.85 : 0.3, c.C * 1.5, c.h), { ...c, a: 0.55 }, T.folderPane, 4.5);
    return { bg: css(own(S.cFolderBg, { ...c, a: 0.55 })), bgOpen: css(own(S.cFolderBgOpen, c)), fg: css(own(S.cFolderText, fg)), fgOpen: css(own(S.cFolderTextOpen, fix(fg, c, 4.5))), ol: css(rc(0.55, c.C * 2, c.h)) };
  });
  const callouts = Object.fromEntries(Object.entries(T.co).map(([k, c]) => [k, css(c as Any)]));
  const checkboxes = Object.fromEntries(Object.entries(T.acbs).map(([k, c]) => [k, css(c as Any)]));
  const parts = { libItems: S.libItems ?? "cards", ringIStyle: S.ringIStyle, simpleEdBox: S.simpleEdBox, simpleFolderHdr: S.simpleFolderHdr, grid: S.grid, pattern: S.pattern, controlsAt: S.controlsAt, navAt: S.navAt, pinTop: S.pinTop, pinTitle: S.pinTitle, pinStatus: S.pinStatus, pinLeft: S.pinLeft, pinRight: S.pinRight, greyAll: S.greyAll, simpleHdr: S.simpleHdr, simpleEdHdr: S.simpleEdHdr, hash: S.hash, folderIcon: S.folderIcon };
  return { vars: out, data, folders, callouts, checkboxes, parts };
}
