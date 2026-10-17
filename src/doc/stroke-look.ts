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

export interface StrokeLook {
  join?: Join;
  cap?: Cap;
  align?: Align;
}

/** The fields of an object for these choices. `defaultJoin`: what a null join means (sharp corners for shapes with corners, round otherwise). */
export function lookFromChoices(join: JoinChoice | null, cap: CapChoice, align: AlignChoice | null, defaultJoin?: Join): StrokeLook {
  const j = join ?? defaultJoin ?? "round";
  return { ...(j !== "round" ? { join: j } : {}), ...(cap !== "round" ? { cap } : {}), ...(align && align !== "centre" ? { align } : {}) };
}

export const joinChoice = (o: { join?: Join | undefined }): JoinChoice => o.join ?? "round";
export const capChoice = (o: { cap?: Cap | undefined }): CapChoice => o.cap ?? "round";
export const alignChoice = (o: { align?: Align | undefined }): AlignChoice => o.align ?? "centre";
