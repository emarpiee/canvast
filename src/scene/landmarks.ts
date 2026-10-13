import * as D from "../core/dyadic";
import type { WorldPoint } from "../core/camera";

/**
 * Fixed reference objects used to orient the user and to measure navigation
 * accuracy. A landmark is an axis-aligned square of side 2^sizeExp world
 * units centered at `center`. They are read-only fixtures for Phase 0A; real
 * editable content arrives with the document model.
 */
export interface Landmark {
  readonly id: string;
  readonly label: string;
  readonly center: WorldPoint;
  readonly sizeExp: number;
}

function at(x: D.Dyadic, y: D.Dyadic): WorldPoint {
  return { x, y };
}

const ORIGIN = at(D.ZERO, D.ZERO);

/**
 * Nested squares at the origin every 8 binary orders of magnitude (so one is
 * always between 1/16 and 16 times the viewport size), from
 * 2^-1024 to 2^1024 world units. Together they span about 616 decimal orders of
 * magnitude, well past the range a single double can represent.
 */
function originNest(): Landmark[] {
  const out: Landmark[] = [];
  for (let s = -1024; s <= 1024; s += 8) {
    out.push({ id: `origin-${s}`, label: `2^${s}`, center: ORIGIN, sizeExp: s });
  }
  return out;
}

export const LANDMARKS: readonly Landmark[] = Object.freeze([
  ...originNest(),
  {
    id: "east-2^40",
    label: "east 2^40",
    center: at(D.fromBigInt(1n, 40), D.fromBigInt(-1n, 40)),
    sizeExp: 30,
  },
  {
    id: "west-2^200",
    label: "west 3·2^200",
    center: at(D.fromBigInt(-3n, 200), D.fromBigInt(5n, 200)),
    sizeExp: 190,
  },
  {
    // A tiny square very close to 1.0: only exact coordinates can tell it
    // apart from 1.0 itself (doubles stop resolving at ~2^-52 there).
    id: "near-one-2^-300",
    label: "1 + 2^-300",
    center: at(D.add(D.fromNumber(1), D.fromBigInt(1n, -300)), D.fromNumber(1)),
    sizeExp: -310,
  },
]);

export function findLandmark(id: string): Landmark | undefined {
  return LANDMARKS.find((l) => l.id === id);
}
