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
  {
    title: "Lines",
    items: [
      { t: "choice", k: "linesShow", label: "Show", opts: [["off", "Off"], ["over", "Over it"], ["only", "Lines only"]], def: "off" },
      { ...R("linesWidth", "Width", 0.5, 8, 0.1, 1.5), when: ["linesShow", "over", "only"] },
      { ...C("linesColour", "Colour", "#111111"), when: ["linesShow", "over", "only"] },
      { ...R("linesOutline", "Outline", 0, 1, 0.01, 0.5), when: ["linesShow", "over", "only"] },
      { ...R("linesInner", "Inner detail", 0, 1, 0.01, 0.35), when: ["linesShow", "over", "only"] },
      { ...R("linesShortest", "Min. placed", 0, 100, 1, 6), when: ["linesShow", "over", "only"], tip: "Place the lines leaves out lines shorter than this many pixels; what shows here does not change." },
    ],
  },
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
