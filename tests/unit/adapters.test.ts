import { describe, expect, it } from "vitest";
import { parseModel, pdfPages } from "../../src/assets/adapters";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("content adapters", () => {
  it("reads an ASCII STL, a binary STL and an OBJ with a quad", () => {
    expect(parseModel(enc("solid a\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid"), "stl")?.length).toBe(9);
    const b = new Uint8Array(84 + 50);
    new DataView(b.buffer).setUint32(80, 1, true);
    new DataView(b.buffer).setFloat32(84 + 12 + 4, 2, true);
    expect(parseModel(b, "stl")?.[1]).toBe(2);
    expect(parseModel(enc("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n"), "obj")?.length).toBe(18);
  });
  it("gives null for nonsense and counts PDF pages", () => {
    expect(parseModel(enc("hello"), "stl")).toBeNull();
    expect(parseModel(enc("f 1 2 3"), "obj")).toBeNull();
    expect(pdfPages(enc("<< /Type /Pages >> << /Type /Page >> << /Type/Page >>"))).toBe(2);
    expect(pdfPages(enc("nothing"))).toBeNull();
  });
});
