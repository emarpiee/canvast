import type { Paint, SubPath } from "./core";
import type { Rng } from "./rng";

/**
 * Pattern generators (ADR 0162): a generator is a pure function from its settings and a seed to vector shapes in a box that starts at
 * (0, 0). The same settings and seed always make the same shapes. The panel is built from the settings a generator declares, so each
 * generator has its own controls and a new one needs no interface code.
 */
export type Values = Record<string, number | string | boolean>;

type Base = {
  readonly k: string;
  readonly label: string;
  /** Randomize leaves it as it is: it changes what kind of picture this is, not its look. */
  readonly steady?: true;
  /** A few more words on what it does, in the tip of its name. */
  readonly tip?: string;
  /** Shown only while the choice `when[0]` is one of the others. */
  readonly when?: readonly string[];
};
export type Setting = Base &
  (
    | { readonly t: "range"; readonly min: number; readonly max: number; readonly step: number; readonly def: number; /** The usual span, which Randomize keeps to (the whole span can be slow or empty). */ readonly usual: readonly [number, number] }
    | { readonly t: "choice"; readonly opts: readonly (readonly [string, string])[]; readonly def: string; /** A dropdown however few there are: its names do not fit side by side. */ readonly dropdown?: true }
    | { readonly t: "toggle"; readonly def: boolean }
    /** A colour "#rrggbb"; with `hide`, "" means none (the eye of the panel). */
    | { readonly t: "colour"; readonly def: string; readonly hide?: true; /** The colour it takes when a hidden default is shown. */ readonly shown?: string; /** "" means worked out by the theme: an Auto button in place of the eye. */ readonly auto?: true }
  );

export interface Section {
  readonly title: string;
  readonly items: readonly Setting[];
  /** A line under the title (the Settings page's cards). */
  readonly note?: string;
}

/** One shape a generator makes: sub-paths in the box, a fill and/or an outline (the width is in box units). */
export interface GenShape {
  sub: SubPath[];
  fill: Paint | null;
  stroke: Paint | null;
  width: number;
  evenodd?: true;
  name?: string;
}

export interface Generator {
  readonly id: string;
  readonly label: string;
  /** One line shown under the name in the picker. */
  readonly about: string;
  readonly family: "Waves" | "Blobs" | "Soft" | "Lines" | "Tiles" | "Fields" | "Proportion" | "Composition" | "Layout" | "Perspective" | "Geometry" | "Art study" | "Balloons";
  /** For laying out and composing work: it starts with no background, to sit over what is under it. */
  readonly guide?: true;
  /** The settings, in sections; the "Colour" section gets the Background colour in front. */
  readonly sections: readonly Section[];
  readonly run: (v: Values, rng: Rng, w: number, h: number) => GenShape[];
  /** What these settings come to in a box of this size, in a few words. */
  readonly readout?: (v: Values, w: number, h: number) => string;
}
