import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseFont } from "../../src/text/font";
import { setFont } from "../../src/text/layout";
import * as D from "../../src/core/dyadic";
import { TURN } from "../../src/core/angle";
import type { ImageObject, TextObject } from "../../src/doc/model";
import { deserializeObject, newObjectId, serializeObject } from "../../src/doc/model";
import { newWatermark, placed, validWatermark, watermarkBox, watermarkObject } from "../../src/doc/watermark";

const img = (extra: Partial<ImageObject> = {}): ImageObject => ({ id: newObjectId(), kind: "image", anchor: { x: D.fromNumber(10), y: D.fromNumber(20) }, unit: 0, z: 1, opacity: 1, attachmentTargetId: null, assetId: "a".repeat(64), w: 200, h: 100, pixelW: 400, pixelH: 200, ...extra });
const LOGO = { src: "data:image/png;base64,AAAA", w: 40, h: 20 };
const at = (o: { anchor: ImageObject["anchor"] }): [number, number] => [D.toNumber(o.anchor.x), D.toNumber(o.anchor.y)];

beforeAll(() => setFont(parseFont(new Uint8Array(readFileSync("node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf")))));

describe("visible watermarks", () => {
  it("a picture one sits centred where it is placed, as a part of the picture's box, and turns with the picture", () => {
    const o = img({ watermark: { ...newWatermark({ logo: LOGO }), x: 0.25, y: 0.5, size: 0.2 } });
    const m = watermarkObject(o) as ImageObject;
    expect([m.w, m.h]).toEqual([40, 20]); // a fifth of 200 wide, the logo's shape
    expect(at(m)).toEqual([10 + 50 - 20, 20 + 50 - 10]);
    expect([m.id, m.opacity, m.rot]).toEqual([o.id, 0.5, undefined]);
    // The picture turned half a turn: the watermark's centre goes to the other side of the picture's centre, and it is turned too.
    const t = watermarkObject({ ...o, rot: TURN / 2 }) as ImageObject;
    expect(at(t)[0]).toBeCloseTo(10 + 150 - 20, 9);
    expect(at(t)[1]).toBeCloseTo(20 + 50 - 10, 9);
    expect(t.rot).toBe(TURN / 2);
  });
  it("a text one is as wide as its size says, in the picture's colour and font size worked out from its width", () => {
    const o = img({ watermark: newWatermark({ text: "© Me", color: "#ffffff" }) });
    const t = watermarkObject(o) as TextObject;
    expect(t.kind).toBe("text");
    expect(t.w).toBeCloseTo(100, 9); // half the picture's width
    expect(t.size * o.watermark!.em!).toBeCloseTo(100, 9);
    expect(watermarkBox(o).h).toBeCloseTo(100 * o.watermark!.ar, 9);
  });
  it("is kept back from the place, size and turn it is dragged to, and saved and read back; a bad one is refused", () => {
    const o = img({ watermark: newWatermark({ logo: LOGO }) });
    const wm = placed(o, o.watermark!, 150, 25, 80, Math.PI / 2);
    expect([wm.x, wm.y, wm.size, wm.turn]).toEqual([0.75, 0.25, 0.4, 90]);
    const back = deserializeObject(serializeObject({ ...o, watermark: wm })) as ImageObject;
    expect(back.watermark).toEqual(wm);
    expect(validWatermark({ ...wm, text: "both" })).toBe(false); // a text and a picture at once
    expect(validWatermark({ ...wm, logo: { ...LOGO, src: "javascript:alert(1)" } })).toBe(false);
    expect(validWatermark({ ...wm, opacity: 0 })).toBe(false);
    expect(() => deserializeObject({ ...serializeObject(o), watermark: { ...wm, x: Number.NaN } })).toThrow();
  });
});
