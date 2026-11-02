import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./harness";
import { makePng } from "./png";

/** The notes editor (SunEditor) in the library viewer: markdown, plain text and rich text notes, their links to library items. */

const CAT = makePng(4, 4, () => [200, 120, 40, 255]);
const TEMPLATE = "## Sketch log\n\nFrom the library.\n";
const MD = "# Plan\n\nSome **bold** words.\n\n- [ ] a task\n\n![cat](Pictures/cat.png)\n";
const hashOf = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
const card = (p: Page, hash: string) => p.locator(`[data-testid="asset-card"][data-hash="${hash}"]`);
const note = (p: Page) => p.getByTestId("note-editor");
const page = (p: Page) => note(p).locator(".sun-editor-editable").first();
const downloaded = async (p: Page): Promise<string> => {
  if (!(await p.getByTestId("asset-download").isVisible())) await p.locator(".viewer-details").click(); // (the details panel, if it is closed)
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId("asset-download").click()]);
  return readFile((await dl.path())!, "utf8");
};

test("a markdown note opens in the notes editor with its library links, saves in place, and asks before formatting is lost", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles([
    { name: "cat.png", mimeType: "image/png", buffer: CAT },
    { name: "plan.md", mimeType: "text/markdown", buffer: Buffer.from(MD) },
    { name: "Sketch log.md", mimeType: "text/markdown", buffer: Buffer.from(TEMPLATE) },
  ]);
  // Its card on a canvas is its whole page at twice its size: 1200 px wide, as tall as the note (here the shortest, 4:3).
  await expect.poll(() => p.evaluate((h) => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.hash === h).map((e) => [e.pixelW, e.pixelH])[0]), hashOf(MD))).toEqual([1200, 900]);
  // A note's card shows its page (its preview, the same picture as its card on a canvas), not the plain file tile.
  await expect.poll(() => card(p, hashOf(MD)).locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  // A note tagged `template` is offered as a template in every other note.
  await card(p, hashOf(TEMPLATE)).click();
  await expect.poll(() => p.getByTestId("asset-preview").locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0); // (its details show its page too)
  await p.getByTestId("asset-tag-input").fill("template");
  await p.getByTestId("asset-tag-input").press("Enter");
  await card(p, hashOf(MD)).dblclick();

  // Opened: its words, its task box, and its picture shown from the library (the link names it by its path).
  await expect(page(p).locator("h1")).toHaveText("Plan");
  await expect(page(p).locator('input[type="checkbox"]')).toHaveCount(1);
  await expect(page(p).locator("li", { has: p.locator('input[type="checkbox"]') })).toHaveCSS("list-style-type", "none"); // (its box is its mark)
  await expect(page(p).locator("img")).toHaveAttribute("src", /^blob:/);

  // Written to and saved (Ctrl+S): the same item, its file rewritten as markdown with its links as they were.
  await page(p).locator("h1").click();
  await p.keyboard.press("End");
  await p.keyboard.type(" for today");
  await page(p).locator('input[type="checkbox"]').click(); // (a task box is ticked in the note)
  await p.keyboard.press("Control+s");
  await expect(p.getByTestId("assets-status")).toContainText("Saved “plan.md”");
  const saved = await downloaded(p);
  expect(saved).toContain("# Plan for today");
  expect(saved).toContain("- [x] a task");
  expect(saved).toContain("![cat](Pictures/cat.png)");

  // Insert ▸ Template: the built-in ones, then the library's notes tagged `template`, at the cursor.
  await page(p).locator("p").first().click();
  for (const [name, heading] of [["Meeting notes", "Meeting notes"], ["Sketch log", "Sketch log"]] as const) {
    const tpl = note(p).locator('button[data-command="template"]');
    if (!(await tpl.isVisible())) await note(p).getByRole("button", { name: "Insert" }).click(); // (the Insert row stays open once opened)
    await tpl.click();
    await p.locator(".se-dropdown").filter({ visible: true }).getByRole("button", { name }).click();
    await expect(page(p).locator("h2", { hasText: heading })).toHaveCount(1);
  }

  // Centred: markdown cannot hold it, so saving asks; a rich text note is made beside it and opened, the markdown file as it was.
  await page(p).locator("h1").click();
  await note(p).locator('.se-toolbar button[data-command="align"]').click();
  await p.locator('.se-dropdown button[data-command="center"]').filter({ visible: true }).click();
  await p.keyboard.press("Control+s");
  const ask = p.getByTestId("choose-dialog");
  await expect(ask).toContainText("cannot be kept in a markdown file");
  await ask.getByRole("button", { name: "Save" }).click();
  await expect(p.getByTestId("assets-status")).toContainText("Saved as the rich text note “plan.note.html”");
  await expect(page(p).locator("h1")).toHaveCSS("text-align", "center");
  const rich = await downloaded(p);
  expect(rich).toMatch(/<h1[^>]*text-align: ?center/);
  expect(rich).toContain('src="Pictures/cat.png"');

  // The Insert image dialog's gallery button opens the library chooser above the dialog: the picture chosen fills its address.
  await note(p).locator('.se-toolbar button[data-command="image"]').filter({ visible: true }).click();
  await p.locator(".__se__gallery").filter({ visible: true }).click();
  const chooser = p.locator(".lib-pick.is-centred");
  await expect(chooser.locator(".lib-item")).toHaveCount(1); // (pictures only: not the notes)
  await chooser.getByRole("button", { name: "cat.png" }).click(); // (a click on it: nothing covers it)
  await p.locator(".se-modal").filter({ visible: true }).getByRole("button", { name: "Submit" }).click();
  await expect(page(p).locator("img")).toHaveCount(2);
  for (const img of await page(p).locator("img").all()) expect((await img.boundingBox())?.width, "every picture shows (none hidden by the viewer's own styles)").toBeGreaterThan(0);

  // Leaving with changes asks first: Don't save lets them go.
  await p.getByTestId("slide-view").locator('[data-act="close"]').click();
  await expect(p.getByTestId("choose-dialog")).toContainText("has changes that are not saved");
  await p.getByTestId("choose-dialog").getByLabel("Don't save").check();
  await p.getByTestId("choose-dialog").getByRole("button", { name: "Go on" }).click();
  await expect(p.getByTestId("slide-view")).toBeHidden();
});

test("New note makes a markdown note in the open folder and opens it to write in; a table goes in, and a font of the library is used by its name", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "SpaceGrotesk.ttf", mimeType: "font/ttf", buffer: readFileSync("scripts/showcase/fonts/SpaceGrotesk_400Regular.ttf") });
  await p.getByTestId("assets-import-menu").click();
  await p.getByRole("menuitem", { name: /New note/ }).click();
  await expect(page(p).locator("h1")).toHaveText(/^Note \d{4}-\d\d-\d\d \d{6}$/);
  await expect(p.getByTestId("asset-card")).toHaveCount(2);

  // A table from the size picker, shown.
  await page(p).locator("h1").click();
  await p.keyboard.press("Control+End");
  await p.keyboard.press("Enter");
  await expect(note(p).locator('.se-toolbar button[data-command="font"] .se-txt')).toHaveText("Default"); // (not the page's list of font names)
  for (const gone of ["print", "newDocument", "pageBreak", "pageNavigator"]) await expect(note(p).locator(`[data-command="${gone}"]`), `no ${gone} in a note`).toHaveCount(0);
  await note(p).locator('.se-toolbar button[data-command="table"]').filter({ visible: true }).click();
  await p.locator(".se-table-size-picker").filter({ visible: true }).click({ position: { x: 30, y: 30 } });
  await expect(page(p).locator("table")).toBeVisible();

  // The library's font, chosen in the font list by its family name: the words are set in it.
  await page(p).locator("h1").first().selectText();
  await note(p).locator('.se-toolbar button[data-command="font"]').filter({ visible: true }).click();
  const list = p.locator(".se-list-font-family button").filter({ visible: true });
  const names = (await list.allTextContents()).filter((n) => n !== "Default" && n !== "Inter");
  expect(names.length, "the library's font is in the list").toBe(1);
  await list.filter({ hasText: names[0]! }).click();
  const used = await page(p).locator("h1 span").first().evaluate((s) => getComputedStyle(s).fontFamily);
  expect(used.replace(/"/g, "")).toBe(names[0]);
  expect(await p.evaluate((f) => document.fonts.check(`16px "${f}"`), names[0])).toBe(true);
});

test("a note's properties (YAML, as Obsidian writes them) are its item's tags, note and fields, both ways", async ({ app }) => {
  const p = app.page;
  const NOTE = "---\ntags:\n  - design\nauthor: Ana\ndescription: The cover plan\nnested:\n  a: 1\n---\n# Cover\n\nText.\n";
  const entry = () => p.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.name === "cover.md").map((e) => ({ tags: e.tags ?? [], note: e.note ?? "", fields: e.fields ?? [] }))[0]));
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "cover.md", mimeType: "text/markdown", buffer: Buffer.from(NOTE) });
  // Read in: its tags, its note (description) and its fields (the nested map is kept in the file, not shown).
  await expect.poll(entry).toEqual({ tags: ["design"], note: "The cover plan", fields: [{ key: "author", value: "Ana" }] });
  // The editor shows the note without its properties.
  await p.getByTestId("asset-card").first().dblclick();
  await expect(page(p).locator("h1")).toHaveText("Cover");
  await expect(page(p)).not.toContainText("author");
  // A tag added in the details goes into the file's YAML (a new version: the same item, its name and place).
  await p.getByTestId("asset-tag-input").fill("print");
  await p.getByTestId("asset-tag-input").press("Enter");
  await expect.poll(async () => (await downloaded(p)).includes("  - print")).toBe(true);
  // Saved from the editor: the text changes, the properties stay.
  await page(p).locator("h1").click();
  await p.keyboard.press("End");
  await p.keyboard.type(" art");
  await p.keyboard.press("Control+s");
  await expect(p.getByTestId("assets-status")).toContainText("Saved “cover.md”");
  const file = await downloaded(p);
  expect(file).toMatch(/^---\ntags:\n  - design\n  - print\nauthor: Ana\ndescription: The cover plan\nnested:\n  a: 1\n---\n# Cover art/);
  await expect.poll(entry).toEqual({ tags: ["design", "print"], note: "The cover plan", fields: [{ key: "author", value: "Ana" }] });
});

test("[[links]] between notes: shown as links, Ctrl+click opens the note, [[ offers the library's notes, saved as Obsidian writes them", async ({ app }) => {
  const p = app.page;
  const PLAN = "# Plan\n\nSee [[Brief|the brief]].\n";
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles([
    { name: "Plan.md", mimeType: "text/markdown", buffer: Buffer.from(PLAN) },
    { name: "Brief.md", mimeType: "text/markdown", buffer: Buffer.from("# Brief\n") },
  ]);
  await card(p, hashOf(PLAN)).dblclick();
  const link = page(p).locator("a", { hasText: "the brief" });
  await expect(link).toHaveAttribute("href", "canvast-wiki:Brief");
  // Typed: [[ offers the notes of the library; the one chosen goes in as a link.
  await page(p).locator("p").first().click();
  await p.keyboard.press("End");
  await p.keyboard.type(" Also [[Bri");
  await p.locator(".se-autocomplete-item, .se-select-item").filter({ visible: true, hasText: "Brief" }).first().click();
  await expect(page(p).locator('a[href="canvast-wiki:Brief"]')).toHaveCount(2);
  await p.keyboard.press("Control+s");
  await expect(p.getByTestId("assets-status")).toContainText("Saved “Plan.md”");
  expect(await downloaded(p)).toMatch(/See \[\[Brief\|the brief\]\]\. Also \[\[Brief\]\]/);
  // Ctrl+click opens the note it points at.
  await page(p).locator("a", { hasText: "the brief" }).click({ modifiers: ["ControlOrMeta"] });
  await expect(page(p).locator("h1")).toHaveText("Brief");
});
