import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./harness";
import { makePng } from "./png";

/** Files that open in a view of their own (ui/file-views.ts), beyond notes: in the library and on a canvas. */

/** A small PDF made here: its pages' sizes and a word on each. */
function makePdf(pages: ReadonlyArray<{ w: number; h: number; word: string }>): Buffer {
  const objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((pg, i) => {
    const text = `BT /F1 40 Tf 20 ${pg.h - 60} Td (${pg.word}) Tj ET 0 0 ${pg.w / 2} 30 re f`;
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pg.w} ${pg.h}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    at[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(at[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const PDF = makePdf([{ w: 300, h: 400, word: "Alpha" }, { w: 400, h: 300, word: "Beta" }, { w: 300, h: 400, word: "Gamma" }]);
const HASH = createHash("sha256").update(PDF).digest("hex");
const card = (p: Page) => p.locator(`[data-testid="asset-card"][data-hash="${HASH}"]`);
const view = (p: Page) => p.getByTestId("pdf-view");
const importPdf = async (p: Page): Promise<void> => {
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "book.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(card(p)).toHaveCount(1, { timeout: 15_000 });
};
/** The details beside the viewer, shown (they may still be opening or closing as the viewer opens). */
const detailsShown = (p: Page) =>
  expect(async () => {
    if (!(await p.getByTestId("asset-place").isVisible())) await p.locator(".viewer-details").click();
    await expect(p.getByTestId("asset-place")).toBeVisible({ timeout: 1000 });
  }).toPass();
/** Whether a page's picture has ink on it. */
const inked = (p: Page, page: number) =>
  view(p).locator(`.pdf-page[data-page="${page}"] canvas`).evaluate((c: HTMLCanvasElement) => c.width > 0 && c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 0 && v < 128));

test("a PDF: its first page in the library, its shape on a card; it opens in the viewer at the page it was left at, with bookmarks and its words", async ({ app }) => {
  const p = app.page;
  await importPdf(p);
  // A thumbnail of the first page rather than the file tile.
  await expect(card(p).locator(".asset-thumb img")).toBeVisible();
  await expect.poll(() => card(p).locator(".asset-thumb img").evaluate((i: HTMLImageElement) => [i.naturalWidth > 0, i.naturalWidth / Math.max(1, i.naturalHeight) < 1])).toEqual([true, true]);
  await card(p).dblclick();
  await expect(view(p)).toBeVisible();
  await expect(p.getByTestId("pdf-page")).toHaveValue("1");
  await expect(view(p).locator('.pdf-page[data-page="1"][data-drawn]')).toBeVisible();
  await expect.poll(() => inked(p, 1)).toBe(true);
  await expect(view(p).locator('.pdf-page[data-page="1"] .textLayer')).toContainText("Alpha");
  // Pages have their own sizes once read.
  await p.getByTestId("pdf-page").fill("2");
  await p.getByTestId("pdf-page").press("Enter");
  await expect(view(p).locator('.pdf-page[data-page="2"][data-drawn]')).toBeVisible();
  const [w, h] = await view(p).locator('.pdf-page[data-page="2"]').evaluate((e) => [e.clientWidth, e.clientHeight]);
  expect(w! / h!).toBeCloseTo(4 / 3, 1);
  // A bookmark, in the details and off again.
  await p.getByTestId("pdf-mark").click();
  await expect(p.getByTestId("pdf-mark")).toHaveAttribute("aria-pressed", "true");
  await detailsShown(p);
  await expect(p.getByTestId("asset-bookmarks")).toContainText("Page 2");
  // Keys: the pages' own, and the arrows stay the viewer's.
  await p.getByTestId("pdf-pages").click();
  await p.keyboard.press("PageDown");
  await expect(p.getByTestId("pdf-page")).toHaveValue("3");
  await p.keyboard.press("PageUp");
  await expect(p.getByTestId("pdf-page")).toHaveValue("2");
  // The details' row goes to it.
  await p.keyboard.press("Home");
  await expect(p.getByTestId("pdf-page")).toHaveValue("1");
  await p.getByTestId("asset-bookmarks").getByRole("button", { name: /Go to|Page 2/ }).first().click();
  await expect(p.getByTestId("pdf-page")).toHaveValue("2");
  // Left and opened again: where it was.
  await p.waitForTimeout(800);
  await p.keyboard.press("Escape");
  await expect(view(p)).toBeHidden();
  await card(p).dblclick();
  await expect(p.getByTestId("pdf-page")).toHaveValue("2");
  await expect(p.getByTestId("pdf-mark")).toHaveAttribute("aria-pressed", "true");
  expect(app.consoleErrors).toEqual([]);
});

test("a PDF's card on a canvas has its page's shape, opens in the panel, and a copy can show another page", async ({ app }) => {
  const p = app.page;
  await importPdf(p);
  await card(p).dblclick();
  await expect(view(p)).toBeVisible();
  await detailsShown(p);
  await p.getByTestId("asset-place").click();
  const pics = () => p.evaluate(() => window.__canvastDebug.objects().filter((o) => o.kind === "image") as unknown as Array<{ id: string; w: number; h: number; pixelW: number; pixelH: number; preview?: string }>);
  await expect.poll(async () => (await pics()).length).toBe(1);
  const one = (await pics())[0]!;
  expect(one.w / one.h).toBeCloseTo(3 / 4, 2);
  expect(one.preview).toBeUndefined();
  const box = (await p.locator("canvas").first().boundingBox())!;
  await p.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const panel = p.getByTestId("note-panel");
  await expect(panel.getByTestId("pdf-view")).toBeVisible();
  await expect(panel.locator('.pdf-page[data-page="1"][data-drawn]')).toBeVisible();
  await panel.getByTestId("pdf-page").fill("2");
  await panel.getByTestId("pdf-page").press("Enter");
  await panel.getByTestId("pdf-card").click();
  await expect.poll(async () => (await pics())[0]!.preview).toBe("2");
  const now = (await pics())[0]!;
  expect(now.w).toBeCloseTo(one.w, 3);
  expect(now.w / now.h).toBeCloseTo(4 / 3, 2);
  // One step of undo; the picture is drawn from that page.
  await p.locator("canvas").first().click({ position: { x: 5, y: 5 } });
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await pics())[0]!.preview).toBeUndefined();
  expect(app.consoleErrors).toEqual([]);
});

/** A cube as an ASCII STL. */
const STL = Buffer.from(`solid cube\n${[[0, 0, 0, 1, 0, 0, 1, 1, 0], [0, 0, 0, 1, 1, 0, 0, 1, 0], [0, 0, 1, 1, 0, 1, 1, 1, 1], [0, 0, 1, 1, 1, 1, 0, 1, 1], [0, 0, 0, 1, 0, 0, 1, 0, 1], [0, 0, 0, 1, 0, 1, 0, 0, 1]].map((t) => `facet normal 0 0 1\nouter loop\nvertex ${t.slice(0, 3).join(" ")}\nvertex ${t.slice(3, 6).join(" ")}\nvertex ${t.slice(6).join(" ")}\nendloop\nendfacet`).join("\n")}\nendsolid cube\n`);

/** One triangle as a .glb with a picture inside it, read without a fetch (the page's rules forbid one). */
function makeGlb(): Buffer {
  const pos = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const uv = Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1]).buffer);
  const png = makePng(2, 2, () => [200, 40, 40, 255]);
  const pad = (b: Buffer, fill = 0): Buffer => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const bin = pad(Buffer.concat([pos, uv, pad(png)]));
  const json = pad(Buffer.from(JSON.stringify({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }], textures: [{ source: 0 }],
    images: [{ bufferView: 2, mimeType: "image/png" }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }, { buffer: 0, byteOffset: 60, byteLength: png.length }],
    buffers: [{ byteLength: bin.length }],
  })), 0x20);
  const head = Buffer.alloc(12);
  head.write("glTF", 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const chunk = (b: Buffer, kind: string): Buffer => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(b.length, 0);
    h.write(kind, 4, "latin1");
    return Buffer.concat([h, b]);
  };
  return Buffer.concat([head, chunk(json, "JSON"), chunk(bin, "BIN\0")]);
}

const hasGl = (p: Page) => p.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
const modelView = (p: Page) => p.getByTestId("model-view");
const importModel = async (p: Page, name: string, buffer: Buffer): Promise<ReturnType<Page["locator"]>> => {
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer });
  const c = p.locator(`[data-testid="asset-card"][title="${name}"]`);
  await expect(c).toHaveCount(1, { timeout: 15_000 });
  return c;
};
/** Share of the stage's pixels that show something other than its background. */
const painted = (p: Page) =>
  p.getByTestId("model-stage").locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const t = document.createElement("canvas");
    t.width = 64;
    t.height = 64;
    const g = t.getContext("2d")!;
    g.drawImage(c, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data, at = [d[0], d[1], d[2], d[3]];
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i]! - at[0]!) + Math.abs(d[i + 1]! - at[1]!) + Math.abs(d[i + 2]! - at[2]!) + Math.abs(d[i + 3]! - at[3]!) > 24) n++;
    return n / (64 * 64);
  });

test("a 3D model: a picture in the library, a view that turns, is lit and keeps its place, bookmarks; a card on a canvas can show the view, on no background", async ({ app }) => {
  const p = app.page;
  test.skip(!(await hasGl(p)), "no 3D graphics in this browser here");
  const c = await importModel(p, "cube.stl", STL);
  await expect.poll(() => c.locator(".asset-thumb img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await c.dblclick();
  await expect(modelView(p)).toBeVisible();
  await expect(p.locator('[data-testid="model-stage"][data-drawn]')).toBeVisible();
  await expect.poll(() => painted(p)).toBeGreaterThan(0.01);
  // A drag turns it: the number in the settings follows.
  const yaw = () => p.locator('[data-testid="model-side"] [data-k="yaw"] input[type=number]').inputValue();
  const before = await yaw();
  const box = (await p.getByTestId("model-stage").boundingBox())!;
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 4 });
  await p.mouse.up();
  await expect.poll(yaw).not.toBe(before);
  const turned = await yaw();
  // A lighting setup sets its lights.
  await p.getByTestId("model-lights").click();
  await p.getByRole("menuitem", { name: /Split/ }).click();
  await expect(p.locator('[data-testid="model-side"] [data-k="keyAround"] input[type=number]')).toHaveValue("-90");
  // A bookmark in the details, as a PDF's.
  await p.getByTestId("model-mark").click();
  await detailsShown(p);
  await expect(p.getByTestId("asset-bookmarks")).toContainText("View 1");
  // Left and opened again: as it was. (The arrows stay the viewer's: no second item here, so it stays.)
  await p.waitForTimeout(800);
  await p.keyboard.press("Escape");
  await expect(modelView(p)).toBeHidden();
  await c.dblclick();
  await expect(modelView(p)).toBeVisible();
  await expect.poll(yaw).toBe(turned);
  // On a canvas: the panel, and this view on this card, with no background.
  await detailsShown(p);
  await p.getByTestId("asset-place").click();
  const pic = () => p.evaluate(() => window.__canvastDebug.objects().find((o) => o.kind === "image") as unknown as { w: number; h: number; preview?: string } | undefined);
  await expect.poll(async () => !!(await pic())).toBe(true);
  const at = (await p.locator("canvas").first().boundingBox())!;
  await p.mouse.dblclick(at.x + at.width / 2, at.y + at.height / 2);
  const panel = p.getByTestId("note-panel");
  await expect(panel.getByTestId("model-view")).toBeVisible();
  await panel.locator('[data-k="bg"] [data-eye]').click();
  await panel.getByTestId("model-card").click();
  await expect.poll(async () => JSON.parse((await pic())?.preview ?? "{}").bg).toBe("");
  expect(app.consoleErrors).toEqual([]);
});

test("a .glb with its picture inside opens without a fetch, a broken file stays a card and says so", async ({ app }) => {
  const p = app.page;
  test.skip(!(await hasGl(p)), "no 3D graphics in this browser here");
  const c = await importModel(p, "one.glb", makeGlb());
  await c.dblclick();
  await expect(modelView(p)).toBeVisible();
  await expect.poll(() => painted(p)).toBeGreaterThan(0.01);
  await p.keyboard.press("Escape");
  await expect(modelView(p)).toBeHidden();
  const bad = await importModel(p, "bad.glb", Buffer.from("this is no model"));
  await bad.dblclick();
  await expect(p.locator('[data-testid="slide-view"] figcaption')).toContainText("could not be opened");
  expect(app.consoleErrors).toEqual([]);
});
