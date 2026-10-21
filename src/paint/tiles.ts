/** A painting's tiles (ADR 0165): their side in px and their keys. Kept apart so the engine's worker needs nothing else of the painting. */
export const TILE = 256;
export const tileKey = (tx: number, ty: number): string => `${tx},${ty}`;
export const tileOf = (key: string): [number, number] => key.split(",").map(Number) as [number, number];
