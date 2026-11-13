import { expect, floatingProblems, test } from "./harness";
import type { App } from "./harness";

/**
 * The Properties bar near the selection (ADR 0198): value chips just above what is selected, each opening its options as a form, and the one
 * rule of the tools that make things (what a tool has just made stays selected, its chips edit it and the next one takes it). Every chip of
 * every kind is checked against the rules of floating bars (`floatingProblems`). (Every other spec uses the bar at the top, the default.)
 */
const set = (app: App, key: string, value: unknown) => app.page.evaluate(([k, v]) => window.__canvastDebug.setSetting(k, v), [key, value] as const);
const objects = (app: App) => app.page.evaluate(() => window.__canvastDebug.objects() as Array<{ id: string; container?: unknown; fill?: unknown; kind: string }>);
const select = (app: App, ids: string[]) => app.page.evaluate((x) => window.__canvastDebug.select(x), ids);
/** Open every chip in turn (the ones near the selection, or at the top) and gather the rules each breaks. */
async function auditChips(app: App, where: string): Promise<string[]> {
  const p = app.page;
  const out: string[] = [];
  const ids = await p.locator(`${where} [data-vchip]`).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset["vchip"]!));
  expect(ids.length, `chips in ${where}`).toBeGreaterThan(0);
  for (const id of ids) {
    await p.locator(`${where} [data-vchip="${id}"]`).click();
    await expect(p.locator(".vchip-pop")).toBeVisible();
    out.push(...(await floatingProblems(p)).map((m) => `${id}: ${m}`));
    await p.keyboard.press("Escape");
    await expect(p.locator(".vchip-pop")).toHaveCount(0);
  }
  return [...out, ...(await floatingProblems(p))];
}

test("a shape drawn with the Shape tool: its chips stand above it and edit it, the tool stays, and the next shape takes the colour", async ({ app }) => {
  const p = app.page;
  await set(app, "ui.properties", "near");
  await p.keyboard.press("u");
  await app.drag({ x: 500, y: 380 }, { x: 700, y: 520 }, 6);
  await expect(p.getByRole("radio", { name: "Shape and path" })).toHaveAttribute("aria-checked", "true");
  const near = p.locator(".props-near");
  // (named groups as the Actions bar's: the section's name, and on its chip the section's icon and value)
  await expect(near.locator(".tb-cap")).toHaveText(["Look", "Shape", "Size"]);
  expect((await near.boundingBox())!.y + (await near.boundingBox())!.height, "the chips above the shape").toBeLessThanOrEqual(380);
  // the Shape chip: its corner radius is the drawn shape's
  const chip = near.locator('[data-vchip="shape"]');
  await chip.click();
  const radius = p.locator(".vchip-pop").getByLabel("Corner radius (px)");
  await radius.fill("20");
  await radius.press("Enter");
  await expect(chip, "the chip reads it, its popover still open").toContainText("20 px");
  await p.keyboard.press("Escape");
  // the Look chip: a fill for this shape is the next one's too
  await near.locator('[data-vchip="look"]').click();
  await p.locator(".vchip-pop [data-paint=fill]").click();
  const hex = p.locator(".colour-pop [data-hex]");
  await hex.fill("ff8800");
  await hex.press("Enter");
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  const first = (await objects(app))[0]!;
  expect(JSON.stringify(first.fill)).toContain("ff8800");
  await app.drag({ x: 800, y: 180 }, { x: 920, y: 260 }, 6); // (clear of the chips, the Actions bar the drawn shape now has, and the dev panel)
  const second = (await objects(app)).at(-1)!;
  expect(second.id).not.toBe(first.id);
  expect(JSON.stringify(second.fill), "the tool kept the colour").toContain("ff8800");
  expect(await auditChips(app, ".props-near")).toEqual([]);
  expect(app.consoleErrors).toEqual([]);
});

test("every chip of a sheet, a thing on it, several things and a mix keeps the rules of floating bars; the popover follows its chip", async ({ app }) => {
  const p = app.page;
  await set(app, "ui.properties", "near");
  for (const x of [300, 450, 600]) {
    await p.keyboard.press("u");
    await app.drag({ x, y: 300 }, { x: x + 100, y: 380 }, 4);
  }
  await p.keyboard.press("v");
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Shift+A");
  await expect.poll(async () => (await objects(app)).some((o) => o.container)).toBe(true);
  const all = await objects(app);
  const sheet = all.find((o) => o.container)!.id;
  const kids = all.filter((o) => !o.container).map((o) => o.id);
  for (const [name, ids, expected] of [
    ["a sheet", [sheet], ["layout", "spacing", "columns"]],
    ["a thing on it", [kids[1]!], ["inlayout", "position"]],
    ["several", kids, ["colours"]],
  ] as const) {
    await select(app, [...ids]);
    const near = p.locator(".props-near");
    await expect(near).toBeVisible();
    for (const id of expected) await expect(near.locator(`[data-vchip="${id}"]`), `${name}: ${id}`).toBeVisible();
    expect(await auditChips(app, ".props-near"), name).toEqual([]);
  }
  // a mix: the Kind chip; choosing a kind changes the chips, and its popover stays by it (not at a corner of the window)
  await select(app, [sheet, kids[1]!]);
  const kind = p.locator('.props-near [data-vchip="kind"]');
  await kind.click();
  await p.locator('.vchip-pop [data-subject="shape"]').click();
  await expect(kind).toHaveAttribute("aria-expanded", "true");
  const [k, pop] = [(await kind.boundingBox())!, (await p.locator(".vchip-pop").boundingBox())!];
  expect(pop.x < k.x + k.width && pop.x + pop.width > k.x, "under or over its chip, not elsewhere").toBe(true);
  expect(Math.min(Math.abs(pop.y - (k.y + k.height)), Math.abs(k.y - (pop.y + pop.height))), "next to it").toBeLessThan(24);
  expect(await floatingProblems(p)).toEqual([]);
  // a small window: the sheet's chips stay inside it and scroll sideways, with the cue at the end that has more (as the Actions bar)
  await p.keyboard.press("Escape");
  await p.setViewportSize({ width: 427, height: 900 });
  await select(app, [sheet]);
  const row = p.locator(".props-near > .props-row");
  await expect(row).toHaveAttribute("data-scroll-end", "");
  expect((await p.locator(".props-near").boundingBox())!.x + (await p.locator(".props-near").boundingBox())!.width, "inside the window").toBeLessThanOrEqual(427);
  await row.evaluate((r) => r.scrollTo({ left: r.scrollWidth }));
  await expect(row).toHaveAttribute("data-scroll-start", "");
  await row.locator("[data-vchip]").last().click();
  await expect(p.locator(".vchip-pop")).toBeVisible();
  expect(app.consoleErrors).toEqual([]);
});

test("with nothing selected a tool's chips are at the top; the palette opens a closed chip; back to the bar, the options are in it", async ({ app }) => {
  const p = app.page;
  await set(app, "ui.properties", "near");
  await p.keyboard.press("p");
  const top = p.locator(".props-chips");
  await expect(top.locator(".tb-cap")).toHaveText(["Look", "Brush"]);
  expect(await auditChips(app, ".props-chips")).toEqual([]);
  await p.keyboard.press("Control+k");
  await p.keyboard.type("Stabilizer");
  await p.getByRole("option").filter({ hasText: "Properties" }).first().click();
  await expect(top.locator('[data-vchip="brush"]')).toHaveAttribute("aria-expanded", "true");
  await expect(p.locator(".vchip-pop").getByRole("button", { name: "Stabilizer" })).toHaveAttribute("aria-pressed", "true");
  await p.keyboard.press("Escape");
  await set(app, "ui.properties", "bar");
  await expect(p.getByRole("toolbar", { name: "Tool options" }).getByRole("button", { name: "Stabilizer" })).toBeVisible();
  await expect(top).toBeHidden();
  expect(app.consoleErrors).toEqual([]);
});

test("a text's chips are Text, Text outline and Paragraph, every field named in full with its value whole; its colour picker stays off it", async ({ app }) => {
  const p = app.page;
  await set(app, "ui.properties", "near");
  await p.keyboard.press("t");
  await p.mouse.click(500, 420);
  await p.keyboard.type("abc");
  await p.keyboard.press("Escape");
  await p.keyboard.press("v");
  await select(app, [(await objects(app)).at(-1)!.id]);
  const near = p.locator(".props-near");
  await expect(near.locator(".tb-cap")).toHaveText(["Text", "Text outline", "Paragraph"]);
  expect(await auditChips(app, ".props-near")).toEqual([]);
  await near.locator('[data-vchip="paragraph"]').click();
  await expect(p.locator(".vchip-pop").getByText("Line height", { exact: true }), "the full name, not the bar's \"Line\"").toBeVisible();
  await p.keyboard.press("Escape");
  await near.locator('[data-vchip="text"]').click();
  await p.locator(".vchip-pop [data-text-colour]").click();
  await expect(p.locator(".colour-pop")).toBeVisible();
  expect(await floatingProblems(p)).toEqual([]);
  expect(app.consoleErrors).toEqual([]);
});

test("with something selected, another tool's options stand at the top, never by the selection; back on Select they are the selection's again", async ({ app }) => {
  const p = app.page;
  await set(app, "ui.properties", "near");
  await p.keyboard.press("u");
  await app.drag({ x: 500, y: 380 }, { x: 700, y: 520 }, 6);
  await p.keyboard.press("v");
  for (const [key, first] of [["e", "Eraser"], ["t", "Text"], ["p", "Look"], ["l", "Lasso"], ["u", "Look"]] as const) {
    await p.keyboard.press(key);
    await expect(p.locator(".props-near"), `${key}: not by the selection`).toBeHidden();
    await expect(p.locator(".props-chips .tb-cap").first(), `${key}: the tool's own, at the top`).toHaveText(first);
  }
  await p.keyboard.press("v");
  await expect(p.locator(".props-near")).toBeVisible();
  expect(app.consoleErrors).toEqual([]);
});

test("every dropdown opens the app's one list: the arrows move, a choice rested on is taken with the list still open, Enter takes and closes", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-settings").click();
  const field = p.locator("select:visible").first();
  const before = await field.inputValue();
  await field.focus();
  await p.keyboard.press("ArrowDown"); // (opens the list, not the browser's)
  const list = p.locator(".combo-pop");
  await expect(list).toBeVisible();
  await expect(list.locator('[aria-selected="true"]')).toHaveCount(1);
  await p.keyboard.press("ArrowDown");
  await expect.poll(() => field.inputValue(), { message: "taken after a moment, the list still open" }).not.toBe(before);
  await expect(list).toBeVisible();
  expect(await floatingProblems(p)).toEqual([]);
  await p.keyboard.press("Enter");
  await expect(list).toHaveCount(0);
  expect(app.consoleErrors).toEqual([]);
});
