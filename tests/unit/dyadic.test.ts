import { describe, expect, it } from "vitest";
import * as D from "../../src/core/dyadic";
import { rng } from "./rng";

describe("dyadic conversion", () => {
  it("round-trips every class of double exactly", () => {
    const samples = [
      0, 1, -1, 0.5, 3, 1 / 3, Math.PI, -Math.E, 2 ** 52 + 1, 2 ** 1023, -(2 ** 1023) * 1.999,
      Number.MAX_VALUE, Number.MIN_VALUE, 2.2250738585072014e-308, 5e-324 * 12345, 1e-300, 1e300,
    ];
    const r = rng(1);
    for (let i = 0; i < 2000; i++) {
      samples.push((r() - 0.5) * 2 ** Math.floor((r() - 0.5) * 2000));
    }
    for (const x of samples) {
      expect(D.toNumber(D.fromNumber(x))).toBe(x === 0 ? 0 : x);
    }
  });

  it("is canonical (odd mantissa) so equal values compare equal", () => {
    expect(D.fromNumber(8)).toEqual({ m: 1n, e: 3 });
    expect(D.fromNumber(-0.75)).toEqual({ m: -3n, e: -2 });
    expect(D.equals(D.add(D.fromNumber(0.25), D.fromNumber(0.75)), D.fromNumber(1))).toBe(true);
    expect(D.fromNumber(-0)).toBe(D.ZERO);
  });

  it("rejects non-finite input", () => {
    expect(() => D.fromNumber(NaN)).toThrow(RangeError);
    expect(() => D.fromNumber(Infinity)).toThrow(RangeError);
  });

  it("maps out-of-range magnitudes to ±Infinity or 0, never NaN", () => {
    expect(D.toNumber(D.fromBigInt(1n, 5000))).toBe(Infinity);
    expect(D.toNumber(D.fromBigInt(-7n, 5000))).toBe(-Infinity);
    expect(D.toNumber(D.fromBigInt(1n, -5000))).toBe(0);
    expect(D.toNumber(D.fromBigInt((1n << 3000n) + 1n, -3000))).toBe(1);
  });
});

describe("dyadic arithmetic", () => {
  it("keeps differences exact where doubles cannot", () => {
    const one = D.fromNumber(1);
    const tiny = D.fromBigInt(1n, -300);
    const sum = D.add(one, tiny);
    expect(1 + 2 ** -300).toBe(1); // a double loses it
    expect(D.equals(D.sub(sum, one), tiny)).toBe(true); // a dyadic does not
  });

  it("adds operands with wildly different exponents", () => {
    const big = D.fromBigInt(3n, 2000);
    const small = D.fromBigInt(-5n, -2000);
    const s = D.add(big, small);
    expect(D.equals(D.sub(s, big), small)).toBe(true);
    expect(D.equals(D.sub(s, small), big)).toBe(true);
  });

  it("rounds to a power-of-two quantum with bounded error", () => {
    const r = rng(2);
    for (let i = 0; i < 500; i++) {
      const a = D.fromNumber((r() - 0.5) * 1e6);
      const q = Math.floor(r() * 40) - 30;
      const rounded = D.roundTo(a, q);
      expect(rounded.e).toBeGreaterThanOrEqual(q);
      const err = Math.abs(D.toNumber(D.sub(rounded, a)));
      expect(err).toBeLessThanOrEqual(2 ** (q - 1));
    }
  });

  it("floor-divides by powers of two, including negatives", () => {
    expect(D.floorDivPow2(D.fromNumber(7), 1)).toBe(3n);
    expect(D.floorDivPow2(D.fromNumber(-7), 1)).toBe(-4n);
    expect(D.floorDivPow2(D.fromNumber(-8), 2)).toBe(-2n);
    expect(D.floorDivPow2(D.fromNumber(0.75), -2)).toBe(3n);
    expect(D.floorDivPow2(D.fromNumber(-0.75), 0)).toBe(-1n);
    expect(D.floorDivPow2(D.fromBigInt(5n, 100), 98)).toBe(20n);
  });

  it("serializes and parses losslessly", () => {
    for (const v of [D.ZERO, D.fromNumber(-0.75), D.fromBigInt((1n << 900n) + 3n, -1200)]) {
      expect(D.equals(D.parse(D.toString(v)), v)).toBe(true);
    }
    expect(() => D.parse("1.5p2")).toThrow(SyntaxError);
    expect(() => D.parse("1p")).toThrow(SyntaxError);
  });

  it("reports bit length", () => {
    expect(D.bitLength(0n)).toBe(0);
    expect(D.bitLength(1n)).toBe(1);
    expect(D.bitLength(-255n)).toBe(8);
    expect(D.bitLength(1n << 1000n)).toBe(1001);
  });

  it("displays magnitudes beyond the double range", () => {
    expect(D.toDisplay(D.fromBigInt(1n, 2000))).toMatch(/^1\.148e602$/);
    expect(D.toDisplay(D.fromBigInt(-1n, -2000))).toMatch(/^-8\.710e-603$/);
    expect(D.toDisplay(D.fromNumber(12.5))).toBe("12.5");
  });
});
