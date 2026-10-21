import { existsSync, readFileSync } from "node:fs";
import type { BrowserContext, Page } from "@playwright/test";
import { APP_URL, exportWith, expect, pathWith, recordMetric, test } from "./harness";
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

  // Copy Markdown from the Export menu of the Actions bar for the selected text.
  await p.keyboard.press("v");
  await p.mouse.click(box.minX + 20, box.minY + 20);
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toEqual([t!.id]);
  await exportWith(p, "copymd");
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

test("a double-click on a text that is already big on screen edits it where it is, and one too small to read is zoomed to a readable size", async ({ app }) => {
  const p = app.page;
  await newText(p, 400, 360);
  await p.keyboard.type("Big");
  await finish(p);
  const [t] = await textObjects(p);
  const mid = async () => {
    const b = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), t!.id))!.box;
    return { x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2), h: b.maxY - b.minY };
  };
  // zoom in until the letters are far bigger than the old 72 px limit, with the text under the pointer
  let at = await mid();
  for (let i = 0; i < 12 && at.h < 150; i++) {
    await app.wheel(at.x, at.y, -400);
    at = await mid();
  }
  expect(at.h, "zoomed in").toBeGreaterThan(100);
  const before = JSON.stringify(await app.camera());
  await p.mouse.dblclick(at.x, at.y);
  await expect(p.getByTestId("text-editor")).toBeFocused();
  expect(JSON.stringify(await app.camera()), "the view stays where the person put it").toBe(before);
  await finish(p);
  // far out: too small to read, so the view goes to a readable size
  for (let i = 0; i < 80 && at.h > 6; i++) {
    await app.wheel(at.x, at.y, 400);
    at = await mid();
  }
  expect(at.h, "zoomed out until the letters are too small to read, still big enough to point at").toBeLessThan(8);
  expect(at.h).toBeGreaterThan(1);
  const small = JSON.stringify(await app.camera());
  await p.mouse.dblclick(at.x, at.y);
  await expect(p.getByTestId("text-editor")).toBeFocused();
  expect(JSON.stringify(await app.camera())).not.toBe(small);
  await finish(p);
  expect(app.consoleErrors).toEqual([]);
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

test("a click makes a text as wide as its words, a dragged box one of that width; size, alignment and width mode are in the options bar (ADR 0126)", async ({ app }) => {
  const p = app.page;
  const width = async (id: string): Promise<number> => {
    const b = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
    return b.maxX - b.minX;
  };
  await newText(p, 300, 300);
  await p.keyboard.type("Hello wide world");
  await finish(p);
  await p.keyboard.press("t");
  await app.drag({ x: 300, y: 400 }, { x: 560, y: 440 }, 4);
  await expect(p.getByTestId("text-editor")).toBeFocused();
  await p.keyboard.type("Hello wide world again and again");
  await finish(p);
  const [a, b] = await textObjects(p);
  expect(a!.autoWidth).toBe(true);
  expect(b!.autoWidth).toBeUndefined();
  expect(await width(a!.id)).toBeLessThan(200); // as wide as 16 words of 16 px, no wrapping
  expect(Math.abs((await width(b!.id)) - 260 - 2 * 16 * 0.25)).toBeLessThan(8); // the dragged width (and the padding the box has)

  // The options bar works on a text while it is being edited, and the edit stays open until a press elsewhere.
  await newText(p, 700, 300);
  await p.keyboard.type("live");
  const liveSize = p.getByRole("spinbutton", { name: "Text size (px at this zoom)" });
  await liveSize.fill("40");
  await liveSize.press("Enter");
  await expect(p.getByTestId("text-editor")).toBeVisible();
  await p.getByRole("radio", { name: "Align right" }).click();
  await p.keyboard.press("Escape"); // (the focus is in the options bar)
  await expect(p.getByTestId("text-editor")).toBeHidden();
  const live = (await textObjects(p)).find((t) => t.md === "live")!;
  expect(live).toMatchObject({ align: "right", autoWidth: true });
  expect((live["size"] as number) * 2 ** (live["unit"] as number)).toBeCloseTo(40, 3);
  await p.keyboard.press("v");

  // The options bar of a picked text: size, alignment, width mode.
  await p.keyboard.press("v");
  await p.mouse.click(310, 308);
  const size = p.getByRole("spinbutton", { name: "Text size (px at this zoom)" });
  await expect(size).toHaveValue("16");
  // Dragging on the field itself scrubs it, like dragging its name; a press that does not move goes into it.
  const sb = (await size.boundingBox())!;
  await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await p.mouse.down();
  await p.mouse.move(sb.x + sb.width / 2 + 40, sb.y + sb.height / 2, { steps: 5 });
  await p.mouse.up();
  await expect.poll(async () => Number(await size.inputValue())).toBeGreaterThan(16);
  await expect(size).not.toBeFocused();
  await p.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await expect(size).toBeFocused();
  await size.fill("16");
  await size.press("Enter");
  const before = await width(a!.id);
  await size.fill("32");
  await size.press("Enter");
  await expect.poll(async () => width(a!.id)).toBeGreaterThan(before * 1.8); // an auto width follows the size
  await p.getByRole("radio", { name: "Align centre" }).click();
  await p.getByRole("radio", { name: "Fixed width" }).click();
  await expect.poll(async () => (await textObjects(p)).find((t) => t.id === a!.id)).toMatchObject({ align: "center" });
  expect((await textObjects(p)).find((t) => t.id === a!.id)!.autoWidth).toBeUndefined();
  await expect(p.getByRole("radio", { name: "Fixed width" })).toHaveAttribute("aria-checked", "true");
  expect(app.consoleErrors).toEqual([]);
});

test("a font file is imported from the options bar, a text is set in it, and it is still set in it after a reload (ADR 0127)", async ({ app }) => {
  const p = app.page;
  const width = async (id: string): Promise<number> => {
    const b = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
    return b.maxX - b.minX;
  };
  await newText(p, 300, 300);
  await p.keyboard.type("Hello font");
  await finish(p);
  const [t] = await textObjects(p);
  const before = await width(t!.id);
  await p.keyboard.press("v");
  await p.mouse.click(310, 308);
  const bold = readFileSync("node_modules/@expo-google-fonts/inter/900Black/Inter_900Black.ttf");
  // A file that is not a font is refused with the reason, and nothing is stored.
  await p.getByTestId("font-input").setInputFiles({ name: "notes.ttf", mimeType: "font/ttf", buffer: Buffer.from("not a font at all, really not") });
  await expect(p.getByTestId("toast")).toContainText("not a font file");
  await p.getByTestId("font-input").setInputFiles({ name: "Inter-Black.ttf", mimeType: "font/ttf", buffer: bold });
  await expect.poll(async () => (await textObjects(p))[0]!["assetId"]).toMatch(/^[0-9a-f]{64}$/);
  await expect.poll(async () => width(t!.id)).toBeGreaterThan(before * 1.03); // a heavier face is wider
  const after = await width(t!.id);
  await expect(p.getByRole("combobox", { name: "Font" }).locator("option:checked")).toHaveText("Inter-Black");
  expect(app.consoleErrors).toEqual([]);

  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  await expect.poll(async () => width(t!.id)).toBeCloseTo(after, 0); // the font came back from the library
  // Picked after a reload, the menu names the font (it reads the library before it is opened).
  await p.keyboard.press("v");
  await p.mouse.click(310, 308);
  await expect(p.getByRole("combobox", { name: "Font" }).locator("option:checked")).toHaveText("Inter-Black");
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

test("the text box starts in a readable ink on the dark canvas, chosen once when it is made (ADR 0052)", async ({ app }) => {
  const p = app.page;
  await p.emulateMedia({ colorScheme: "dark" });
  await p.getByRole("radio", { name: "Text" }).click();
  await p.mouse.click(400, 300);
  const box = p.getByTestId("text-editor");
  await expect(box).toBeFocused();
  // WYSIWYG: the default ink is picked once for the dark canvas and stored; the box shows that colour.
  const light = await box.evaluate((e) => { const c = getComputedStyle(e).color.match(/[\d.]+/g)!.map(Number); return (0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!) / 255; });
  expect(light, "light enough to read on the dark canvas").toBeGreaterThan(0.7);
  expect(app.consoleErrors).toEqual([]);
});

test("Layers panel: sort by name (A to Z, Z to A; a group by its name, then what is inside), nothing moves, groups show guides and open for a selected member (ADR 0059)", async ({ app }) => {
  const p = app.page;
  const panel = p.getByTestId("layers-panel");
  await p.getByRole("button", { name: "Layers panel" }).click();
  const words = ["pear", "apple", "kiwi"];
  for (const [i, w] of words.entries()) {
    await newText(p, 300 + (i % 2) * 400, 400 + Math.floor(i / 2) * 200);
    await p.keyboard.type(w);
    await finish(p);
  }
  const names = () => panel.locator("li.layer .layer-name").allTextContents();
  const where = async () => (await textObjects(p)).map((o) => `${o.id}:${o.ax}:${o.ay}`).sort();
  // Group pear and kiwi (a group is named by its own name, here the automatic "Group").
  await p.keyboard.press("Escape");
  await p.keyboard.press("v");
  const all = await textObjects(p);
  const idOf = (w: string) => all.find((o) => String(o.md).includes(w))!.id;
  await panel.locator(`li.layer[data-key="${idOf("pear")}"]`).click();
  await panel.locator(`li.layer[data-key="${idOf("kiwi")}"]`).click({ modifiers: ["Control"] });
  await p.keyboard.press("Control+g");
  const before = await where();
  // Newest in front: kiwi, apple, pear are what the panel lists first (the group is at the top with its members).
  // The new group opened with its members selected; fold everything, then open it all again.
  await panel.getByRole("button", { name: "Collapse all groups" }).click();
  expect(await names()).toHaveLength(2);
  await panel.getByRole("button", { name: "Expand all groups" }).click();
  await panel.getByRole("button", { name: "Sort the layers by name" }).click();
  await panel.getByRole("button", { name: "A to Z" }).click();
  expect(await names()).toEqual(["apple", "Group (2)", "kiwi", "pear"]);
  await panel.getByRole("button", { name: "Sort the layers by name" }).click();
  await panel.getByRole("button", { name: "Z to A" }).click();
  expect(await names()).toEqual(["Group (2)", "pear", "kiwi", "apple"]);
  expect(await where(), "no position changed").toEqual(before);
  // The group row has a count and its members are drawn indented under guide lines.
  await expect(panel.locator("li.layer.is-group .layer-count")).toHaveText("2");
  // (polled: Firefox may answer "auto" for the guide's width until the row is laid out)
  await expect.poll(async () => parseFloat(await panel.locator(`li.layer[data-key="${idOf("kiwi")}"]`).evaluate((e) => getComputedStyle(e, "::before").width))).toBeGreaterThan(10);
  // Undo puts the old order back.
  await p.keyboard.press("Control+z");
  await p.keyboard.press("Control+z");
  await expect.poll(names).toEqual(["Group (2)", "kiwi", "pear", "apple"]);
  // A group closed by hand opens again when one of its members is selected on the canvas.
  await panel.getByRole("button", { name: "Collapse all groups" }).click();
  expect(await names()).toHaveLength(2);
  await p.keyboard.press("Escape");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.selection())).toEqual([]);
  const s = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), idOf("kiwi")))!.box;
  await p.mouse.click(Math.round((s.minX + s.maxX) / 2), Math.round((s.minY + s.maxY) / 2));
  await expect.poll(names).toContain("kiwi");
  expect(app.consoleErrors).toEqual([]);
});

test("convert text to path (Ctrl+E and the selection bar): the same pixels, the same object, one undo, a layer named by the words", async ({ app }) => {
  const p = app.page;
  await newText(p, 480, 380);
  await p.keyboard.type("Hello");
  await finish(p);
  const [t] = await textObjects(p);
  expect(t).toBeTruthy();
  /** The brightness of every pixel of the text's box (the shape of the letters, antialiasing included). */
  const picture = () =>
    p.evaluate(() => {
      const out: number[] = [];
      for (let y = 366; y < 394; y++) for (let x = 476; x < 540; x++) {
        const c = window.__canvastDebug.pixelAt(x, y);
        out.push(c[0]! + c[1]! + c[2]!);
      }
      return out;
    });
  await p.keyboard.press("v");
  await p.mouse.click(500, 380); // pick it (inside its box)
  await app.frame();
  await p.mouse.click(1000, 600); // (nothing selected: no outline over the letters)
  await p.waitForFunction(() => document.fonts.check("16px canvast-inter")); // the bundled font, not a stand-in
  await app.frame();
  const before = await picture();
  expect(before.filter((v) => v < 3 * 90).length, "dark pixels of the text").toBeGreaterThan(50);
  await p.mouse.click(500, 380);
  await app.frame();

  // the selection bar offers it only for text
  await p.locator('[data-ctx="pathmenu"]').click();
  await expect(p.locator('.pop-menu [data-id="outline"]')).toBeVisible();
  await p.keyboard.press("Escape");
  await p.keyboard.press("Control+e");
  await app.frame();
  const [o] = await objects(p);
  expect(o).toMatchObject({ id: t!.id, kind: "path", fill: "#1f2329", stroke: null, name: "Hello" });
  expect((o as unknown as { sub: unknown[] }).sub.length).toBeGreaterThan(4); // H, e and its eye, l, l, o and its counter
  await p.locator('[data-ctx="pathmenu"]').click();
  await expect(p.locator('.pop-menu [data-id="outline"]'), "nothing left to convert").toHaveCount(0);
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  await p.mouse.click(1000, 600);
  const after = await picture();
  expect(after.filter((v) => v < 3 * 90).length, "dark pixels of the path").toBeGreaterThan(50);
  // A browser draws thin text lighter than a filled path (Chromium: about a factor of two in ink at 16 px) and puts a glyph on a whole pixel,
  // so edges differ; what must match is where the ink is (its middle) and that there is about as much, not the exact pixels.
  const ink = (pic: number[]) => {
    const w = 64;
    let mass = 0, mx = 0, my = 0;
    pic.forEach((v, i) => {
      const d = Math.max(0, 3 * 232 - v); // against the canvas background
      mass += d;
      mx += d * (i % w);
      my += d * Math.floor(i / w);
    });
    return { mass, x: mx / mass, y: my / mass };
  };
  const a1 = ink(before);
  const a2 = ink(after);
  expect(a2.mass / a1.mass, `ink ${a1.mass} -> ${a2.mass}`).toBeGreaterThan(0.6);
  expect(a2.mass / a1.mass, `ink ${a1.mass} -> ${a2.mass}`).toBeLessThan(3.2); // (a filled path is 1.6 to 2.7 times the ink of hinted text, depending on how the browser placed the glyphs)
  expect(Math.hypot(a2.x - a1.x, a2.y - a1.y), `centre (${a1.x.toFixed(2)}, ${a1.y.toFixed(2)}) -> (${a2.x.toFixed(2)}, ${a2.y.toFixed(2)})`).toBeLessThan(1.5);

  // one undo gives the text back, exactly
  await p.keyboard.press("Control+z");
  const [back] = await objects(p);
  expect(back).toMatchObject({ id: t!.id, kind: "text", md: t!.md });
  // and the bar's button does the same
  await p.mouse.click(500, 380);
  await pathWith(p, "outline");
  expect((await objects(p))[0]!.kind).toBe("path");
});

test("line height and letter spacing: set for the picked text, drawn and measured by them, saved, one undo step each (ADR 0113)", async ({ app }) => {
  const p = app.page;
  await newText(p, 300, 300);
  await p.keyboard.type("One two three four five six seven eight nine ten");
  await p.keyboard.press(`${mod}+a`);
  await p.keyboard.type("Line one");
  await p.keyboard.press("Enter");
  await p.keyboard.type("Line two");
  await finish(p);
  const [t] = await textObjects(p);
  const box = async () => (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), t!.id))!.box;
  const b0 = await box();
  await p.keyboard.press("v");
  await p.mouse.click(Math.round((b0.minX + b0.maxX) / 2), Math.round(b0.minY + 6));
  const line = p.locator("[data-text-line]");
  await expect(line).toHaveValue("1.3");
  await line.fill("2.2");
  await line.press("Enter");
  await line.blur();
  await app.frame();
  const b1 = await box();
  expect(b1.maxY - b1.minY, "taller with a bigger line height").toBeGreaterThan((b0.maxY - b0.minY) * 1.3);
  expect(((await textObjects(p))[0] as unknown as { lineHeight: number }).lineHeight).toBe(2.2);
  const track = p.locator("[data-text-track]");
  await track.fill("20");
  await track.press("Enter");
  await track.blur();
  await app.frame();
  expect(((await textObjects(p))[0] as unknown as { tracking: number }).tracking).toBeCloseTo(0.2, 5);
  await p.keyboard.press("Control+z");
  expect(((await textObjects(p))[0] as unknown as { tracking?: number }).tracking).toBeUndefined();
  await p.keyboard.press("Control+z");
  expect(((await textObjects(p))[0] as unknown as { lineHeight?: number }).lineHeight).toBeUndefined();
  expect(app.consoleErrors).toEqual([]);
});

test("words of a text can be underlined, struck through, given a colour and a size of their own; they are saved as Markdown, drawn and kept after a reload", async ({ app }) => {
  const p = app.page;
  await newText(p, 300, 300);
  await p.keyboard.type("one two three four");
  const select = async (from: number, count: number) => {
    await p.keyboard.press("Home");
    for (let i = 0; i < from; i++) await p.keyboard.press("ArrowRight");
    for (let i = 0; i < count; i++) await p.keyboard.press("Shift+ArrowRight");
  };
  await select(0, 3);
  await p.keyboard.press(`${mod}+u`);
  await select(4, 3);
  await p.getByRole("button", { name: "Strikethrough (Ctrl+Shift+X)" }).click();
  await select(8, 5);
  await p.getByRole("button", { name: "Colour of the selected words" }).click();
  await p.locator(".colour-pop [data-hex]").fill("ff0000");
  await p.locator(".colour-pop [data-hex]").press("Enter");
  await p.keyboard.press("Escape"); // closes the picker, then the edit
  if (await p.getByTestId("text-editor").isVisible()) await finish(p);
  await expect(p.getByTestId("text-editor")).toBeHidden();
  let [t] = await textObjects(p);
  expect(t!.md).toBe('<u>one</u> ~~two~~ <span style="color:#ff0000">three</span> four');

  // A size of its own: bigger, and the line grows with it; smaller again goes back to the same words.
  const height = async () => {
    const b = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), t!.id))!.box;
    return b.maxY - b.minY;
  };
  const h0 = await height();
  await p.keyboard.press("v");
  await p.mouse.dblclick(310, 308);
  await expect(p.getByTestId("text-editor")).toBeFocused();
  await select(14, 4);
  await p.getByRole("button", { name: "Make the selected words bigger" }).click();
  await p.getByRole("button", { name: "Make the selected words bigger" }).click();
  await finish(p);
  [t] = await textObjects(p);
  expect(t!.md).toContain('<span style="font-size:156.25%">four</span>');
  expect(await height()).toBeGreaterThan(h0 * 1.3);

  // Drawn: the underline, the strikethrough and the red word leave ink (the default ink is dark, so red is told apart by its channels).
  const red = await p.evaluate(() => {
    let n = 0;
    for (let y = 200; y < 420; y += 2) for (let x = 250; x < 700; x += 2) {
      const [r, g, b] = window.__canvastDebug.pixelAt(x, y);
      if (r > 180 && g < 90 && b < 90) n++;
    }
    return n;
  });
  expect(red).toBeGreaterThan(20);

  // Saved and read back the same; one undo takes the size away.
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  expect((await textObjects(p))[0]!.md).toBe(t!.md);
  expect(app.consoleErrors).toEqual([]);
});

test("a text can be filled with a gradient and given an outline: set in the options bar, stored, drawn, and gone again when a plain colour is chosen (ADR 0130)", async ({ app }) => {
  const p = app.page;
  await newText(p, 300, 300);
  await p.keyboard.type("WWWWWW");
  await finish(p);
  await p.keyboard.press("v");
  await p.mouse.click(310, 308);
  const size = p.getByRole("spinbutton", { name: "Text size (px at this zoom)" });
  await size.fill("80");
  await size.press("Enter");
  const [t] = await textObjects(p);
  const box = async () => (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), t!.id))!.box;
  const b0 = await box();
  /** The ink in a slice of the text box: how many pixels differ from the background, and the darkest of them (the sum of the channels). */
  const ink = (x0: number, x1: number) =>
    p.evaluate(([a, c, y0, y1]) => {
      let n = 0, red = 765;
      const bg = window.__canvastDebug.pixelAt(5, 400);
      for (let y = y0!; y < y1!; y += 5) for (let x = a!; x < c!; x += 5) {
        const px = window.__canvastDebug.pixelAt(x, y);
        if (Math.abs(px[0] - bg[0]) + Math.abs(px[1] - bg[1]) + Math.abs(px[2] - bg[2]) > 90) { n++; red = Math.min(red, px[0] + px[1] + px[2]); }
      }
      return { n, red };
    }, [x0, x1, Math.round(b0.minY), Math.round(b0.maxY)] as const);
  const mid = (b0.minX + b0.maxX) / 2;
  const plainLeft = await ink(b0.minX, mid), plainRight = await ink(mid, b0.maxX);
  expect(Math.abs(plainLeft.red - plainRight.red)).toBeLessThan(30); // one colour all through

  // A linear gradient: the left half and the right half are not the same colour any more.
  await p.getByRole("button", { name: "Text colour" }).click();
  await p.locator('.colour-pop [data-mode="linear"]').click();
  await expect.poll(async () => (await textObjects(p))[0]!["gradient"]).toMatchObject({ type: "linear" });
  await p.keyboard.press("Escape");
  const left = await ink(b0.minX, mid), right = await ink(mid, b0.maxX);
  expect(left.n).toBeGreaterThan(50);
  expect(right.red - left.red).toBeGreaterThan(80); // (a new gradient runs from the colour to nothing: the right half is lighter)

  // An outline: a colour and a width; more is drawn round the letters, and it is stored as a share of the size.
  const before = (await ink(b0.minX - 10, b0.maxX + 10)).n;
  const w = p.getByRole("spinbutton", { name: "Text outline width (px at this zoom)" });
  await w.fill("6");
  await w.press("Enter");
  await expect.poll(async () => (await textObjects(p))[0]!["outline"]).toMatchObject({ w: 6 / 80 });
  expect((await ink(b0.minX - 10, b0.maxX + 10)).n).toBeGreaterThan(before * 1.05);
  expect(await w.inputValue()).toBe("6");

  // A plain colour takes the gradient away; width 0 takes the outline away.
  await p.getByRole("button", { name: "Text colour" }).click();
  await p.locator('.colour-pop [data-mode="solid"]').click();
  await expect.poll(async () => (await textObjects(p))[0]!["gradient"]).toBeUndefined();
  await p.keyboard.press("Escape");
  await w.fill("0");
  await w.press("Enter");
  await expect.poll(async () => (await textObjects(p))[0]!["outline"]).toBeUndefined();

  // Saved and read back.
  await w.fill("3");
  await w.press("Enter");
  await p.getByRole("button", { name: "Text colour" }).click();
  await p.locator('.colour-pop [data-mode="radial"]').click();
  await p.keyboard.press("Escape");
  const saved = (await textObjects(p))[0]!;
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  const back = (await textObjects(p))[0]!;
  expect(back["gradient"]).toEqual(saved["gradient"]);
  expect(back["outline"]).toEqual(saved["outline"]);
  expect(app.consoleErrors).toEqual([]);
});

test("Tab nests a list item; the paragraph and box options (space, first line, case, most lines, set height and where the words sit) are stored and kept after a reload (ADR 0130)", async ({ app }) => {
  const p = app.page;
  await newText(p, 300, 300);
  await p.keyboard.type("one");
  await p.getByRole("button", { name: "Bulleted list" }).click();
  await p.keyboard.press("End");
  await p.keyboard.press("Enter");
  await p.keyboard.type("two");
  await p.keyboard.press("Tab");
  await p.keyboard.press("Enter");
  await p.keyboard.type("three");
  await p.keyboard.press("Shift+Tab");
  await finish(p);
  expect((await textObjects(p))[0]!.md).toBe("- one\n  - two\n- three");

  // A deeper item is further in on the canvas.
  const [t] = await textObjects(p);
  await p.keyboard.press("v");
  await p.mouse.click(310, 308);
  await p.getByRole("button", { name: "Paragraph and box options" }).click();
  const field = (name: string) => p.locator(`.colour-pop [data-field="${name}"]`);
  await field("paraGap").fill("1.5");
  await field("paraGap").press("Enter");
  await field("maxLines").fill("2");
  await field("maxLines").press("Enter");
  await field("heightPx").fill("120");
  await field("heightPx").press("Enter");
  await p.locator('.colour-pop [data-caps="upper"]').click();
  await p.locator('.colour-pop [data-valign="middle"]').click();
  const now = async () => (await textObjects(p)).find((o) => o.id === t!.id)!;
  await expect.poll(async () => (await now())["caps"]).toBe("upper");
  expect(await now()).toMatchObject({ paraGap: 1.5, maxLines: 2, valign: "middle" });
  expect(((await now())["h"] as number) * 2 ** (((await now())["unit"]) as number)).toBeCloseTo(120, 3);
  // The box is as tall as it was set, not as the words need.
  const box = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), t!.id))!.box;
  expect(box.maxY - box.minY).toBeGreaterThan(120);
  expect(box.maxY - box.minY).toBeLessThan(130);
  await p.keyboard.press("Escape");

  // Back to the defaults: 0 lines, 0 height and "As typed" take the settings away again.
  await p.getByRole("button", { name: "Paragraph and box options" }).click();
  await field("maxLines").fill("0");
  await field("maxLines").press("Enter");
  await field("heightPx").fill("0");
  await field("heightPx").press("Enter");
  await p.locator('.colour-pop [data-caps="none"]').click();
  await expect.poll(async () => (await now())["caps"]).toBeUndefined();
  expect(await now()).not.toHaveProperty("h");
  expect(await now()).not.toHaveProperty("maxLines");
  await p.keyboard.press("Escape");

  // Kept after a reload.
  await p.getByRole("button", { name: "Paragraph and box options" }).click();
  await p.locator('.colour-pop [data-caps="small"]').click();
  await p.keyboard.press("Escape");
  const saved = await now();
  expect(saved["caps"]).toBe("small");
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  expect((await textObjects(p))[0]).toMatchObject({ caps: "small", paraGap: 1.5, md: "- one\n  - two\n- three" });
  expect(app.consoleErrors).toEqual([]);
});

test("selected words can be made a link (web or mail address only, shown underlined); Ctrl+click on them opens it in a new tab (ADR 0130)", async ({ app }) => {
  const p = app.page;
  await newText(p, 300, 300);
  await p.keyboard.type("go there now");
  const select = async (from: number, count: number) => {
    await p.keyboard.press("Home");
    for (let i = 0; i < from; i++) await p.keyboard.press("ArrowRight");
    for (let i = 0; i < count; i++) await p.keyboard.press("Shift+ArrowRight");
  };
  await select(3, 5);
  await p.getByRole("button", { name: "Link of the selected words" }).click();
  await p.getByTestId("prompt-input").fill("javascript:alert(1)");
  await p.getByTestId("prompt-input").press("Enter");
  await expect(p.getByTestId("prompt-dialog")).toHaveCount(0);
  await expect(p.getByTestId("text-editor")).toBeVisible(); // the dialog did not end the edit
  await select(3, 5);
  await p.getByRole("button", { name: "Link of the selected words" }).click();
  await p.getByTestId("prompt-input").fill("https://example.com/a(b)");
  await p.getByTestId("prompt-input").press("Enter");
  await expect(p.getByTestId("prompt-dialog")).toHaveCount(0);
  await finish(p);
  const [t] = await textObjects(p);
  expect(t!.md).toBe("go [there](https://example.com/a%28b%29) now");

  // Ctrl+click on the words opens the address (the call is watched here, so the test makes no request); a click elsewhere on the text opens nothing.
  await p.evaluate(() => {
    (window as unknown as { __opened: unknown[][] }).__opened = [];
    window.open = ((...a: unknown[]) => ((window as unknown as { __opened: unknown[][] }).__opened.push(a), null)) as typeof window.open;
  });
  await p.keyboard.press("v");
  const box = (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), t!.id))!.box;
  const y = (box.minY + box.maxY) / 2;
  await p.keyboard.down("Control");
  await p.mouse.click(box.minX + 40, y); // on "there"
  await p.keyboard.up("Control");
  await expect.poll(() => p.evaluate(() => (window as unknown as { __opened: unknown[][] }).__opened.length)).toBe(1);
  expect(await p.evaluate(() => (window as unknown as { __opened: unknown[][] }).__opened[0])).toEqual(["https://example.com/a%28b%29", "_blank", "noopener,noreferrer"]);
  await p.keyboard.down("Control");
  await p.mouse.click(box.minX + 4, y); // on "go"
  await p.keyboard.up("Control");
  expect(await p.evaluate(() => (window as unknown as { __opened: unknown[][] }).__opened.length)).toBe(1);

  // Open it again to take the link away: an empty address.
  await p.mouse.dblclick(box.minX + 4, y);
  await expect(p.getByTestId("text-editor")).toBeFocused();
  await p.keyboard.press("Control+a");
  await p.getByRole("button", { name: "Link of the selected words" }).click();
  await expect(p.getByTestId("prompt-input")).toHaveValue("");
  await p.getByTestId("prompt-input").fill("");
  await p.getByTestId("prompt-input").press("Enter");
  await expect(p.getByTestId("prompt-dialog")).toHaveCount(0);
  await finish(p);
  expect((await textObjects(p))[0]!.md).toBe("go there now");
  expect(app.consoleErrors).toEqual([]);
});

test("a text is set along a picked path (a copy of its curve), runs along it and is taken off again (ADR 0131)", async ({ app }) => {
  const p = app.page;
  await newText(p, 300, 560);
  await p.keyboard.type("Along the line");
  await finish(p);
  await p.keyboard.press("u");
  await p.click('[data-shape-kind="line"]');
  await app.drag({ x: 300, y: 320 }, { x: 560, y: 480 }, 6);
  const [text, line] = [(await textObjects(p))[0]!, (await objects(p)).find((o) => o.kind === "path")!];
  const box = async () => (await p.evaluate((id) => window.__canvastDebug.objectScreen(id), text.id))!.box;
  const flat = await box();
  expect(flat.maxY - flat.minY).toBeLessThan(40);

  // Pick both and set the text along the line.
  await p.keyboard.press("v");
  await p.mouse.click(flat.minX + 12, (flat.minY + flat.maxY) / 2);
  await p.keyboard.down("Shift");
  await p.mouse.click(430, 400);
  await p.keyboard.up("Shift");
  expect(await p.evaluate(() => window.__canvastDebug.selection())).toHaveLength(2);
  await pathWith(p, "onpath");
  await expect.poll(async () => ((await textObjects(p))[0]!["onPath"] as { n: number[] } | undefined)?.n.length).toBeGreaterThanOrEqual(12);
  const along = await box();
  expect(along.maxY - along.minY).toBeGreaterThan(60); // the words climb down the diagonal
  expect(app.consoleErrors).toEqual([]);

  // The letters are on the line: ink near it, and the straight text's old place is empty.
  const onLine = await p.evaluate(() => {
    let n = 0;
    for (let t = 0.05; t < 0.95; t += 0.01) {
      const x = 300 + 260 * t, y = 320 + 160 * t;
      for (let dy = -18; dy <= 2; dy += 2) { const px = window.__canvastDebug.pixelAt(Math.round(x), Math.round(y + dy)); if (px[0] + px[1] + px[2] < 300) n++; }
    }
    return n;
  });
  expect(onLine).toBeGreaterThan(30);

  // Taking it off sets it straight again, and undo puts it back on.
  await pathWith(p, "offpath");
  await expect.poll(async () => (await textObjects(p))[0]!["onPath"]).toBeUndefined();
  const back = await box();
  expect(back.maxY - back.minY).toBeLessThan(40);
  await p.keyboard.press(`${mod}+z`);
  await expect.poll(async () => (await textObjects(p))[0]!["onPath"]).toBeDefined();
  expect(line.kind).toBe("path");
  expect(app.consoleErrors).toEqual([]);
});

const SYSTEM_FONTS = {
  woff2: "/usr/share/cockpit/static/fonts/RedHatDisplay-Medium.woff2",
  cff: "/usr/share/fonts/aajohan-comfortaa-fonts/Comfortaa-Regular.otf",
  vf: "/usr/share/fonts/google-noto-vf/NotoSans[wght].ttf",
};

test("WOFF2, PostScript (OpenType) and variable fonts can be imported and used; the font options set kerning, features and the axes of a variable font (ADR 0132)", async ({ app }) => {
  test.skip(!Object.values(SYSTEM_FONTS).every((f) => existsSync(f)), "needs the system fonts the test imports");
  const p = app.page;
  const width = async (id: string): Promise<number> => {
    const b = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
    return b.maxX - b.minX;
  };
  await newText(p, 300, 300);
  await p.keyboard.type("Hamburg AVA 123");
  await finish(p);
  const [t] = await textObjects(p);
  const plain = await width(t!.id);
  await p.keyboard.press("v");
  await p.mouse.click(310, 308);
  const set = async (file: string, name: string): Promise<void> => {
    await p.getByTestId("font-input").setInputFiles({ name, mimeType: "font/ttf", buffer: readFileSync(file) });
    await expect(p.getByRole("combobox", { name: "Font" }).locator("option:checked")).toHaveText(name.replace(/\.[a-z0-9]+$/, ""));
    await p.evaluate(() => window.__canvastDebug.nextFrame());
  };
  const inkNow = () => p.evaluate(() => window.__canvastDebug.inkedPixels(2));
  // WOFF2 and OpenType with PostScript outlines: each is another face, with the width of its own letters, drawn.
  await set(SYSTEM_FONTS.woff2, "RedHatDisplay-Medium.woff2");
  const wWoff2 = await width(t!.id);
  expect(Math.abs(wWoff2 - plain)).toBeGreaterThan(2);
  expect(await inkNow()).toBeGreaterThan(300);
  await set(SYSTEM_FONTS.cff, "Comfortaa-Regular.otf");
  const wCff = await width(t!.id);
  expect(Math.abs(wCff - wWoff2)).toBeGreaterThan(2);
  expect(await inkNow()).toBeGreaterThan(300);

  // A variable font: its axis is in the font options, and a weight makes the text wider.
  await set(SYSTEM_FONTS.vf, "NotoSans[wght].ttf");
  const wVar = await width(t!.id);
  await p.getByRole("button", { name: "Font options" }).click();
  const pop = p.locator(".font-pop");
  await expect(pop).toContainText("Noto Sans");
  await pop.locator('input[data-axis="wght"]').fill("700");
  await pop.locator('input[data-axis="wght"]').press("Enter");
  await expect.poll(async () => (await textObjects(p))[0]!["axes"]).toEqual({ wght: 700 });
  await expect.poll(async () => width(t!.id)).toBeGreaterThan(wVar * 1.02);

  // Kerning moves a close pair in; the layout (and so the box) is narrower.
  const unkerned = await width(t!.id);
  await pop.locator("input[data-kerning]").check();
  await expect.poll(async () => (await textObjects(p))[0]!["kerning"]).toBe(true);
  await expect.poll(async () => width(t!.id)).toBeLessThan(unkerned);
  // The default weight again takes the axis away.
  await pop.locator('input[data-axis="wght"]').fill("400");
  await pop.locator('input[data-axis="wght"]').press("Enter");
  await expect.poll(async () => (await textObjects(p))[0]!["axes"]).toBeUndefined();
  await p.keyboard.press("Escape");

  // Saved with the text, and the same after a reload.
  const saved = (await textObjects(p))[0]!;
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  expect((await textObjects(p))[0]).toMatchObject({ kerning: true, assetId: saved["assetId"] });
  expect(app.consoleErrors).toEqual([]);
});

test("an input method (Japanese, say) composes into the text: the composition is shown, Escape in it does not end the edit, and the committed words (with Hebrew among them) are stored and drawn (ADR 0132)", async ({ app, browserName, context }) => {
  test.skip(browserName !== "chromium", "the input method is driven through the DevTools protocol");
  const p = app.page;
  await newText(p, 300, 300);
  await p.keyboard.type("go ");
  const cdp = await context.newCDPSession(p);
  await cdp.send("Input.imeSetComposition", { text: "にほん", selectionStart: 3, selectionEnd: 3 });
  await expect(p.getByTestId("text-editor")).toContainText("にほん");
  await p.keyboard.press("Escape"); // belongs to the method: the edit stays open
  await expect(p.getByTestId("text-editor")).toBeVisible();
  await cdp.send("Input.imeSetComposition", { text: "日本", selectionStart: 2, selectionEnd: 2 });
  await cdp.send("Input.insertText", { text: "日本" });
  await p.keyboard.type(" אבג");
  await finish(p);
  const [t] = await textObjects(p);
  expect(t!.md).toBe("go 日本 אבג");
  expect(await p.evaluate(() => window.__canvastDebug.inkedPixels(2))).toBeGreaterThan(100);
  expect(app.consoleErrors).toEqual([]);
});

test("words of their own font: chosen in the text's format bar, stored as a span, wider than in the text's font, and kept after a reload", async ({ app }) => {
  test.skip(![SYSTEM_FONTS.woff2, SYSTEM_FONTS.cff].every((f) => existsSync(f)), "needs the system fonts the test imports");
  const p = app.page;
  const width = async (id: string): Promise<number> => {
    const b = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
    return b.maxX - b.minX;
  };
  await newText(p, 300, 300);
  await p.keyboard.type("Hamburg AVA 123");
  await finish(p);
  const [t] = await textObjects(p);
  await p.keyboard.press("v");
  await p.mouse.click(310, 308);
  const set = async (file: string, name: string): Promise<void> => {
    await p.getByTestId("font-input").setInputFiles({ name, mimeType: "font/ttf", buffer: readFileSync(file) });
    await expect(p.getByRole("combobox", { name: "Font" }).locator("option:checked")).toHaveText(name.replace(/\.[a-z0-9]+$/, ""));
  };
  await set(SYSTEM_FONTS.woff2, "RedHatDisplay-Medium.woff2");
  const redHat = String((await textObjects(p))[0]!["assetId"]);
  await set(SYSTEM_FONTS.cff, "Comfortaa-Regular.otf");
  const own = await width(t!.id);
  await p.keyboard.press("Escape");
  await p.mouse.dblclick(310, 308);
  await expect(p.getByTestId("text-editor")).toBeFocused();
  await p.keyboard.press("Control+a");
  const wordsFont = p.getByRole("toolbar", { name: "Text format" }).locator("[data-font-of-words]");
  await expect(wordsFont.locator("option:checked"), "it names the font the words are in: the text's own").toHaveText("Comfortaa-Regular");
  await wordsFont.selectOption({ label: "RedHatDisplay-Medium" });
  await expect(wordsFont.locator("option:checked"), "and the new one once the words have it").toHaveText("RedHatDisplay-Medium");
  await finish(p);
  expect((await textObjects(p))[0]!.md).toContain(`font-family:${redHat}`);
  await expect.poll(async () => Math.abs((await width(t!.id)) - own)).toBeGreaterThan(2);
  const mixed = await width(t!.id);
  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  await expect.poll(async () => width(t!.id)).toBeCloseTo(mixed, 0);
  // back to the text's font: the span goes away
  await p.mouse.dblclick(310, 308);
  await p.keyboard.press("Control+a");
  await p.getByRole("toolbar", { name: "Text format" }).locator("[data-font-of-words]").selectOption({ label: "Comfortaa-Regular" });
  await finish(p);
  expect((await textObjects(p))[0]!.md).toBe("Hamburg AVA 123");
});

test("Note tool (M): a text on a card made in one click; the card is part of its box, can be recoloured, narrowed, taken away with one undo, and is kept after a reload", async ({ app }) => {
  const p = app.page;
  const box = async (id: string) => (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
  const plain = async (): Promise<number> => {
    await newText(p, 300, 500);
    await p.keyboard.type("Remember the milk");
    await finish(p);
    const t = (await textObjects(p)).at(-1)!;
    const b = await box(t.id);
    return b.maxX - b.minX;
  };
  const plainWidth = await plain();
  await p.keyboard.press("m");
  expect(await p.evaluate(() => window.__canvastDebug.tool())).toBe("note");
  await p.mouse.click(300, 300);
  await expect(p.getByTestId("text-editor")).toBeFocused();
  await p.keyboard.type("Remember the milk");
  await finish(p);
  const note = (await textObjects(p)).at(-1)! as Obj & { card?: { fill: string; pad: number; radius: number }; color: string };
  expect(note.card).toEqual({ fill: "#ffe58a", pad: 0.6, radius: 0.3 });
  expect(note.color).toBe("#1f2329");
  const b0 = await box(note.id);
  expect(b0.maxX - b0.minX, "the card adds its space on both sides").toBeGreaterThan(plainWidth + 10);
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  const near = await p.evaluate(([x, y]) => window.__canvastDebug.pixelAt(x!, y!), [Math.round(b0.minX) + 8, Math.round((b0.minY + b0.maxY) / 2)]);
  expect(near, "the card's yellow behind the words").toEqual([255, 229, 138]);

  // Take the card away: the box is narrower, the yellow is gone, and one undo brings it back
  await p.keyboard.press("v");
  await p.mouse.click(Math.round((b0.minX + b0.maxX) / 2), Math.round((b0.minY + b0.maxY) / 2));
  await p.getByRole("button", { name: "Paragraph and box options" }).click();
  await p.locator('.colour-pop [data-card="none"]').click();
  expect((await textObjects(p)).at(-1)!["card"]).toBeUndefined();
  await p.keyboard.press("Escape");
  const b1 = await box(note.id);
  expect(b1.maxX - b1.minX).toBeLessThan(b0.maxX - b0.minX - 10);
  await p.keyboard.press("Control+z");
  expect((await textObjects(p)).at(-1)!["card"]).toMatchObject({ fill: "#ffe58a" });
  // Another colour, with more space round the words
  await p.getByRole("button", { name: "Paragraph and box options" }).click();
  await p.locator('.colour-pop [data-card="#bfe3ff"]').click();
  await p.locator('.colour-pop [data-field="cardPad"]').fill("1.2");
  await p.locator('.colour-pop [data-field="cardPad"]').press("Enter");
  await expect.poll(async () => (await textObjects(p)).at(-1)!["card"]).toEqual({ fill: "#bfe3ff", pad: 1.2, radius: 0.3 });
  await p.keyboard.press("Escape");

  expect(await p.evaluate(() => window.__canvastDebug.flushSave())).toBe("saved");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  expect((await textObjects(p)).at(-1)!["card"]).toEqual({ fill: "#bfe3ff", pad: 1.2, radius: 0.3 });
  expect(app.consoleErrors).toEqual([]);
});
