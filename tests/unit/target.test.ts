import { describe, expect, it } from "vitest";
import { Switch } from "../../src/app/target";

class Thing {
  n = 0;
  private readonly fns = new Set<(why: string) => void>();
  get double(): number {
    return this.n * 2;
  }
  bump(): void {
    this.n++;
    for (const f of this.fns) f("bump");
  }
  subscribe(fn: (why: string) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
}

describe("Switch (ADR 0168)", () => {
  it("reads, writes and calls go to the target in use; subscribers hear only it, and hear the switch", () => {
    const a = new Thing(), b = new Thing();
    const sw = new Switch(a, { subscribe: ["switch"] });
    const heard: string[] = [];
    const off = sw.proxy.subscribe((w) => heard.push(w));
    sw.proxy.bump();
    sw.proxy.n += 10;
    expect([a.n, sw.proxy.double]).toEqual([11, 22]);
    sw.use(b);
    sw.proxy.bump();
    a.bump(); // (not in use: not heard)
    expect([b.n, heard]).toEqual([1, ["bump", "switch", "bump"]]);
    off();
    b.bump();
    expect(heard.length).toBe(3);
  });
});
