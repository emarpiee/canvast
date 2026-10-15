import type { BrowserContext, Page } from "@playwright/test";
import { APP_URL, expect, recordMetric, test } from "./harness";
import type { App } from "./harness";
import { blockyFixture } from "./png";

/**
 * Slice 1h: text objects. Content is checked as stored canonical Markdown
 * through the debug hook; rendering is checked against exact glyph geometry
 * (textGlyphWorld), never against the screen geometry being tested.
 */

type Obj = Record<string, unknown> & { id: string; kind: string; md?: string };
const objects = (p: Page): Promise<Obj[]> => p.evaluate(() => window.__canvastDebug.objects()) as Promise<Obj[]>;
const TEXT_RGB = [0x1f, 0x23, 0x29]; // default colour
const mod = process.platform === "darwin" ? "Meta" : "Control";

/** Start a new text with the Text tool at (x, y) and type into it. */
async function newText(p: Page, x: number, y: number): Promise<void> {
  await p.keyboard.press("t");
  await p.mouse.click(x, y);
  await expect(p.getByTestId("text-editor")).toBeFocused();
}

async function finish(p: Page): Promise<void> {
  await p.keyboard.press("Escape");
  await expect(p.getByTestId("text-editor")).toBeHidden();
  await p.evaluate(() => window.__canvastDebug.nextFrame());
}

const textObjects = async (p: Page): Promise<Obj[]> => (await objects(p)).filter((o) => o.kind === "text");

function isText(c: [number, number, number]): boolean {
  return Math.abs(c[0] - TEXT_RGB[0]!) + Math.abs(c[1] - TEXT_RGB[1]!) + Math.abs(c[2] - TEXT_RGB[2]!) < 60;
}

test("type, format, save, reload and copy a text object as Markdown", async ({ app }) => {
  const p = app.page;
  await newText(p, 300, 300);
  await p.keyboard.type("Title");
  await p.getByRole("button", { name: "Heading 1" }).click();
  await p.keyboard.press("End");
  await p.keyboard.press("Enter");
  await p.keyboard.type("Body ");
  await p.keyboard.press(`${mod}+b`);
  await p.keyboard.type("bold");
  await p.keyboard.press(`${mod}+b`);
  await p.keyboard.type(" and ");
  await p.keyboard.press(`${mod}+i`);
  await p.keyboard.type("italic");
  await p.keyboard.press(`${mod}+i`);
  await p.keyboard.type(" *stars*");
  await finish(p);

  const [t] = await textObjects(p);
  expect(t?.md).toBe("# Title\n\nBody **bold** and *italic* \\*stars\\*");
  const box = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), t!.id))!.box;
  const ink = await p.evaluate(() => window.__canvastDebug.inkedPixels(2));
  expect(ink).toBeGreaterThan(100);
  expect(box.minX).toBeLessThan(300);
  expect(box.maxY - box.minY).toBeGreaterThan(16 * 2 * 1.3 + 16 * 1.3);

  // Undo removes it; redo brings it back.
  await p.keyboard.press(`${mod}+z`);
  expect(await textObjects(p)).toHaveLength(0);
  await p.keyboard.press(`${mod}+Shift+z`);
  expect((await textObjects(p))[0]?.md).toBe(t!.md);

  // Copy Markdown from the toolbar for the selected text.
  await p.keyboard.press("v");
  await p.mouse.click(box.minX + 20, box.minY + 20);
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([t!.id]);
  await p.getByRole("button", { name: "Copy Markdown" }).click();
  expect(await p.evaluate(() => window.__canvastDebug.lastCopied())).toBe(t!.md);

  // Saved and reloaded unchanged, and drawn again.
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  expect((await textObjects(p)).map((o) => o.md)).toEqual([t!.md]);
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.inkedPixels(2))).toBeGreaterThan(ink * 0.8);
  expect(app.consoleErrors).toEqual([]);
  expect(app.externalRequests).toEqual([]);
});

test("double-click edits a text; lists and pasted text become Markdown; emptying deletes it", async ({ app }) => {
  const p = app.page;
  await newText(p, 300, 300);
  await p.keyboard.type("one");
  await finish(p);
  const [t] = await textObjects(p);
  const box = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), t!.id))!.box;

  // Put formatted content on the clipboard with a real copy (trusted events in every browser).
  await p.evaluate(() => {
    const d = document.createElement("div");
    d.id = "copy-source";
    d.innerHTML = "<b># pasted &lt;b&gt;</b>";
    document.body.append(d);
    getSelection()!.selectAllChildren(d);
  });
  await p.keyboard.press(`${mod}+c`);
  await p.evaluate(() => document.getElementById("copy-source")!.remove());

  await p.keyboard.press("v");
  await p.mouse.dblclick(box.minX + 10, box.minY + 12);
  await expect(p.getByTestId("text-editor")).toBeFocused();
  await expect(p.getByTestId("text-editor")).toHaveText("one");
  await p.getByRole("button", { name: "Bulleted list" }).click();
  await p.keyboard.press("End");
  await p.keyboard.press("Enter");
  await p.keyboard.type("two ");
  // Pasting formatted content keeps only its plain text.
  await p.keyboard.press(`${mod}+v`);
  await finish(p);
  expect((await textObjects(p)).map((o) => o.md)).toEqual(["- one\n- two # pasted \\<b>"]);
  expect((await textObjects(p))[0]!.id).toBe(t!.id);

  // Emptying a text deletes the object (one undoable step).
  await p.mouse.dblclick(box.minX + 10, box.minY + 12);
  await expect(p.getByTestId("text-editor")).toBeFocused();
  await p.keyboard.press(`${mod}+a`);
  await p.keyboard.press("Delete");
  await finish(p);
  expect(await textObjects(p)).toHaveLength(0);
  await p.keyboard.press(`${mod}+z`);
  expect(await textObjects(p)).toHaveLength(1);
  expect(app.consoleErrors).toEqual([]);
});

async function openApp(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(APP_URL);
  await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await page.evaluate(() => window.__canvastDebug.nextFrame());
  return page;
}

test("@ mentions an object by stable id; the mention survives reopening and reload (ADR 0039)", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  await app.drag({ x: 500, y: 500 }, { x: 700, y: 520 }, 4);
  const [stroke] = await objects(p);
  await newText(p, 500, 300);
  await p.keyboard.type("see @");
  const pick = p.getByRole("textbox", { name: "Mention an item" });
  await expect(pick).toBeFocused();
  await pick.fill("stro");
  await pick.press("Enter");
  await p.keyboard.type("now");
  await finish(p);
  const md = `see [[item:${stroke!.id}|Stroke]] now`;
  expect((await textObjects(p))[0]?.md).toBe(md);
  // Reopen and close without edits: the Markdown is unchanged.
  const box = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), (await textObjects(p))[0]!.id))!.box;
  await p.keyboard.press("v");
  await p.mouse.dblclick(box.minX + 6, (box.minY + box.maxY) / 2);
  await expect(p.getByTestId("text-editor")).toBeVisible();
  await expect(p.locator(".text-editor .mention")).toHaveText("Stroke");
  await finish(p);
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  expect((await textObjects(p))[0]?.md).toBe(md);
  expect(app.consoleErrors).toEqual([]);
});

test("backlinks: mentions are listed both ways, across the board's canvases, and a deleted target shows as missing (ADR 0040)", async ({ app }) => {
  const p = app.page;
  const nav = p.getByTestId("workspace-nav");
  const panel = p.getByTestId("layers-panel");
  await p.getByRole("button", { name: "Layers panel" }).click();
  await p.keyboard.press("p");
  await app.drag({ x: 500, y: 500 }, { x: 700, y: 520 }, 4);
  const [stroke] = await objects(p);
  await newText(p, 500, 300);
  await p.keyboard.type("note @");
  await p.getByRole("textbox", { name: "Mention an item" }).fill("stro");
  await p.keyboard.press("Enter");
  await finish(p);
  const [t1] = await textObjects(p);
  await p.getByTestId("import-input").setInputFiles({ name: "sky-ref.png", mimeType: "image/png", buffer: blockyFixture() });
  await expect.poll(async () => (await objects(p)).length).toBe(3);
  await p.keyboard.press("Escape");
  const row = (id: string) => panel.locator(`li.layer[data-key="${id}"]`);
  // Target lists the text that mentions it; the text lists its target, which can be revealed.
  await p.keyboard.press("v");
  await row(stroke!.id).click();
  await expect(panel.locator(".layers-links").getByRole("button", { name: /note/ })).toHaveCount(1);
  await row(t1!.id).click();
  await panel.locator(".layers-links").getByRole("button", { name: "Stroke" }).click();
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([stroke!.id]);
  // A second canvas: mention the first canvas's text from there.
  await nav.click();
  await p.getByRole("button", { name: "+ Canvas" }).last().click();
  await expect(nav).toHaveText("Board 1 › Canvas 2");
  await newText(p, 500, 300);
  await p.keyboard.type("see @");
  await p.getByRole("textbox", { name: "Mention an item" }).fill("note");
  await expect(p.getByRole("option", { name: /note.*Canvas 1/ })).toBeVisible();
  // An image on another canvas is found and labelled by its file name, not its size.
  await p.getByRole("textbox", { name: "Mention an item" }).fill("sky-ref");
  await expect(p.getByRole("option", { name: /sky-ref\.png.*Canvas 1/ })).toBeVisible();
  await p.getByRole("textbox", { name: "Mention an item" }).fill("note");
  await expect(p.getByRole("option", { name: /note.*Canvas 1/ })).toBeVisible();
  await p.keyboard.press("Enter");
  await finish(p);
  const [t2] = await textObjects(p);
  expect(t2!.md).toContain(`[[item:${t1!.id}|`);
  // Back on canvas 1, the text shows the mention from canvas 2; clicking goes there.
  await nav.click();
  await p.getByRole("menuitemradio", { name: /Canvas 1/ }).click();
  await expect(nav).toHaveText("Board 1 › Canvas 1");
  await row(t1!.id).click();
  const back = panel.locator(".layers-links").getByRole("button", { name: /see/ });
  await expect(back).toHaveCount(1);
  await back.click();
  await expect(nav).toHaveText("Board 1 › Canvas 2");
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([t2!.id]);
  // Delete the target on canvas 1: the mention shows as missing.
  await nav.click();
  await p.getByRole("menuitemradio", { name: /Canvas 1/ }).click();
  await expect(nav).toHaveText("Board 1 › Canvas 1");
  await row(stroke!.id).click();
  await p.keyboard.press("Delete");
  await row(t1!.id).click();
  await expect(panel.locator(".layers-links .broken")).toHaveCount(1);
  expect(app.consoleErrors).toEqual([]);
});

test("a read-only tab cannot create or edit text", async ({ app, context }) => {
  const p1 = app.page;
  await newText(p1, 300, 300);
  await p1.keyboard.type("mine");
  await finish(p1);
  expect(await p1.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  const p2 = await openApp(context);
  expect((await p2.evaluate(() => window.__canvastDebug.session())).readOnly).toBe(true);
  await p2.keyboard.press("t");
  await p2.mouse.click(500, 500);
  await expect(p2.getByTestId("text-editor")).toBeHidden();
  const box = (await p2.evaluate((id) => window.__canvastDebug.objectScreen(id), (await textObjects(p2))[0]!.id))!.box;
  await p2.keyboard.press("v");
  await p2.mouse.dblclick(box.minX + 10, box.minY + 12);
  await expect(p2.getByTestId("text-editor")).toBeHidden();
  expect((await textObjects(p2)).map((o) => o.md)).toEqual(["mine"]);
});

/** Centre the camera exactly on a world point at an absolute zoom level. */
async function lookAt(app: App, w: { x: string; y: string }, zi: number): Promise<void> {
  await app.page.evaluate(([x, y, z]) => window.__canvastDebug.setCamera({ cx: x as string, cy: y as string, zi: z as number, zf: 0, pz: z as number }), [w.x, w.y, zi] as const);
  await app.frame();
}

/** Screen x (px) where a row of pixels changes from background to text colour, scanning right. */
async function edgeX(app: App, y: number, x0: number, x1: number): Promise<number> {
  return app.page.evaluate(
    ([yy, a, b, rgb]) => {
      for (let x = a; x <= b; x++) {
        const c = window.__canvastDebug.pixelAt(x, yy);
        if (Math.abs(c[0] - rgb[0]!) + Math.abs(c[1] - rgb[1]!) + Math.abs(c[2] - rgb[2]!) < 200) return x;
      }
      return NaN;
    },
    [y, x0, x1, TEXT_RGB] as const,
  );
}

test("text placed deep stays exact at any magnification: letter edge and fill, no shape change at the switch", async ({ app }, info) => {
  const p = app.page;
  // Create the text 3,000 levels deep (2^-3000 world units per px).
  const base = 3000;
  await lookAt(app, { x: "1p-3001", y: "-3p-3002" }, base);
  await newText(p, 400, 300);
  await p.keyboard.type("I中");
  await finish(p);
  const [t] = await textObjects(p);
  const g = await p.evaluate((id) => window.__canvastDebug.textGlyph(id, 0), t!.id);
  expect(String.fromCodePoint(g.cp)).toBe("I");
  const vp = await p.evaluate(() => window.__canvastDebug.viewport());
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  const midY = (g.yMin + g.yMax) / 2;
  const leftEdge = await p.evaluate(([id, x, y]) => window.__canvastDebug.textGlyphWorld(id as string, 0, x as number, y as number), [t!.id, g.xMin, midY] as const);

  // Around the browser/outline switch (2,000 px per em): the edge stays put.
  // Text is 16 px per em at `base`; 2^7 = 128 → 2,048 px (outlines), 2^6.875 → ~1,878 px (browser).
  const edges: number[] = [];
  for (const zf of [0.875, 0]) {
    const zi = zf ? base + 6 : base + 7;
    await p.evaluate(([x, y, z, f]) => window.__canvastDebug.setCamera({ cx: x as string, cy: y as string, zi: z as number, zf: f as number, pz: z as number }), [leftEdge.x, leftEdge.y, zi, zf] as const);
    await app.frame();
    edges.push(await edgeX(app, cy, cx - 20, cx + 20));
  }
  // The exact edge is at cx; both modes put it within 1.5 px (anti-aliasing and hinting).
  for (const e of edges) expect(Math.abs(e - cx), `edges ${edges}`).toBeLessThanOrEqual(1.5);

  // Far beyond any double-precision scale: the stem edge is exactly at the centre.
  const depths = [base + 40, base + 400, base + 4000];
  for (const zi of depths) {
    await lookAt(app, leftEdge, zi);
    for (const dy of [-200, 0, 200]) {
      const left = await p.evaluate(([x, y]) => window.__canvastDebug.pixelAt(x!, y!), [cx - 3, cy + dy]);
      const right = await p.evaluate(([x, y]) => window.__canvastDebug.pixelAt(x!, y!), [cx + 2, cy + dy]);
      expect(isText(left), `zi ${zi} dy ${dy}: left of the edge is background`).toBe(false);
      expect(isText(right), `zi ${zi} dy ${dy}: right of the edge is filled`).toBe(true);
    }
  }
  // Inside the stem: the whole viewport is filled (no holes).
  const inside = await p.evaluate(([id, x, y]) => window.__canvastDebug.textGlyphWorld(id as string, 0, x as number, y as number), [t!.id, (g.xMin + g.xMax) / 2, midY] as const);
  await lookAt(app, inside, base + 400);
  const holes = await p.evaluate(([w, h]) => {
    let n = 0;
    for (let y = 5; y < h!; y += 40) for (let x = 5; x < w!; x += 40) {
      const c = window.__canvastDebug.pixelAt(x, y);
      if (Math.abs(c[0] - 0x1f) + Math.abs(c[1] - 0x23) + Math.abs(c[2] - 0x29) >= 60) n++;
    }
    return n;
  }, [vp.width, vp.height]);
  expect(holes).toBe(0);

  // A character the bundled font lacks is drawn from a raster at depth (it pixelates but stays visible).
  const cjk = await p.evaluate(([id, y]) => window.__canvastDebug.textGlyphWorld(id as string, 1, 1024, y as number), [t!.id, midY] as const);
  await lookAt(app, cjk, base + 8);
  expect(await p.evaluate(() => window.__canvastDebug.inkedPixels(4))).toBeGreaterThan(500);
  recordMetric(info, "text-deep", { switchEdges: edges.map((e) => e - cx), depths });
  expect(app.consoleErrors).toEqual([]);
});
