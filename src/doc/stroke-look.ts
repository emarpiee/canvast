/**
 * The look of an outline beyond its colour and width (ADR 0104): how its corners are joined, how its ends are capped, and where it sits on
 * the edge. The model stores only what differs from the default (round joins and caps, centred), so a choice of "round" or "centre" is the
 * absence of the field; the interface speaks in choices.
 */
import type { Align, Cap, Join } from "./path";

export type JoinChoice = Join | "round";
export type CapChoice = Cap | "round";
/** "centre" is the absent `align`. */
export type AlignChoice = Align | "centre";

export type DashChoice = "solid" | "dashed" | "dotted";
/** A dash pattern: the length of a dash and of the gap after it, in widths of the outline (so it looks the same at any zoom and width). */
export type Dash = readonly [number, number];
export const DASHES: Readonly<Record<Exclude<DashChoice, "solid">, Dash>> = { dashed: [3, 2], dotted: [0, 2] };

export interface StrokeLook {
  join?: Join;
  cap?: Cap;
  align?: Align;
  dash?: Dash;
}

/** The fields of an object for these choices. `defaultJoin`: what a null join means (sharp corners for shapes with corners, round otherwise). */
export function lookFromChoices(join: JoinChoice | null, cap: CapChoice, align: AlignChoice | null, defaultJoin?: Join, dash: DashChoice = "solid"): StrokeLook {
  const j = join ?? defaultJoin ?? "round";
  return { ...(j !== "round" ? { join: j } : {}), ...(cap !== "round" ? { cap } : {}), ...(align && align !== "centre" ? { align } : {}), ...(dash !== "solid" ? { dash: DASHES[dash] } : {}) };
}

export const joinChoice = (o: { join?: Join | undefined }): JoinChoice => o.join ?? "round";
export const capChoice = (o: { cap?: Cap | undefined }): CapChoice => o.cap ?? "round";
export const alignChoice = (o: { align?: Align | undefined }): AlignChoice => o.align ?? "centre";
/** A dotted line (dash of no length) needs round ends to show at all; any other pattern with a first length under half a width counts as dotted. */
export const dashChoice = (o: { dash?: Dash | undefined }): DashChoice => (!o.dash ? "solid" : o.dash[0] < 0.5 ? "dotted" : "dashed");
