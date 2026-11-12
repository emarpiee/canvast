import type { Section, Setting } from "../gen/types";

// How a 3D model is seen: every value a plain number, word or colour, so a view is a small JSON (a bookmark, or what a card on a canvas shows).

export type ModelLook = Record<string, number | string | boolean>;

const R = (k: string, label: string, min: number, max: number, step: number, def: number): Setting => ({ t: "range", k, label, min, max, step, def, usual: [min, max] });
const C = (k: string, label: string, def: string, hide = false): Setting => ({ t: "colour", k, label, def, ...(hide ? { hide: true as const, shown: "#2b2b2f" } : {}) });
const LIGHT_TYPES = [["sun", "Sun"], ["point", "Point"], ["spot", "Spot"], ["off", "Off"]] as const;
const light = (k: string, title: string, type: string, strength: number, around: number, height: number, colour: string): Section => ({
  title,
  items: [
    { t: "choice", k: `${k}Type`, label: "Type", opts: LIGHT_TYPES, def: type },
    C(`${k}Colour`, "Colour", colour),
    R(`${k}Power`, "Strength", 0, 10, 0.05, strength),
    R(`${k}Around`, "Around", -180, 180, 1, around),
    R(`${k}Height`, "Height", -90, 90, 1, height),
  ],
});

const ON = ["linesShow", "over", "flat", "only"] as const;
const EDGES = ["linesBy", "edges"] as const;
const PICTURE = ["linesBy", "picture"] as const;
const TONES = ["toneMode", "hatch", "crosshatch", "halftone", "stipple"] as const;

/** The line art of a view: found from the model's own edges (exact, with what is hidden and tones from the light), or from the picture (any model, scans too). */
const LINE_SECTIONS: readonly Section[] = [
  {
    title: "Lines",
    items: [
      { t: "choice", k: "linesShow", label: "Show", opts: [["off", "Off"], ["over", "Over it"], ["flat", "On a fill"], ["only", "Lines only"]], def: "off" },
      { t: "choice", k: "linesBy", label: "Find by", opts: [["edges", "Model edges"], ["picture", "The picture"]], def: "edges", when: ON, tip: "Model edges: the outline and creases of its faces, exact, with the edges behind and tones from the light. The picture: lines where the view changes, for scans and very dense models." },
      { ...C("linesFill", "Fill", "#faf9f4"), when: ["linesShow", "flat"] },
      { t: "toggle", k: "linesOuter", label: "Outline", def: true, when: EDGES, tip: "Where the surface turns away: the outer shape and its overlaps." },
      { ...R("linesWidth", "Width", 0.5, 8, 0.1, 1.5), when: ON },
      { ...C("linesColour", "Colour", "#111111"), when: ON },
      { t: "toggle", k: "linesCreases", label: "Creases", def: true, when: EDGES, tip: "Where two faces meet at a turn sharper than the crease angle." },
      { ...R("creaseWidth", "Crease width", 0.25, 8, 0.05, 1), when: EDGES },
      { ...C("creaseColour", "Crease colour", "#444444"), when: EDGES },
      { ...R("creaseAngle", "Crease angle", 1, 170, 1, 40), when: EDGES, tip: "Faces meeting at a sharper turn than this, in degrees, make a crease: less shows gentler forms." },
      { ...R("linesOutline", "Outline", 0, 1, 0.01, 0.5), when: PICTURE, tip: "How small a step in depth makes a line: overlaps and the outer shape." },
      { ...R("linesInner", "Inner detail", 0, 1, 0.01, 0.5), when: PICTURE, tip: "How gentle a turn of the surface makes a line." },
      { ...R("linesReach", "Reach", 0.5, 8, 0.1, 2.5), when: PICTURE, tip: "How far around each point it looks for a change: more finds gentler forms, less keeps close lines apart. Their width stays as set." },
      { ...R("linesShortest", "Min. placed", 0, 100, 1, 6), when: PICTURE, tip: "Place the lines leaves out lines shorter than this many pixels; what shows here does not change." },
    ],
  },
  {
    title: "Hidden edges",
    items: [
      { t: "toggle", k: "hiddenShow", label: "Show", def: false, tip: "The edges behind, dashed: as a technical drawing shows them." },
      { ...C("hiddenColour", "Colour", "#8a9099"), when: ["hiddenShow", "true"] },
      { ...R("hiddenOpacity", "Opacity", 10, 100, 1, 40), when: ["hiddenShow", "true"] },
      { ...R("hiddenDash", "Dash", 2, 16, 1, 6), when: ["hiddenShow", "true"] },
    ],
  },
  {
    title: "Shading",
    items: [
      { t: "choice", k: "toneMode", label: "Tones", opts: [["none", "None"], ["hatch", "Hatching"], ["crosshatch", "Cross-hatching"], ["halftone", "Halftone dots"], ["stipple", "Stippling"]], def: "none", dropdown: true, tip: "The light's shadows as lines or dots, where the lights of the Light tab leave it dark." },
      { ...C("toneColour", "Colour", "#39433d"), when: TONES },
      { ...R("toneSpacing", "Spacing", 3, 24, 0.5, 9), when: TONES },
      { ...R("toneStrength", "Strength", 20, 200, 1, 100), when: TONES, tip: "How dark the light's shadows read: more covers more of the model." },
      { ...R("toneWidth", "Width", 0.25, 2.5, 0.05, 1), when: ["toneMode", "hatch", "crosshatch", "stipple"] },
      { ...R("toneAngle", "Angle", -90, 90, 1, -45), when: ["toneMode", "hatch", "crosshatch"] },
    ],
  },
  {
    title: "Hand-drawn",
    items: [
      { ...R("sketch", "Wobble", 0, 3, 0.05, 0), tip: "How far a line strays from the edge, as by hand." },
      { ...R("depthFade", "Fade far lines", 0, 100, 1, 0) },
      { t: "toggle", k: "depthWeight", label: "Thicker near", def: false, tip: "Near lines drawn thicker, far ones thinner." },
    ],
  },
];

/** Every value of a view's line art (and its background): what a line style sets. */
export const LINE_KEYS: readonly string[] = [...LINE_SECTIONS.flatMap((s) => s.items.map((i) => i.k)), "bg"];
/** Which tab of the settings a group is in. */
export const MODEL_TABS: ReadonlyArray<{ id: string; label: string; titles: readonly string[] }> = [
  { id: "view", label: "View", titles: ["Camera", "Model", "Background", "Pose"] },
  { id: "lines", label: "Lines", titles: LINE_SECTIONS.map((s) => s.title) },
  { id: "light", label: "Light", titles: ["Main light", "Fill light", "Back light", "All around"] },
];

/** The settings of the 3D view, drawn by the same rows as a pattern's (ui/setting-rows.ts). */
export const MODEL_SECTIONS: readonly Section[] = [
  {
    title: "Camera",
    items: [
      R("yaw", "Around", -180, 180, 1, 35),
      R("pitch", "Height", -89, 89, 1, 20),
      R("zoom", "Zoom", 0.1, 10, 0.01, 1),
      { t: "choice", k: "lens", label: "Lens", opts: [["persp", "Perspective"], ["ortho", "Flat"]], def: "persp" },
      R("focal", "Focal length", 12, 200, 1, 50),
      R("panX", "Slide across", -3, 3, 0.01, 0),
      R("panY", "Slide up", -3, 3, 0.01, 0),
    ],
  },
  {
    title: "Model",
    items: [
      { t: "choice", k: "surface", label: "Surface", opts: [["own", "Its own"], ["clay", "Clay"], ["tones", "Tones"], ["flat", "One colour"], ["wire", "Wireframe"]], def: "own" },
      { t: "range", k: "tones", label: "Tones", min: 2, max: 5, step: 1, def: 3, usual: [2, 5], when: ["surface", "tones"] },
      C("colour", "Colour", "#c8c3ba"),
      { t: "choice", k: "up", label: "Up", opts: [["y", "Y"], ["z", "Z"]], def: "y" },
      { t: "toggle", k: "shadows", label: "Shadows", def: true },
      { t: "toggle", k: "mirror", label: "Mirror", def: false },
    ],
  },
  ...LINE_SECTIONS,
  { title: "Background", items: [C("bg", "Colour", "#2b2b2f", true)] },
  // (what a model's animations let it be posed in: drawn by the view from the model's own clips)
  { title: "Pose", items: [R("clip", "Animation", 0, 999, 1, 0), R("poseTime", "Time", 0, 3600, 0.01, 0)] },
  light("key", "Main light", "sun", 3, -35, 40, "#fff4e6"),
  light("fill", "Fill light", "sun", 0.8, 50, 10, "#dfe8ff"),
  light("rim", "Back light", "off", 2, 160, 30, "#ffffff"),
  { title: "All around", items: [C("ambientColour", "Colour", "#ffffff"), R("ambientPower", "Strength", 0, 3, 0.01, 0.35)] },
];

const SETTINGS = MODEL_SECTIONS.flatMap((s) => s.items);

export const defaultLook = (over: ModelLook = {}): ModelLook => ({ ...Object.fromEntries(SETTINGS.map((s) => [s.k, s.def])), ...over });

/** The look saved in a view, only what it can use: anything else, or a value of another kind, takes its usual value (a file can say anything). */
export function readLook(text: string | undefined, over: ModelLook = {}): ModelLook {
  const look = defaultLook(over);
  try {
    const got = JSON.parse(text || "{}") as Record<string, unknown>;
    for (const s of SETTINGS) {
      const v = got[s.k];
      if (s.t === "range" && typeof v === "number" && Number.isFinite(v)) look[s.k] = Math.max(s.min, Math.min(s.max, v));
      else if (s.t === "toggle" && typeof v === "boolean") look[s.k] = v;
      else if (s.t === "choice" && s.opts.some(([o]) => o === v)) look[s.k] = v as string;
      else if (s.t === "colour" && typeof v === "string" && (/^#[0-9a-f]{6}$/i.test(v) || (s.hide && v === ""))) look[s.k] = v;
    }
  } catch {
    // (its usual look)
  }
  return look;
}

/** What differs from the usual look, as text: short enough for a bookmark and for a card's `preview`. */
export function writeLook(look: ModelLook): string {
  const base = defaultLook();
  return JSON.stringify(Object.fromEntries(Object.entries(look).filter(([k, v]) => v !== base[k])));
}

/** A portrait or still life is lit in a few classic ways: a choice sets the three lights. */
export const LIGHT_PRESETS: ReadonlyArray<{ id: string; label: string; hint: string; look: ModelLook }> = [
  { id: "rembrandt", label: "Rembrandt", hint: "High to one side: light on the far cheek", look: { keyType: "sun", keyPower: 3.4, keyAround: -45, keyHeight: 45, fillType: "sun", fillPower: 0.35, fillAround: 40, fillHeight: 5, rimType: "off", ambientPower: 0.15 } },
  { id: "loop", label: "Loop", hint: "To one side: a small shadow by the nose", look: { keyType: "sun", keyPower: 3.2, keyAround: -30, keyHeight: 35, fillType: "sun", fillPower: 0.7, fillAround: 40, fillHeight: 5, rimType: "off", ambientPower: 0.2 } },
  { id: "butterfly", label: "Butterfly", hint: "From above: a shadow under the nose", look: { keyType: "sun", keyPower: 3.2, keyAround: 0, keyHeight: 55, fillType: "sun", fillPower: 0.5, fillAround: 0, fillHeight: -20, rimType: "off", ambientPower: 0.2 } },
  { id: "split", label: "Split", hint: "From the side: half light, half shadow", look: { keyType: "sun", keyPower: 3.6, keyAround: -90, keyHeight: 5, fillType: "off", rimType: "off", ambientPower: 0.08 } },
  { id: "rim", label: "Rim", hint: "From behind: an edge of light", look: { keyType: "off", fillType: "sun", fillPower: 0.2, fillAround: 30, fillHeight: 10, rimType: "sun", rimPower: 6, rimAround: 170, rimHeight: 25, ambientPower: 0.05 } },
  { id: "three", label: "Three-point", hint: "Main, fill and back: a clear form", look: { keyType: "sun", keyPower: 3, keyAround: -40, keyHeight: 40, fillType: "sun", fillPower: 1, fillAround: 50, fillHeight: 10, rimType: "sun", rimPower: 2.5, rimAround: 160, rimHeight: 30, ambientPower: 0.25 } },
  { id: "flat", label: "Even", hint: "No shadows: its outline and colour", look: { keyType: "off", fillType: "off", rimType: "off", ambientPower: 3 } },
];

/** A line style's values from what was saved: only what a line style holds, each sound (a file can say anything). Null: not one. */
export function cleanLineStyle(d: unknown): ModelLook | null {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const look = readLook(JSON.stringify(d));
  return Object.fromEntries(LINE_KEYS.map((k) => [k, look[k]!]));
}

/** A line style in a few words. */
export function lineStyleSummary(l: ModelLook): string {
  const show = { over: "Over the model", flat: "On a fill", only: "Lines only", off: "Off" }[l["linesShow"] as string] ?? "";
  const tones = ({ hatch: "hatching", crosshatch: "cross-hatching", halftone: "halftone dots", stipple: "stippling" } as Record<string, string>)[l["toneMode"] as string];
  return [show, l["linesBy"] === "picture" ? "from the picture" : "", tones ?? "", l["hiddenShow"] ? "edges behind" : ""].filter(Boolean).join(" · ");
}

/** Line styles of illustration: each sets every value of the lines (the rest back to its usual) and the background. */
export const LINE_PRESETS: ReadonlyArray<{ id: string; label: string; hint: string; look: ModelLook }> = [
  { id: "blueprint", label: "Blueprint", hint: "Light lines on blue, the edges behind dashed", look: { linesShow: "only", linesColour: "#e6f3ff", creaseColour: "#96c9ef", hiddenColour: "#7ba2c8", bg: "#142e4f", hiddenShow: true, hiddenOpacity: 35, linesWidth: 2, creaseWidth: 1, creaseAngle: 35 } },
  { id: "ink", label: "Ink", hint: "A bold outline, fine creases, on paper", look: { linesShow: "only", linesColour: "#242825", creaseColour: "#454a44", bg: "#f3f0e6", linesWidth: 3, creaseWidth: 1, creaseAngle: 45 } },
  { id: "architectural", label: "Architectural", hint: "A pale fill, the edges behind faint", look: { linesShow: "flat", linesColour: "#29343c", creaseColour: "#697680", hiddenColour: "#82919d", bg: "#ebe9e2", linesFill: "#faf9f4", hiddenShow: true, hiddenOpacity: 35, linesWidth: 2.5, creaseWidth: 0.75, creaseAngle: 30 } },
  { id: "etching", label: "Etching", hint: "Cross-hatched shadows, a slight hand", look: { linesShow: "only", linesColour: "#403c30", creaseColour: "#665a42", bg: "#eee8d8", toneMode: "crosshatch", toneColour: "#625740", toneSpacing: 8, toneStrength: 125, toneWidth: 0.75, toneAngle: -40, linesWidth: 1.5, creaseWidth: 0.75, sketch: 0.25, depthWeight: true } },
  { id: "patent", label: "Patent", hint: "Hatched shadows on a white fill", look: { linesShow: "flat", linesColour: "#222a30", creaseColour: "#505a62", bg: "#f7f5ef", linesFill: "#fffdf6", toneMode: "hatch", toneColour: "#636d72", toneSpacing: 10, toneStrength: 115, toneWidth: 0.75, toneAngle: -45, linesWidth: 2, creaseWidth: 0.75, hiddenShow: true, hiddenOpacity: 22, depthFade: 15 } },
  { id: "comic", label: "Comic dots", hint: "A heavy outline, halftone shadows", look: { linesShow: "flat", linesColour: "#1c2636", creaseColour: "#354358", bg: "#edce87", linesFill: "#fff3ce", toneMode: "halftone", toneColour: "#33455e", toneSpacing: 7, toneStrength: 130, linesWidth: 3.5, creaseWidth: 1.25, depthWeight: true } },
  { id: "pencil", label: "Pencil", hint: "Soft lines by hand, stippled shadows", look: { linesShow: "only", linesColour: "#4a504b", creaseColour: "#747d72", bg: "#e9e9de", toneMode: "stipple", toneColour: "#7c8677", toneSpacing: 4, toneStrength: 140, toneWidth: 0.75, linesWidth: 1.5, creaseWidth: 0.75, sketch: 1, depthFade: 35, depthWeight: true } },
  { id: "toon", label: "Toon", hint: "A thick outline over the model in flat tones", look: { linesShow: "over", linesColour: "#161d25", creaseColour: "#313944", bg: "#d6dfe3", linesWidth: 4, creaseWidth: 1.5, creaseAngle: 55, surface: "tones", tones: 3 } },
];

/** A look with a line style: every value of the lines back to its usual, then the style's. */
export const withLineStyle = (look: ModelLook, style: ModelLook): ModelLook => {
  const base = defaultLook();
  return { ...look, ...Object.fromEntries(LINE_KEYS.map((k) => [k, base[k]!])), ...style };
};
