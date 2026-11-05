import { describe, expect, it } from "vitest";
import { pageList } from "../../src/assets/pdf-pages";

describe("pages typed for Place pages", () => {
  it("reads ranges and single pages, each once, in the order typed, and only pages there are", () => {
    expect(pageList("1-3, 5", 10)).toEqual([1, 2, 3, 5]);
    expect(pageList("3-1", 10)).toEqual([3, 2, 1]);
    expect(pageList("2 2, 2-3", 10)).toEqual([2, 3]);
    expect(pageList("9-20", 10)).toEqual([9, 10]);
    expect(pageList("0, 11, x, -", 10)).toEqual([]);
  });
});
