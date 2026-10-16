import { describe, expect, it } from "vitest";
import { evalQuery, parseQuery } from "../../src/search/query";

/** An item is the set of words it contains; a term matches when the item has that word. */
const run = (q: string, item: string): boolean => {
  const words = new Set(item.split(" "));
  return evalQuery(parseQuery(q).query, (t) => words.has(t.text));
};

describe("search query (ADR 0069)", () => {
  it("empty matches everything, and a space is AND", () => {
    expect(run("", "a")).toBe(true);
    expect(run("red cat", "red cat")).toBe(true);
    expect(run("red cat", "red")).toBe(false);
  });
  it("OR, XOR, NOT and their symbols", () => {
    expect(run("red OR blue", "blue")).toBe(true);
    expect(run("red | blue", "green")).toBe(false);
    expect(run("red XOR blue", "red blue")).toBe(false);
    expect(run("red ^ blue", "red")).toBe(true);
    expect(run("NOT red", "red")).toBe(false);
    expect(run("-red", "blue")).toBe(true);
    expect(run("!red cat", "cat")).toBe(true);
    expect(run("red AND cat", "red cat")).toBe(true);
    expect(run("red & cat", "red")).toBe(false);
  });
  it("precedence is NOT, AND, XOR, OR; brackets override", () => {
    expect(run("a OR b c", "a")).toBe(true); // a OR (b AND c)
    expect(run("(a OR b) c", "a")).toBe(false);
    expect(run("a XOR b c", "a b c")).toBe(false); // a XOR (b AND c): both true
    expect(run("a XOR b OR c", "c")).toBe(true); // (a XOR b) OR c
    expect(run("NOT (a OR b)", "c")).toBe(true);
    expect(run("--a", "a")).toBe(true);
  });
  it("lower-case or/and/not stay words; hyphens inside words stay; quotes make one phrase", () => {
    expect(run("or", "or")).toBe(true);
    expect(run("red-cat", "red-cat")).toBe(true);
    const q = parseQuery('"red cat" -dog').query!;
    expect(evalQuery(q, (t) => t.text === "red cat")).toBe(true);
  });
  it("an unreadable query falls back to plain words and never throws", () => {
    for (const bad of ["(a", "a OR", "a )", "OR a", "a XOR XOR b", "((("]) {
      const r = parseQuery(bad);
      expect(r.fallback).toBe(true);
    }
    expect(run("(a b", "a b")).toBe(true);
  });
  it("matches a brute-force truth table for every operator pair", () => {
    const f = { and: (x: boolean, y: boolean) => x && y, or: (x: boolean, y: boolean) => x || y, xor: (x: boolean, y: boolean) => x !== y };
    for (const [op, fn] of Object.entries(f)) for (const x of [0, 1]) for (const y of [0, 1]) {
      const item = [x ? "a" : "", y ? "b" : ""].join(" ");
      expect(run(`a ${op.toUpperCase()} b`, item)).toBe(fn(!!x, !!y));
    }
  });
});
