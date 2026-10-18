import { expect, test } from "./harness";
import type { App } from "./harness";
import { makePng } from "./png";

/**
 * Styles of the canvas (ADR 0122): gradients and palettes saved, applied (asking when several shapes are picked), edited, and read and
 * written as GIMP .ggr and .gpl files; a gradient map on a picture. Real input; assertions read the stored objects.
 */
type Grad = { type: string; stops: Array<{ o: number; c: string }> };
type Obj = { id: string; kind: string; fill: string | Grad | null; stroke: string | Grad | null; adjust?: { map?: { stops: Array<{ o: number; c: string }>; amount: number } } };
const objs = async (app: App): Promise<Obj[]> => (await app.page.evaluate(() => window.__canvastDebug.objects())) as unknown as Obj[];
const drag = async (app: App, a: [number, number], b: [number, number]) => {
  await app.drag({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, 8);
  await app.frame();
};
const centre = async (app: App, id: string): Promise<[number, number]> => {
  const b = (await app.page.evaluate((i) => window.__canvastDebug.objectScreen(i), id))!.box;
  return [Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2)];
};
const SUNSET = "GIMP Gradient\nName: Sunset\n1\n0.000000 0.500000 1.000000 1.000000 0.000000 0.000000 1.000000 0.000000 0.000000 1.000000 1.000000 0 0 0 0\n";

/** The Adjust panel is a dock panel: the button shows it, and it stays (ADR 0123). */
async function openAdjust(p: App["page"]): Promise<void> {
  if (!(await p.getByTestId("adjust-panel").isVisible())) await p.getByRole("button", { name: /^Adjust the picture/ }).click();
  await p.getByTestId("adjust-panel").locator(".adjust-pop").waitFor();
}

test("Styles: a gradient is saved from the fill picker, applied (the part asked when several are picked), exported and read back as .ggr", async ({ app }) => {
  const p = app.page;
  const pop = p.locator(".colour-pop");
  await p.keyboard.press("u");
  await drag(app, [500, 300], [620, 380]);
  await drag(app, [700, 300], [820, 380]);
  const [a, b] = (await objs(app)).slice(-2) as [Obj, Obj];
  await p.keyboard.press("v");
  await p.mouse.click(...(await centre(app, a.id)));
  await p.click('[data-paint="fill"]');
  await pop.locator('[data-mode="linear"]').click();
  await pop.locator("[data-save-gradient]").click();

  await p.getByRole("button", { name: "Styles panel", exact: true }).click();
  const panel = p.getByTestId("styles-panel");
  const card = (name: string) => panel.locator(".style-card", { hasText: name });
  await panel.getByRole("tab", { name: /^Gradients/ }).click();
  await expect(card("Gradient 1")).toContainText("Linear · 2 stops");
  // one shape picked: it goes on the fill, no question
  await p.mouse.click(...(await centre(app, b.id)));
  await card("Gradient 1").click();
  await expect.poll(async () => ((await objs(app)).find((o) => o.id === b.id)!.fill as Grad).type).toBe("linear");
  // "Apply to" Outline: the same card now goes on the outline of one picked shape
  await panel.getByRole("radio", { name: "Outline" }).click();
  await p.mouse.click(...(await centre(app, a.id)));
  await card("Gradient 1").click();
  await expect.poll(async () => ((await objs(app)).find((o) => o.id === a.id)!.stroke as Grad).type).toBe("linear");
  await panel.getByRole("radio", { name: "Fill", exact: true }).click();
  // two picked: the person is asked which part
  await p.mouse.click(...(await centre(app, a.id)));
  await p.keyboard.down("Shift");
  await p.mouse.click(...(await centre(app, b.id)));
  await p.keyboard.up("Shift");
  await card("Gradient 1").click();
  await p.getByTestId("choose-dialog").locator('input[value="stroke"]').check();
  await p.getByTestId("choose-ok").click();
  for (const id of [a.id, b.id]) await expect.poll(async () => ((await objs(app)).find((o) => o.id === id)!.stroke as Grad).type).toBe("linear");

  // a text takes a saved gradient too, on its letters
  await p.keyboard.press("t");
  await p.mouse.click(300, 520);
  await p.keyboard.type("Hi");
  await p.keyboard.press("Escape");
  await p.keyboard.press("v");
  await p.mouse.click(310, 528);
  await card("Gradient 1").click();
  await expect.poll(async () => ((await objs(app)).find((o) => o.kind === "text") as Obj & { gradient?: Grad }).gradient?.type).toBe("linear");

  // written as a GIMP gradient, and a file of that kind read back
  const [file] = await Promise.all([p.waitForEvent("download"), (async () => {
    await panel.getByRole("button", { name: /^More actions for style Gradient 1/ }).click();
    await p.getByRole("menuitem", { name: /Export Gradient 1 as a GIMP gradient/ }).click();
  })()]);
  expect(file.suggestedFilename()).toBe("gradient_1.ggr");
  await p.getByTestId("styles-import").setInputFiles([{ name: "sunset.ggr", mimeType: "text/plain", buffer: Buffer.from(SUNSET) }, { name: "junk.ggr", mimeType: "text/plain", buffer: Buffer.from("nope") }]);
  await expect(card("Sunset")).toContainText("Linear · 2 stops");
  await expect(p.getByTestId("toast").getByText(/not a GIMP/)).toBeVisible();
  expect(app.consoleErrors).toEqual([]);
});

test("Styles: a palette from the selection's colours is opened, a colour of it applied, edited (named, changed, added, removed), exported and read back as .gpl", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("u");
  await drag(app, [500, 300], [620, 380]);
  const shape = (await objs(app)).at(-1)!;
  await p.keyboard.press("v");
  await p.mouse.click(...(await centre(app, shape.id)));
  await p.getByRole("button", { name: "Styles panel", exact: true }).click();
  const panel = p.getByTestId("styles-panel");
  await panel.getByRole("tab", { name: /^Palettes/ }).click();
  await expect(panel.getByTestId("palette-empty")).toContainText("A palette is a set of colours"); // a first-time person is told what to do
  await panel.locator('[data-new-from="selection"]').click();
  const card = panel.locator(".style-palette").first();
  await expect(card).toContainText("Palette 1");
  await expect(card.locator(".palette-chip")).toHaveCount(2); // the fill and the outline colour
  // applied: the chip's colour goes on the fill
  await card.locator(".palette-chip").nth(1).click();
  const picked = (await objs(app)).at(-1)!;
  expect(picked.fill).toMatch(/^#[0-9a-f]{6}$/);
  // edited: named, one more added, one removed
  await card.getByRole("button", { name: /^More actions for style Palette 1/ }).click();
  await p.getByRole("menuitem", { name: /Edit the colours of Palette 1/ }).click();
  await card.locator('[data-colour-name="0"]').fill("Ink");
  await card.locator('[data-colour-name="0"]').blur();
  await card.getByRole("button", { name: "Add colour" }).click();
  await expect(card.locator(".pal-row")).toHaveCount(3);
  await p.keyboard.press("Escape"); // the picker that opens on the new colour
  await card.getByRole("button", { name: /^Remove/ }).last().click();
  await expect(card.locator(".pal-row")).toHaveCount(2);
  await card.getByRole("button", { name: "Done" }).click();
  await expect(card.locator(".palette-chip").first()).toHaveAttribute("title", /^Ink /);
  // written as a GIMP palette, and read back
  const [file] = await Promise.all([p.waitForEvent("download"), (async () => {
    await card.getByRole("button", { name: /^More actions for style Palette 1/ }).click();
    await p.getByRole("menuitem", { name: /Export Palette 1 as a GIMP palette/ }).click();
  })()]);
  expect(file.suggestedFilename()).toBe("palette_1.gpl");
  await p.getByTestId("styles-import").setInputFiles({ name: "brand.gpl", mimeType: "text/plain", buffer: Buffer.from("GIMP Palette\nName: Brand\nColumns: 2\n#\n255 136   0\tOrange\n 16  32  48\n") });
  await expect(panel.locator(".style-card", { hasText: "Brand" })).toContainText("2 colours");
  expect(app.consoleErrors).toEqual([]);
});

test("Styles: a text style is saved from a picked text and put on another one (size, alignment, spacing, colour; the width mode stays)", async ({ app }) => {
  const p = app.page;
  const texts = async () => (await objs(app)).filter((o) => o.kind === "text") as unknown as Array<Record<string, unknown> & { id: string }>;
  for (const [x, y, words] of [[300, 300, "first words"], [300, 450, "second words"]] as const) {
    await p.keyboard.press("t");
    await p.mouse.click(x, y);
    await p.keyboard.type(words);
    await p.keyboard.press("Escape");
    await app.frame();
  }
  const [a, b] = await texts();
  await p.keyboard.press("v");
  await p.mouse.click(310, 308);
  await p.getByRole("radio", { name: "Align right" }).click();
  await p.getByRole("spinbutton", { name: "Text size (px at this zoom)" }).fill("30");
  await p.getByRole("spinbutton", { name: "Text size (px at this zoom)" }).press("Enter");
  await p.getByRole("button", { name: "Styles panel" }).click();
  await p.getByRole("tab", { name: /^Text styles/ }).click();
  await p.getByRole("button", { name: "Save from the text" }).click();
  await expect(p.getByTestId("styles-panel").locator(".style-card")).toHaveCount(1);
  await expect(p.getByTestId("styles-panel").locator(".style-card")).toContainText("30 px");
  // Another text takes it, and keeps being as wide as its words.
  await p.keyboard.press("Escape");
  await p.mouse.click(310, 458);
  await p.getByTestId("styles-panel").locator(".style-card").click();
  await expect.poll(async () => (await texts()).find((t) => t.id === b!.id)).toMatchObject({ align: "right", autoWidth: true });
  const after = (await texts()).find((t) => t.id === b!.id)!;
  expect(after.size as number).toBeGreaterThan((b!.size as number) * 1.5);
  expect(after.w as number).toBeGreaterThan((b!.w as number) * 1.5); // refitted to the bigger size
  expect(((await texts()).find((t) => t.id === a!.id) as Record<string, unknown>)["align"]).toBe("right");
  expect(app.consoleErrors).toEqual([]);
});

test("Styles: a gradient map on a picture maps its brightness onto a saved gradient, by an amount, in one undo step", async ({ app }) => {
  const p = app.page;
  await p.getByRole("button", { name: "Styles panel", exact: true }).click();
  await p.getByTestId("styles-import").setInputFiles({ name: "sunset.ggr", mimeType: "text/plain", buffer: Buffer.from(SUNSET) });
  await p.getByTestId("styles-panel").getByRole("tab", { name: /^Gradients/ }).click();
  await expect(p.getByTestId("styles-panel").locator(".style-card", { hasText: "Sunset" })).toBeVisible();
  await p.getByTestId("import-input").setInputFiles({ name: "grey.png", mimeType: "image/png", buffer: makePng(80, 80, () => [128, 128, 128, 255]) });
  await expect.poll(async () => (await objs(app)).length).toBe(1);
  await app.frame();
  const pic = (await objs(app))[0]!;
  await p.keyboard.press("v");
  await p.mouse.click(...(await centre(app, pic.id)));
  await openAdjust(p);
  const pop = p.locator(".adjust-pop");
  await pop.locator("[data-adj-map]").selectOption({ label: "Sunset" });
  const map = (await objs(app))[0]!.adjust!.map!;
  expect(map.amount).toBe(100);
  expect(map.stops.map((s) => s.c)).toEqual(["#ff0000", "#0000ff"]);
  await p.keyboard.press("Escape");
  await p.mouse.click(1100, 700); // nothing picked: a selection paints over the pixels
  const [x, y] = await centre(app, pic.id);
  const shown = await p.evaluate(([a, b]) => window.__canvastDebug.pixelAt(a!, b!), [x, y]);
  expect(shown[0]! > 100 && shown[2]! > 100 && shown[1]! < 40, "mid grey on a red-to-blue map is purple").toBe(true);
  await p.keyboard.press("Control+z");
  expect((await objs(app))[0]!.adjust).toBeUndefined();
  // a gradient style goes on a picked picture from the Styles panel, as a gradient map
  await p.mouse.click(...(await centre(app, pic.id)));
  await p.getByTestId("styles-panel").locator(".style-card", { hasText: "Sunset" }).click();
  await expect.poll(async () => (await objs(app))[0]!.adjust?.map?.stops.map((s) => s.c)).toEqual(["#ff0000", "#0000ff"]);
  await p.keyboard.press("Control+z");
  // a custom gradient made right there, in the floating picker panel beside the Adjust panel
  await p.mouse.click(...(await centre(app, pic.id)));
  await openAdjust(p);
  await pop.locator("[data-adj-map]").selectOption({ label: "Make a custom gradient…" });
  await expect(p.locator(".colour-pop").filter({ hasText: "Save gradient" }).locator(".cg")).toBeVisible();
  await expect(pop.locator(".cg"), "not inside the Adjust panel").toHaveCount(0);
  await expect.poll(async () => (await objs(app))[0]!.adjust?.map?.stops.map((s) => s.c)).toEqual(["#1e1b4b", "#f59e0b"]);
  expect(app.consoleErrors).toEqual([]);
});
