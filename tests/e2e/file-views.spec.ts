import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
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
  // Ctrl+wheel zooms it, in the viewer.
  const pageW = () => view(p).locator('.pdf-page[data-page="2"]').evaluate((e) => e.clientWidth);
  const wide = await pageW();
  const over = (await p.getByTestId("pdf-pages").boundingBox())!;
  await p.mouse.move(over.x + over.width / 2, over.y + over.height / 2);
  await p.keyboard.down("Control");
  await p.mouse.wheel(0, 200);
  await p.keyboard.up("Control");
  await expect.poll(pageW).toBeLessThan(wide);
  await p.getByTestId("view-fit").click();
  // Zoomed past the view, all of the page can be scrolled to: both edges.
  await p.keyboard.down("Control");
  await p.mouse.wheel(0, -600);
  await p.keyboard.up("Control");
  await expect.poll(async () => p.getByTestId("pdf-pages").evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  const edges = () => p.getByTestId("pdf-pages").evaluate((e) => {
    e.scrollLeft = 0;
    const page = e.querySelector('.pdf-page[data-page="2"]')!.getBoundingClientRect(), box = e.getBoundingClientRect();
    const left = page.left >= box.left;
    e.scrollLeft = e.scrollWidth;
    const after = e.querySelector('.pdf-page[data-page="2"]')!.getBoundingClientRect();
    return [left, after.right <= box.right];
  });
  expect(await edges()).toEqual([true, true]);
  await p.getByTestId("view-fit").click();
  // A bookmark, in the details and off again.
  await p.getByTestId("view-mark").click();
  await expect(p.getByTestId("view-mark")).toHaveAttribute("aria-pressed", "true");
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
  await expect(p.getByTestId("view-mark")).toHaveAttribute("aria-pressed", "true");
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
  // Ctrl+wheel zooms it in the panel too, and leaves the canvas where it was.
  const camera = () => p.evaluate(() => JSON.stringify(window.__canvastDebug.objectScreen(window.__canvastDebug.objects()[0]!.id)));
  const seen = await camera();
  const panelW = () => panel.locator('.pdf-page[data-page="1"]').evaluate((e) => e.clientWidth);
  const was = await panelW();
  const over = (await panel.getByTestId("pdf-pages").boundingBox())!;
  await p.mouse.move(over.x + over.width / 2, over.y + over.height / 2);
  await p.keyboard.down("Control");
  await p.mouse.wheel(0, 200);
  await p.keyboard.up("Control");
  await expect.poll(panelW).toBeLessThan(was);
  expect(await camera()).toBe(seen);
  await panel.getByTestId("pdf-page").fill("2");
  await panel.getByTestId("pdf-page").press("Enter");
  await panel.getByTestId("view-card").click();
  await expect.poll(async () => (await pics())[0]!.preview).toBe("2");
  const now = (await pics())[0]!;
  expect(now.w).toBeCloseTo(one.w, 3);
  expect(now.w / now.h).toBeCloseTo(4 / 3, 2);
  // A copy shows what its card shows (Ctrl+D, as Alt+drag and paste make theirs), and so does a saved canvas; idle, nothing keeps drawing.
  await panel.locator("[data-close]").click();
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.keyboard.press("Control+d");
  await expect.poll(async () => (await pics()).map((o) => o.preview)).toEqual(["2", "2"]);
  expect((await pics())[1]!.pixelW).toBe(now.pixelW);
  if (test.info().project.name.startsWith("chromium")) {
    await p.waitForTimeout(1500); // (its picture being drawn)
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Performance.enable");
    const busy = async (): Promise<number> => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration")!.value;
    const was = await busy();
    await p.waitForTimeout(3000);
    expect((await busy()) - was, "seconds of work in 3 idle seconds").toBeLessThan(0.6);
  }
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await pics()).length).toBe(1);
  // One step of undo; the picture is drawn from that page.
  await p.keyboard.press("Control+z");
  await expect.poll(async () => (await pics())[0]!.preview).toBeUndefined();
  expect(app.consoleErrors).toEqual([]);
});

/** A cube as an ASCII STL. */
const STL = Buffer.from(`solid cube\n${[[0, 0, 0, 1, 0, 0, 1, 1, 0], [0, 0, 0, 1, 1, 0, 0, 1, 0], [0, 0, 1, 1, 0, 1, 1, 1, 1], [0, 0, 1, 1, 1, 1, 0, 1, 1], [0, 0, 0, 1, 0, 0, 1, 0, 1], [0, 0, 0, 1, 0, 1, 0, 0, 1]].map((t) => `facet normal 0 0 1\nouter loop\nvertex ${t.slice(0, 3).join(" ")}\nvertex ${t.slice(3, 6).join(" ")}\nvertex ${t.slice(6).join(" ")}\nendloop\nendfacet`).join("\n")}\nendsolid cube\n`);

/** One triangle as a .glb with a picture inside it, read without a fetch (the page's rules forbid one). */
function makeGlb(moving = false): Buffer {
  const pos = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const uv = Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1]).buffer);
  const png = makePng(2, 2, () => [200, 40, 40, 255]);
  const when = Buffer.from(new Float32Array([0, 1]).buffer);
  const where = Buffer.from(new Float32Array([0, 0, 0, 0.5, 0.5, 0]).buffer);
  const pad = (b: Buffer, fill = 0): Buffer => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const animAt = 60 + pad(png).length;
  const bin = pad(Buffer.concat([pos, uv, pad(png), ...(moving ? [when, where] : [])]));
  const json = pad(Buffer.from(JSON.stringify({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }], textures: [{ source: 0 }],
    images: [{ bufferView: 2, mimeType: "image/png" }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" }, ...(moving ? [{ bufferView: 3, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] }, { bufferView: 4, componentType: 5126, count: 2, type: "VEC3" }] : [])],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }, { buffer: 0, byteOffset: 60, byteLength: png.length }, ...(moving ? [{ buffer: 0, byteOffset: animAt, byteLength: 8 }, { buffer: 0, byteOffset: animAt + 8, byteLength: 24 }] : [])],
    ...(moving ? { animations: [{ name: "Walk", samplers: [{ input: 2, output: 3, interpolation: "LINEAR" }], channels: [{ sampler: 0, target: { node: 0, path: "translation" } }] }] } : {}),
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
  // Resets, as a pattern's: a name's double-click, a group's button, the whole.
  const focal = p.locator('[data-testid="model-side"] [data-k="focal"] input[type=number]');
  await focal.fill("120");
  await expect(focal).toHaveValue("120");
  await p.locator('[data-testid="model-side"] [data-k="focal"] .adj-label').dblclick();
  await expect(focal).toHaveValue("50");
  await focal.fill("120");
  await p.locator('[data-testid="model-side"] [data-group-reset="Camera"]').click();
  await expect(focal).toHaveValue("50");
  await focal.fill("120");
  await p.getByTestId("view-reset").click();
  await expect(focal).toHaveValue("50");
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
  await p.getByTestId("view-lights").click();
  await p.getByRole("menuitem", { name: /Split/ }).click();
  await expect(p.locator('[data-testid="model-side"] [data-k="keyAround"] input[type=number]')).toHaveValue("-90");
  // A bookmark in the details, as a PDF's.
  await p.getByTestId("view-mark").click();
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
  // Opened from a card it starts at what the card shows (here its first look), wherever the viewer left the file.
  await expect(panel.locator('[data-k="yaw"] input[type=number]')).toHaveValue("35");
  await panel.locator('[data-k="bg"] [data-eye]').click();
  await panel.getByTestId("view-card").click();
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

/** A black square in JPEG 2000, as a scanned page has: read by a decoder inside the file. */
const JP2 = Buffer.from("AAAADGpQICANCocKAAAAFGZ0eXBqcDIgAAAAAGpwMiAAAAAtanAyaAAAABZpaGRyAAAAEAAAABAAAw8HAAAAAAAPY29scgEAAAAAABAAAAClanAyY/9P/1EALwAAAAAAEAAAABAAAAAAAAAAAAAAABAAAAAQAAAAAAAAAAAAAw8BAQ8BAQ8BAf9SAAwAAAABAQQEBAAB/1wAEECAiIiQiIiQiIiQiIiQ/2QAJQABQ3JlYXRlZCBieSBPcGVuSlBFRyB2ZXJzaW9uIDIuNS40/5AACgAAAAAAIQAB/5Pf+JAIB4CAgICAgICAgICAgICA/9k=", "base64");

/** A PDF of one page drawn from a JPEG 2000 picture. */
function scannedPdf(): Buffer {
  const parts: Buffer[] = [];
  let at = 0;
  const put = (x: Buffer | string): void => {
    const b = typeof x === "string" ? Buffer.from(x, "latin1") : x;
    parts.push(b);
    at += b.length;
  };
  put("%PDF-1.5\n");
  const off: number[] = [];
  const obj = (n: number, body: Buffer | string): void => {
    off[n] = at;
    put(`${n} 0 obj\n`);
    put(body);
    put("\nendobj\n");
  };
  const draw = "q 200 0 0 200 20 20 cm /Im0 Do Q";
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Count 1 /Kids [3 0 R] >>");
  obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 240] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>");
  obj(4, Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /Filter /JPXDecode /Length ${JP2.length} >>\nstream\n`), JP2, Buffer.from("\nendstream")]));
  obj(5, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  const xref = at;
  put(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(off[n]).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

/** A PDF with a password (the standard handler, 40 bits): a page with no stream, so nothing else needs enciphering. */
function lockedPdf(password: string): Buffer {
  const PAD = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");
  const rc4 = (key: Buffer, data: Buffer): Buffer => {
    const s = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 0, j = 0; i < 256; i++) {
      j = (j + s[i]! + key[i % key.length]!) & 255;
      [s[i], s[j]] = [s[j]!, s[i]!];
    }
    let i = 0, j = 0;
    return Buffer.from(data.map((b) => {
      i = (i + 1) & 255;
      j = (j + s[i]!) & 255;
      [s[i], s[j]] = [s[j]!, s[i]!];
      return b ^ s[(s[i]! + s[j]!) & 255]!;
    }));
  };
  const pad = Buffer.concat([Buffer.from(password, "latin1"), PAD]).subarray(0, 32);
  const O = rc4(createHash("md5").update(PAD).digest().subarray(0, 5), PAD); // (an owner's password of nothing)
  const id = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const P = Buffer.alloc(4);
  P.writeInt32LE(-4);
  const U = rc4(createHash("md5").update(Buffer.concat([pad, O, P, id])).digest().subarray(0, 5), PAD);
  const objs = ["", "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 1 /Kids [3 0 R] >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>", `<< /Filter /Standard /V 1 /R 2 /O <${O.toString("hex")}> /U <${U.toString("hex")}> /P -4 >>`];
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    at[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(at[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Encrypt 4 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const openPdfNamed = async (p: Page, name: string, buffer: Buffer): Promise<void> => {
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name, mimeType: "application/pdf", buffer });
  const c = p.locator(`[data-testid="asset-card"][title="${name}"]`);
  await expect(c).toHaveCount(1, { timeout: 15_000 });
  await c.dblclick();
};

test("a scanned page (JPEG 2000) is drawn by the decoder inside the file", async ({ app }) => {
  const p = app.page;
  await openPdfNamed(p, "scan.pdf", scannedPdf());
  await expect(view(p).locator('.pdf-page[data-page="1"][data-drawn]')).toBeVisible();
  await expect.poll(() => inked(p, 1)).toBe(true);
  expect(app.consoleErrors).toEqual([]);
});

test("a PDF with a password asks for it, says when it is wrong, and stays a card if it is not given", async ({ app }) => {
  const p = app.page;
  await openPdfNamed(p, "locked.pdf", lockedPdf("open sesame"));
  await p.getByTestId("prompt-input").fill("wrong");
  await p.getByTestId("prompt-ok").click();
  await expect(p.getByTestId("prompt-dialog")).toContainText("not the one");
  await p.getByTestId("prompt-input").fill("open sesame");
  await p.getByTestId("prompt-ok").click();
  await expect(p.getByTestId("pdf-page")).toHaveValue("1");
  await p.keyboard.press("Escape");
  await expect(view(p)).toBeHidden();
  await p.locator('[data-testid="asset-card"][title="locked.pdf"]').dblclick();
  await p.getByTestId("prompt-dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(p.locator('[data-testid="slide-view"] figcaption')).toContainText("has a password");
  expect(app.consoleErrors).toEqual([]);
});

test("a long PDF: only what is near is drawn; find goes to the page; the library's search finds its words", async ({ app }) => {
  const p = app.page;
  const many = makePdf(Array.from({ length: 300 }, (_, i) => ({ w: 300, h: 400, word: i === 249 ? "Needle" : `Page${i + 1}` })));
  await openPdfNamed(p, "long.pdf", many);
  await expect(view(p).locator('.pdf-page[data-page="1"][data-drawn]')).toBeVisible();
  await p.getByTestId("pdf-pages").click();
  await p.keyboard.press("End");
  await expect(p.getByTestId("pdf-page")).toHaveValue("300");
  await expect(view(p).locator('.pdf-page[data-page="300"][data-drawn]')).toBeVisible();
  await expect.poll(() => view(p).locator(".pdf-page[data-drawn]").count()).toBeLessThan(12);
  await p.keyboard.press("Control+f");
  await expect(p.getByTestId("pdf-find")).toBeFocused();
  await p.getByTestId("pdf-find").fill("needle");
  await expect(p.getByTestId("pdf-found")).toHaveText("Page 250", { timeout: 30_000 });
  await expect(p.getByTestId("pdf-page")).toHaveValue("250");
  await p.getByTestId("pdf-find").fill("nowhere at all");
  await expect(p.getByTestId("pdf-found")).toHaveText("Not found", { timeout: 30_000 });
  await p.getByTestId("pdf-pages").click();
  await p.keyboard.press("Escape");
  await expect(view(p)).toBeHidden();
  await p.getByTestId("assets-search").fill("needle");
  await expect(p.locator('[data-testid="asset-card"][title="long.pdf"]')).toHaveCount(1, { timeout: 30_000 });
  await p.getByTestId("assets-search").fill("nothingofthiskind");
  await expect(p.locator('[data-testid="asset-card"]')).toHaveCount(0);
  expect(app.consoleErrors).toEqual([]);
});

test("on a canvas: pages placed as cards, one step of undo; the panel closes and opens again", async ({ app }) => {
  const p = app.page;
  await importPdf(p);
  await card(p).dblclick();
  await expect(view(p)).toBeVisible();
  await detailsShown(p);
  await p.getByTestId("asset-place").click();
  const pics = () => p.evaluate(() => window.__canvastDebug.objects().filter((o) => o.kind === "image") as unknown as Array<{ preview?: string; w: number; h: number }>);
  await expect.poll(async () => (await pics()).length).toBe(1);
  const box = (await p.locator("canvas").first().boundingBox())!;
  await p.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const panel = p.getByTestId("note-panel");
  await expect(panel.getByTestId("pdf-view")).toBeVisible();
  await panel.getByTestId("view-place").click();
  await p.getByTestId("prompt-input").fill("2-3, 99");
  await p.getByTestId("prompt-ok").click();
  await expect.poll(async () => (await pics()).map((o) => o.preview ?? "")).toEqual(["", "2", "3"]);
  const made = await pics();
  expect(made[1]!.w / made[1]!.h).toBeCloseTo(4 / 3, 2);
  expect(made[2]!.w / made[2]!.h).toBeCloseTo(3 / 4, 2);
  await panel.locator("[data-close]").click();
  await expect(panel).toBeHidden();
  await p.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel.getByTestId("pdf-view")).toBeVisible();
  await expect(panel.locator(".pdf-page[data-drawn]").first()).toBeVisible();
  expect(app.consoleErrors).toEqual([]);
});

test("a 3D model's study tools: tones in flat steps, a mirror, a pose from its animation, a turnaround of eight cards", async ({ app }) => {
  const p = app.page;
  test.skip(!(await hasGl(p)), "no 3D graphics in this browser here");
  const c = await importModel(p, "moving.glb", makeGlb(true));
  await c.dblclick();
  await expect(modelView(p)).toBeVisible();
  const side = p.getByTestId("model-side");
  // A surface in steps of value: its row appears with it.
  await expect(side.locator('[data-k="tones"]')).toHaveCount(0);
  await side.locator('[data-k="surface"] [data-v="tones"]').click();
  await side.locator('[data-k="tones"] input[type=number]').fill("2");
  await expect.poll(() => painted(p)).toBeGreaterThan(0.001);
  // Mirror.
  await side.locator('[data-k="mirror"] input').check();
  await expect(p.getByTestId("model-stage")).toHaveClass(/is-mirrored/);
  await side.locator('[data-k="mirror"] input').uncheck();
  // The pose moves the model.
  const look = () => p.getByTestId("model-stage").locator("canvas").evaluate((x: HTMLCanvasElement) => x.toDataURL());
  await expect.poll(() => side.locator('[data-k="clip"]').count()).toBe(1);
  await p.waitForTimeout(200);
  const at0 = await look();
  await side.locator('[data-k="poseTime"] input[type=number]').fill("1");
  await expect.poll(look).not.toBe(at0);
  // On a canvas: eight cards, each from its own side.
  await detailsShown(p);
  await p.getByTestId("asset-place").click();
  const pics = () => p.evaluate(() => window.__canvastDebug.objects().filter((o) => o.kind === "image") as unknown as Array<{ preview?: string }>);
  await expect.poll(async () => (await pics()).length).toBe(1);
  const box = (await p.locator("canvas").first().boundingBox())!;
  await p.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const panel = p.getByTestId("note-panel");
  await expect(panel.getByTestId("model-view")).toBeVisible();
  await panel.getByTestId("view-turn").click();
  await expect.poll(async () => (await pics()).length).toBe(9);
  const yaws = (await pics()).slice(1).map((o) => (JSON.parse(o.preview!) as { yaw?: number }).yaw ?? 35);
  expect(new Set(yaws).size).toBe(8);
  expect(app.consoleErrors).toEqual([]);
});

test("idle, nothing keeps working: the library, the viewer on a PDF or a model, the canvas with their cards and copies, the panel", async ({ app }) => {
  const p = app.page;
  test.skip(!test.info().project.name.startsWith("chromium") || !(await hasGl(p)), "measured in Chromium, which reports it");
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Performance.enable");
  const busy = async (): Promise<number> => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration")!.value;
  /** Seconds of the page's work over three seconds of doing nothing, after what was asked has settled. */
  const idle = async (where: string): Promise<void> => {
    await p.waitForTimeout(2000);
    const was = await busy();
    await p.waitForTimeout(3000);
    expect((await busy()) - was, `seconds of work in 3 idle seconds: ${where}`).toBeLessThan(0.6);
  };
  await importPdf(p);
  const model = await importModel(p, "cube.stl", STL);
  await expect.poll(() => card(p).locator(".asset-thumb img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await idle("the library with a PDF and a model");
  await card(p).dblclick();
  await expect(view(p).locator('.pdf-page[data-page="1"][data-drawn]')).toBeVisible();
  await idle("the viewer on a PDF");
  await p.keyboard.press("Escape");
  await expect(view(p)).toBeHidden();
  await model.dblclick();
  await expect(p.locator('[data-testid="model-stage"][data-drawn]')).toBeVisible();
  await idle("the viewer on a model");
  await detailsShown(p);
  await p.getByTestId("asset-place").click();
  const pics = () => p.evaluate(() => window.__canvastDebug.objects().filter((o) => o.kind === "image") as unknown as Array<{ preview?: string }>);
  await expect.poll(async () => (await pics()).length).toBe(1);
  const box = (await p.locator("canvas").first().boundingBox())!;
  await p.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const panel = p.getByTestId("note-panel");
  await expect(panel.getByTestId("model-view")).toBeVisible();
  await idle("the panel on a model");
  await panel.getByTestId("view-card").click();
  await panel.locator("[data-close]").click();
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.keyboard.press("Control+d");
  await expect.poll(async () => (await pics()).length).toBe(2);
  expect(new Set((await pics()).map((o) => o.preview)).size).toBe(1);
  await idle("the canvas with a card showing a view and its copy");
  expect(app.consoleErrors).toEqual([]);
});

test("a large 3D model (over 64 MB, read off the page): a picture in the library, it opens, and the page keeps working meanwhile", async ({ app }) => {
  const p = app.page;
  test.skip(test.info().project.name !== "chromium" || !(await hasGl(p)), "one large file, once");
  const n = 1_400_000;
  const big = Buffer.alloc(84 + n * 50);
  big.writeUInt32LE(n, 80);
  for (let i = 0; i < n; i++) {
    const at = 84 + i * 50, x = (i % 1200) / 1200, y = Math.floor(i / 1200) / 1200;
    const v = [x, y, 0, x + 0.001, y, 0, x, y + 0.001, Math.sin(x * 9)];
    v.forEach((c, j) => big.writeFloatLE(c, at + 12 + j * 4));
  }
  const file = test.info().outputPath("big.stl");
  writeFileSync(file, big);
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles(file);
  const c = p.locator('[data-testid="asset-card"][title="big.stl"]');
  await expect(c).toHaveCount(1, { timeout: 60_000 });
  await expect.poll(() => c.locator(".asset-thumb img").evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 60_000 }).toBeGreaterThan(0);
  await c.dblclick();
  await expect(modelView(p)).toBeVisible({ timeout: 60_000 });
  await expect(p.locator('[data-testid="model-stage"][data-drawn]')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => painted(p)).toBeGreaterThan(0.001);
  expect(app.consoleErrors).toEqual([]);
});

test("line art of a 3D model: live over it or alone, and placed on the canvas as editable paths", async ({ app }) => {
  const p = app.page;
  test.skip(!(await hasGl(p)), "no 3D graphics in this browser here");
  const c = await importModel(p, "cube.stl", STL);
  await c.dblclick();
  await expect(modelView(p)).toBeVisible();
  const side = p.getByTestId("model-side");
  await expect(side.locator('[data-k="linesWidth"]')).toHaveCount(0);
  const look = () => p.getByTestId("model-stage").locator("canvas").evaluate((x: HTMLCanvasElement) => x.toDataURL());
  await p.waitForTimeout(200);
  const plain = await look();
  await side.locator('[data-k="linesShow"] [data-v="over"]').click();
  await expect(side.locator('[data-k="linesWidth"]')).toHaveCount(1);
  await expect.poll(look).not.toBe(plain);
  await side.locator('[data-k="linesShow"] [data-v="only"]').click();
  await expect(side.locator('[data-k="bg"] code')).toHaveText("#FFFFFF");
  await expect.poll(() => painted(p)).toBeGreaterThan(0.001);
  await detailsShown(p);
  await p.getByTestId("asset-place").click();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().filter((o) => o.kind === "image").length)).toBe(1);
  const box = (await p.locator("canvas").first().boundingBox())!;
  await p.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const panel = p.getByTestId("note-panel");
  await expect(panel.getByTestId("model-view")).toBeVisible();
  await expect(panel.locator('[data-testid="model-stage"][data-drawn]')).toBeVisible();
  await panel.getByTestId("view-lines").click();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().filter((o) => o.kind === "path").length), { timeout: 30_000 }).toBeGreaterThan(0);
  const path = await p.evaluate(() => window.__canvastDebug.objects().find((o) => o.kind === "path") as unknown as { fill: unknown; stroke: unknown });
  expect(path.fill).toBeNull();
  expect(path.stroke).toBeTruthy();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().filter((o) => o.kind === "image").length)).toBe(1);
  expect(app.consoleErrors).toEqual([]);
});
