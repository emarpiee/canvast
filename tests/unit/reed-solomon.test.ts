import { describe, expect, it } from "vitest";
import { rsDecode, rsEncode } from "../../src/doc/reed-solomon";

describe("Reed–Solomon", () => {
  it("corrects up to half as many wrong bytes as it has check bytes, anywhere, and gives up past that", () => {
    let s = 3;
    const rnd = (n: number): number => (s = (s * 1103515245 + 12345) >>> 0) % n;
    for (let round = 0; round < 200; round++) {
      const msg = Uint8Array.from({ length: 1 + rnd(130) }, () => rnd(256));
      const code = rsEncode(msg, 16);
      const bad = code.slice();
      const errs = rnd(9); // 0 to 8
      const at = new Set<number>();
      while (at.size < errs) at.add(rnd(bad.length));
      for (const i of at) bad[i] = bad[i]! ^ (1 + rnd(255));
      expect(rsDecode(bad, 16)).toEqual(msg);
    }
    const code = rsEncode(Uint8Array.from({ length: 100 }, (_, i) => i), 16);
    for (let i = 0; i < 20; i++) code[i * 5] = code[i * 5]! ^ 0x5a;
    expect(rsDecode(code, 16)).not.toEqual(Uint8Array.from({ length: 100 }, (_, i) => i)); // (20 wrong: not the message)
  });
});
