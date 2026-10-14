import { describe, expect, it } from "vitest";
import { probeMp4 } from "../../src/assets/mp4-probe";
import { makeFakeMp4 } from "../e2e/mp4";

describe("mp4 probe", () => {
  it("reads size, length and codec from the boxes", () => {
    expect(probeMp4(makeFakeMp4(1920, 1080, 12))).toEqual({ w: 1920, h: 1080, duration: 12, codec: "H.265" });
    expect(probeMp4(makeFakeMp4(640, 360, 3.5, "avc1"))).toEqual({ w: 640, h: 360, duration: 3.5, codec: "H.264" });
  });
  it("swaps the sides of a video turned a quarter turn", () => {
    expect(probeMp4(makeFakeMp4(1920, 1080, 2, "av01", true))).toMatchObject({ w: 1080, h: 1920, codec: "AV1" });
  });
  it("gives null for anything else, including cut-off files", () => {
    expect(probeMp4(new Uint8Array(40))).toBeNull();
    expect(probeMp4(new Uint8Array(makeFakeMp4(10, 10, 1)).subarray(0, 60))).toBeNull();
  });
});
