import type { Paint, SubPath } from "./core";
import type { Rng } from "./rng";

/**
 * Pattern generators (ADR 0162): a generator is a pure function from its settings and a seed to vector shapes in a box that starts at
 * (0, 0). The same settings and seed always make the same shapes. The panel is built from the settings a generator declares, so each
 * generator has its own controls and a new one needs no interface code.
 */
export type Values = Record<string, number | string | boolean>;

type Base = { readonly k: string; readonly label: string };
export type Setting = Base &
  (
    | { readonly t: "range"; readonly min: number; readonly max: number; readonly step: number; readonly def: number }
    | { readonly t: "choice"; readonly opts: readonly (readonly [string, string])[]; readonly def: string }
    | { readonly t: "toggle"; readonly def: boolean }
    /** A colour "#rrggbb"; with `hide`, "" means none (the eye of the panel). */
    | { readonly t: "colour"; readonly def: string; readonly hide?: true }
  );

export interface Section {
  readonly title: string;
  readonly items: readonly Setting[];
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
  readonly family: "Waves" | "Blobs" | "Soft" | "Lines" | "Tiles" | "Fields";
  /** The settings, in sections; the "Colour" section gets the Background colour in front. */
  readonly sections: readonly Section[];
  readonly run: (v: Values, rng: Rng, w: number, h: number) => GenShape[];
}
