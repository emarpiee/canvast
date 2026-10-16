/**
 * Words with a count that read right for one and for many (ADR 0086): `plural(1, "item")` is "1 item", `plural(3, "canvas", "canvases")` is
 * "3 canvases". Never write "item(s)". `be(n)` is "is" or "are", `were(n)` "was" or "were".
 */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
export const be = (n: number): string => (n === 1 ? "is" : "are");
export const were = (n: number): string => (n === 1 ? "was" : "were");
