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
  // Ctrl+S pressed fast, again and again: one save, not a question about another app (it is the same save).
  await page(p).locator("h1").click();
  await p.keyboard.press("End");
  await p.keyboard.type("!");
  for (let i = 0; i < 3; i++) await p.keyboard.press("Control+s");
  await expect.poll(async () => (await downloaded(p)).includes("# Plan for today!")).toBe(true);
  await expect(p.getByTestId("confirm-dialog")).toHaveCount(0);
  await page(p).locator("h1").click();
  await p.keyboard.press("End");
  await p.keyboard.press("Backspace");
  await p.keyboard.press("Control+s");
  await expect.poll(async () => (await downloaded(p)).includes("# Plan for today\n")).toBe(true);

  // Insert ▸ Template: the built-in ones, then the library's notes tagged `template`, at the cursor.
  await page(p).locator("p").first().click();
  for (const [name, heading] of [["Meeting notes", "Meeting notes"], ["Sketch log", "Sketch log"]] as const) {
    const tpl = note(p).locator('button[data-command="template"]');
    if (!(await tpl.isVisible())) await note(p).getByRole("button", { name: "Insert" }).click(); // (the Insert row stays open once opened)
    await tpl.click();
    await p.locator(".se-dropdown").filter({ visible: true }).getByRole("button", { name }).click();
    await expect(page(p).locator("h2", { hasText: heading })).toHaveCount(1);
  }
  await expect(page(p)).toContainText(/Date: \d{4}-\d\d-\d\d/); // ({{date}} in a template is filled in)

  // Centred: markdown cannot hold it, so saving asks; the note becomes a rich text note in its place (no markdown file left beside it).
  await page(p).locator("h1").click();
  await note(p).locator('.se-toolbar button[data-command="align"]').click();
  await p.locator('.se-dropdown button[data-command="center"]').filter({ visible: true }).click();
  await p.keyboard.press("Control+s");
  const ask = p.getByTestId("choose-dialog");
  await expect(ask).toContainText("cannot be kept in a markdown file");
  await ask.getByRole("button", { name: "Save" }).click();
  await expect(p.getByTestId("assets-status")).toContainText("“plan.md” is now the rich text note “plan.note.html”");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => e.name).filter((n) => n.startsWith("plan"))))).toEqual(["plan.note.html"]);
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
  // Markdown view and back, the note unchanged there: the picture keeps its size (it is not read again from markdown, which has none).
  const sized = await page(p).locator("img").last().getAttribute("width");
  await note(p).locator('[data-command="markdownView"]').first().evaluate((b: HTMLElement) => b.click());
  await note(p).locator('[data-command="markdownView"]').first().evaluate((b: HTMLElement) => b.click());
  expect(await page(p).locator("img").last().getAttribute("width")).toBe(sized);
  // A web address pasted over words makes those words the link. (Chromium only: Firefox does not let a test make a paste with its data.)
  if (test.info().project.name !== "firefox") await page(p).locator("p").first().evaluate((el) => {
    const r = document.createRange();
    r.setStart(el.firstChild!, 0);
    r.setEnd(el.firstChild!, 4); // (its first four letters)
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
    const dt = new DataTransfer();
    dt.setData("text/plain", "https://example.com/brief");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  if (test.info().project.name !== "firefox") await expect(page(p).locator('a[href="https://example.com/brief"]')).toHaveText(/^\S{4}$/); // (the four letters chosen)

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
  await expect(p.getByTestId("asset-backlinks")).toBeHidden(); // (nothing links to it: no Linked from)

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
  // (written into the file when asked for: Settings > Notes; off by default)
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Notes", exact: true }).click();
  await p.locator('[data-set="notes.writeProps"]').click({ force: true });
  const NOTE = "---\ntags:\n  - design\nauthor: Ana\ndescription: The cover plan\nnested:\n  a: 1\n---\n# Cover\n\nText.\n";
  const entry = () => p.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.name === "cover.md").map((e) => ({ tags: e.tags ?? [], note: e.note ?? "", fields: e.fields ?? [] }))[0]));
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "cover.md", mimeType: "text/markdown", buffer: Buffer.from(NOTE) });
  // Read in: its tags, its note (description) and its fields (the nested map is kept in the file, not shown).
  await expect.poll(entry).toEqual({ tags: ["design"], note: "The cover plan", fields: [{ key: "author", value: "Ana" }] });
  // The search finds a note by the words in it too ("text" is in its words only).
  await p.getByTestId("assets-search").fill("text");
  await expect(p.getByTestId("asset-card")).toHaveCount(1);
  await p.getByTestId("assets-search").fill("");
  await p.getByTestId("assets-search").press("Escape"); // (its help card closes)
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
  // #tags in the words: typed, or chosen from the library's tags (# offers them); they are the item's tags too.
  await page(p).locator("p").first().click();
  await p.keyboard.press("End");
  await p.keyboard.type(" #urgent and #des");
  await p.locator(".se-autocomplete-item, .se-select-item").filter({ visible: true, hasText: "design" }).first().click();
  await p.keyboard.press("Control+s");
  await expect(p.getByTestId("assets-status")).toContainText("Saved “cover.md”");
  const file = await downloaded(p);
  // (the YAML lists the tags not written in the words, and keeps one it had already)
  expect(file).toMatch(/^---\ntags:\n  - design\n  - print\nauthor: Ana\ndescription: The cover plan\nnested:\n  a: 1\n---\n# Cover art/);
  expect(file).toMatch(/Text\. #urgent and #design/);
  await expect.poll(async () => (await entry())?.tags.sort()).toEqual(["design", "print", "urgent"]);
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
  const list = (await p.locator(".se-select-menu").filter({ visible: true }).boundingBox())!;
  expect(list.x >= 0 && list.x + list.width <= (p.viewportSize()?.width ?? 1280), "the [[ list is inside the window").toBe(true);
  for (const row of await p.locator(".se-select-menu .se-select-item").filter({ visible: true }).all()) expect((await row.boundingBox())!.x + (await row.boundingBox())!.width, "each row inside the list's box").toBeLessThanOrEqual(list.x + list.width + 1);
  await p.locator(".se-autocomplete-item, .se-select-item").filter({ visible: true, hasText: "Brief" }).first().click();
  await expect(page(p).locator('a[href="canvast-wiki:Brief"]')).toHaveCount(2);
  // Resting the pointer on a link shows the preview of what it points at.
  await link.hover();
  await expect(p.locator(".note-link-peek img")).toBeVisible();
  await p.mouse.move(5, 400);
  await p.keyboard.press("Control+s");
  await expect(p.getByTestId("assets-status")).toContainText("Saved “Plan.md”");
  expect(await downloaded(p)).toMatch(/See \[\[Brief\|the brief\]\]\. Also \[\[Brief\]\]/);
  // Ctrl+click opens the note it points at; its details list the notes that link to it.
  await page(p).locator("a", { hasText: "the brief" }).click({ modifiers: ["ControlOrMeta"] });
  await expect(page(p).locator("h1")).toHaveText("Brief");
  if (!(await p.getByTestId("asset-download").isVisible())) await p.locator(".viewer-details").click();
  await expect(p.getByTestId("asset-backlinks")).toContainText("Plan.md");
  // Renamed: the links to it follow ([[Brief]] was its name alone).
  await p.evaluate(() => window.__canvastDebug.assetListing().then((l) => window.__canvastDebug.libraryOp("rename", l.entries.find((e) => e.name === "Brief.md")!.hash, "Overview.md")));
  await p.getByTestId("asset-backlinks").getByRole("button", { name: "Plan.md" }).click();
  await expect.poll(async () => (await downloaded(p)).match(/\[\[[^\]]+\]\]/g)).toEqual(["[[Overview|the brief]]", "[[Overview]]"]);
  // [[ offers the canvases too: Ctrl+click opens one.
  await page(p).locator("p").first().click();
  await p.keyboard.press("End");
  await p.keyboard.type(" [[canvas:Can");
  await p.locator(".se-autocomplete-item, .se-select-item").filter({ visible: true, hasText: "Canvas 1" }).first().click();
  await page(p).locator('a[href="canvast-wiki:canvas%3ACanvas%201"]').click({ modifiers: ["ControlOrMeta"] });
  await p.getByTestId("choose-dialog").getByRole("button", { name: "Go on" }).click(); // (Save them)
  await expect(p.locator(".asset-inspector")).toBeHidden();
});

test("a note's preview shows the pictures it links to (and an Obsidian ![[embed]]), on the paper of the Preview look", async ({ app }) => {
  const p = app.page;
  const PIC = makePng(300, 180, (x) => [220, 40 + (x % 60), 30, 255]);
  const NOTE = "# Moodboard\n\n![](pic.png)\n\n![[pic.png]]\n";
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "pic.png", mimeType: "image/png", buffer: PIC });
  await expect(p.getByTestId("asset-card")).toHaveCount(1);
  await p.getByTestId("assets-import-input").setInputFiles({ name: "board.md", mimeType: "text/markdown", buffer: Buffer.from(NOTE) });
  // Its library preview has the picture in it: many red pixels (the page itself is near white and grey).
  const reds = () =>
    card(p, hashOf(NOTE))
      .locator("img")
      .evaluate((img: HTMLImageElement) => {
        if (!img.complete || !img.naturalWidth) return 0;
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i]! > 150 && d[i + 2]! < 90) n++;
        return n;
      });
  await expect.poll(reds, { timeout: 10_000 }).toBeGreaterThan(500);
  // Settings > Notes, Preview look: Dark draws its preview on dark paper at once (Auto, the default, follows the app's theme).
  const corner = () =>
    card(p, hashOf(NOTE))
      .locator("img")
      .evaluate((img: HTMLImageElement) => {
        if (!img.complete || !img.naturalWidth) return -1;
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        return g.getImageData(4, 4, 1, 1).data[0]!;
      });
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Notes", exact: true }).click();
  await p.locator('[data-row="notes.look"] select').selectOption("dark");
  await p.getByTestId("view-assets").click();
  await expect.poll(corner, { timeout: 10_000 }).toBeLessThan(80);
  const LONG = `# Long\n\n${"A line of the note.\n\n".repeat(200)}`;
  await p.getByTestId("assets-import-input").setInputFiles({ name: "long.md", mimeType: "text/markdown", buffer: Buffer.from(LONG) });
  await expect.poll(() => p.evaluate((h) => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.hash === h).map((e) => [e.pixelW, e.pixelH])[0]), hashOf(LONG))).toEqual([1200, 8000]);
  // Two versions alike in length and start (a size changed back) each get a card of their own height (the second took the first's).
  const sized = (px: number) => `<p><span style="font-size: ${px}px;">${"Words that wrap when they are big. ".repeat(6)}</span></p>`;
  await p.getByTestId("assets-import-input").setInputFiles([{ name: "big.note.html", mimeType: "text/html", buffer: Buffer.from(sized(66)) }, { name: "small.note.html", mimeType: "text/html", buffer: Buffer.from(sized(16)) }]);
  const tall = (h: string) => p.evaluate((x) => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.hash === x)?.pixelH), h);
  await expect.poll(() => tall(hashOf(sized(16)))).toBe(900);
  expect(await tall(hashOf(sized(66)))).toBeGreaterThan(900);
  // A long note fades out into its own paper: dark on the dark look (it faded to white).
  const bottom = () =>
    card(p, hashOf(LONG))
      .locator("img")
      .evaluate((img: HTMLImageElement) => {
        if (!img.complete || !img.naturalWidth) return -1;
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        return g.getImageData(4, c.height - 2, 1, 1).data[0]!;
      });
  await expect.poll(bottom, { timeout: 10_000 }).toBeGreaterThanOrEqual(0);
  expect(await bottom()).toBeLessThan(80);
});

test("a note on a canvas opens in the note panel (a double-click, or Edit note): the same editor, saved in place, the card follows, renamed, undo never returns an old version", async ({ app }) => {
  const p = app.page;
  const NOTE = `# On the canvas\n\nFirst words.\n\n## Part two\n\n${"More of the page.\n\n".repeat(30)}`; // (long enough to cover the middle of the view, where it is pressed)
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "pic.png", mimeType: "image/png", buffer: makePng(60, 40, () => [200, 60, 40, 255]) });
  await p.getByTestId("assets-import-input").setInputFiles({ name: "board note.md", mimeType: "text/markdown", buffer: Buffer.from(NOTE) });
  await card(p, hashOf(NOTE)).click();
  await p.getByTestId("asset-place").click();
  await p.getByTestId("view-canvas").click();
  const placed = () => p.evaluate(() => (window.__canvastDebug.objects() as unknown as Array<{ assetId?: string }>).map((o) => o.assetId));
  await expect.poll(placed).toEqual([hashOf(NOTE)]);
  // A double-click on its card opens the panel, with the note in the notes editor.
  const box = (await p.locator("canvas").first().boundingBox())!;
  await p.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const panel = p.getByTestId("note-panel");
  await expect(panel.locator(".sun-editor-editable h1").first()).toHaveText("On the canvas");
  // A dock panel like the others: as wide as its place in the dock whatever it holds, its header the same as theirs.
  const widths = () => panel.evaluate((el) => [Math.round(el.getBoundingClientRect().width), Math.round(el.closest(".dock-item")!.getBoundingClientRect().width), Math.round(el.querySelector(".sun-editor")!.getBoundingClientRect().width)]);
  await expect.poll(async () => { const [a, b] = await widths(); return a === b; }).toBe(true);
  expect(await panel.evaluate((el) => el.classList.contains("layers-panel"))).toBe(true);
  // An editor never folds (a press on its header is no fold), and the panels' list rules stay out of its toolbar (no scrollbars there).
  await panel.locator(".panel-head h2").click();
  await expect(panel.locator(".sun-editor-editable h1").first()).toBeVisible();
  expect(await panel.evaluate((el) => [...el.querySelectorAll(".se-toolbar ul")].filter((u) => getComputedStyle(u).overflowY === "auto").length)).toBe(0);
  // nor its header rules into the note's headings (a ## heading is larger than the words)
  expect(await panel.evaluate((el) => parseFloat(getComputedStyle(el.querySelector(".sun-editor-editable h2")!).fontSize) > parseFloat(getComputedStyle(el.querySelector(".sun-editor-editable p")!).fontSize))).toBe(true);
  await panel.locator(".sun-editor-editable p").first().click();
  await p.keyboard.press("End");
  await p.keyboard.type(" More words.");
  await p.keyboard.press("Control+s");
  await expect(p.getByTestId("assets-status").or(p.locator(".notice")).first()).toBeAttached();
  // Saved: the card on the canvas is the new version (its item followed it).
  await expect.poll(placed).not.toEqual([hashOf(NOTE)]);
  // The font size is dragged left or right like every number of the app: a word chosen and the field dragged right is set larger.
  await panel.locator(".sun-editor-editable p").first().dblclick({ position: { x: 8, y: 8 } });
  const size = panel.locator(".__se__font_size").filter({ visible: true });
  await expect(size).toHaveValue("16px");
  const sb = (await size.boundingBox())!;
  await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await p.mouse.down();
  await p.mouse.move(sb.x + sb.width / 2 + 20, sb.y + sb.height / 2, { steps: 4 });
  await p.mouse.up();
  await expect(size).toHaveValue("26px");
  await expect(panel.locator('.sun-editor-editable span[style*="font-size: 26px"]').first()).toHaveText("First");
  // A size typed in the field: the words stay chosen while it is clicked and typed in, and take it.
  await panel.locator(".sun-editor-editable p").first().dblclick({ position: { x: 8, y: 8 } });
  await size.click();
  await size.fill("30px");
  await size.press("Enter");
  await expect(panel.locator('.sun-editor-editable span[style*="font-size: 30px"]').first()).toHaveText("First");
  // Remove format in the toolbar over chosen words takes a size back off (a heading or words made big by accident).
  await panel.locator(".sun-editor-editable p").first().dblclick({ position: { x: 8, y: 8 } });
  await p.locator('.se-toolbar button[data-command="removeFormat"]').filter({ visible: true }).first().click();
  await expect(panel.locator('.sun-editor-editable span[style*="font-size"]')).toHaveCount(0);
  // The editor's own dialogs work in the panel (nothing over them takes the clicks): a picture from the library, a link.
  await panel.locator('.se-toolbar button[data-command="image"]').filter({ visible: true }).click();
  await p.locator(".__se__gallery").filter({ visible: true }).click();
  await p.locator(".lib-pick.is-centred").getByRole("button", { name: "pic.png" }).click();
  await p.locator(".se-modal").filter({ visible: true }).getByRole("button", { name: "Submit" }).click();
  await expect(panel.locator(".sun-editor-editable").first().locator("img")).toHaveCount(1);
  await panel.locator(".sun-editor-editable p").first().click();
  await panel.locator('.se-toolbar button[data-command="link"]').filter({ visible: true }).click();
  const linkDialog = p.locator(".se-modal").filter({ visible: true });
  await linkDialog.locator("input").filter({ visible: true }).first().fill("https://example.com/canvas");
  await linkDialog.getByRole("button", { name: "Submit" }).click();
  await expect(panel.locator(".sun-editor-editable").first().locator('a[href="https://example.com/canvas"]')).toHaveCount(1);
  await p.keyboard.press("Control+s"); // (sizes taken off by Remove format: markdown keeps it all, nothing asked)
  await expect(p.getByTestId("choose-dialog")).toBeHidden();
  await panel.locator("[data-close]").click();
  await expect(panel).toBeHidden();
  // Edit note, in the Actions bar of the selected card, opens it too.
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.locator('[data-ctx="editnote"]').filter({ visible: true }).click();
  await expect(p.getByTestId("note-panel").locator(".sun-editor-editable p").first()).toContainText("More words.");
  // The canvas stays usable while the panel is open (it is a panel, not a dialog): the canvas takes a click beside it.
  await p.mouse.click(box.x + 20, box.y + box.height - 20);
  await expect(p.getByTestId("note-panel")).toBeVisible();
  // Renamed from the panel's header with the library's dialog: the extension stays as it was.
  await p.getByTestId("note-panel").locator("[data-rename]").click();
  await expect(p.locator('[data-rn="ext-fixed"]')).toHaveText(".md");
  // A paste into a field (or a dialog) is the field's: a copied file on the clipboard is not also imported and placed. (Chromium only: Firefox does not let a test make a paste with its data.)
  if (test.info().project.name !== "firefox") {
    await p.locator('[data-rn="one"]').evaluate((el, bytes) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], "pasted.png", { type: "image/png" }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, [...makePng(30, 20, () => [20, 160, 60, 255])]);
    await p.waitForTimeout(1000); // (a wrong import would place it by now)
    expect(await placed()).toHaveLength(1);
  }
  await p.locator('[data-rn="one"]').fill("plan");
  await p.getByTestId("rename-ok").click();
  await expect(p.getByTestId("note-panel").locator(".panel-head h2")).toHaveText("plan.md");
  // The saves are no steps of the canvas's undo: Undo takes back the placing (never back to the old version), Redo places the saved note.
  const saved = await placed();
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // (the keys go to the canvas, not the editor)
  await p.keyboard.press("Control+z");
  await expect.poll(placed).toEqual([]);
  await p.keyboard.press("Control+Shift+z");
  await expect.poll(placed).toEqual(saved);
});

test("a note's card lays its page out at its own size: a side handle flows the words, an even corner zooms, Part keeps the height set, Whole note follows the note at once", async ({ app }) => {
  const p = app.page;
  type Card = { assetId: string; w: number; h: number; pixelW: number; pixelH: number; page?: true };
  const cardNow = () => p.evaluate(() => window.__canvastDebug.objects()[0] as unknown as Card);
  const NOTE = `# Flowing\n\n${"Words that wrap at the width of the page they are laid out on. ".repeat(30)}\n`;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "flow.md", mimeType: "text/markdown", buffer: Buffer.from(NOTE) });
  await card(p, hashOf(NOTE)).click();
  await p.getByTestId("asset-place").click();
  await p.getByTestId("view-canvas").click();
  // Whole note, the default: as tall as the note, never stretched.
  await expect.poll(async () => (await cardNow()).page).toBe(true);
  const unstretched = (c: Card): void => expect(Math.abs(c.w / c.h / (c.pixelW / c.pixelH) - 1)).toBeLessThan(0.02);
  const c0 = await cardNow();
  unstretched(c0);
  const box = (await p.locator("canvas").first().boundingBox())!;
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const frame = async () => (await p.evaluate(() => window.__canvastDebug.selectionFrame()))!.corners;
  const drag = async (from: readonly number[], dx: number, dy: number): Promise<void> => {
    await p.mouse.move(from[0]!, from[1]!);
    await p.mouse.down();
    await p.mouse.move(from[0]! + dx, from[1]! + dy, { steps: 6 });
    await p.mouse.up();
  };
  // The right handle: a wider page, the words as big, fewer lines (Whole note: a shorter card).
  let c = await frame();
  await drag([c[1]![0], (c[1]![1] + c[2]![1]) / 2], 120, 0);
  await expect.poll(async () => (await cardNow()).pixelH).toBeLessThan(c0.pixelH);
  const c1 = await cardNow();
  expect(c1.pixelW).toBeGreaterThan(c0.pixelW);
  unstretched(c1);
  expect(Math.abs(c1.w / c1.pixelW / (c0.w / c0.pixelW) - 1), "the words keep their size").toBeLessThan(0.02);
  // A corner with Shift (even): the card zooms, its page as it was.
  c = await frame();
  await p.keyboard.down("Shift");
  await drag(c[2]!, 40, 40);
  await p.keyboard.up("Shift");
  await expect.poll(async () => (await cardNow()).w).toBeGreaterThan(c1.w);
  expect((await cardNow()).pixelW).toBe(c1.pixelW);
  // Part: the bottom handle sets the height, and it stays.
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Notes", exact: true }).click();
  await p.locator('[data-row="notes.cardShows"] select').selectOption("part");
  await p.getByTestId("view-canvas").click();
  c = await frame();
  const before = await cardNow();
  await drag([(c[2]![0] + c[3]![0]) / 2, c[2]![1]], 0, -60);
  await expect.poll(async () => (await cardNow()).pixelH).toBeLessThan(before.pixelH);
  const cut = await cardNow();
  unstretched(cut);
  await p.waitForTimeout(400);
  expect((await cardNow()).pixelH, "not fitted again").toBe(cut.pixelH);
  // Back to Whole note: the existing card is the whole note again at once.
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Notes", exact: true }).click();
  await p.locator('[data-row="notes.cardShows"] select').selectOption("whole");
  await p.getByTestId("view-canvas").click();
  await expect.poll(async () => (await cardNow()).pixelH).toBe(before.pixelH);
  // Saved longer: it follows the new version, as wide as it was, taller.
  await p.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const panel = p.getByTestId("note-panel");
  await panel.locator(".sun-editor-editable p").first().click();
  await p.keyboard.press("Control+End");
  for (let i = 0; i < 6; i++) await p.keyboard.press("Enter"), await p.keyboard.type("More.");
  await p.keyboard.press("Control+s");
  await expect.poll(async () => (await cardNow()).assetId).not.toBe(hashOf(NOTE));
  await expect.poll(async () => (await cardNow()).pixelH).toBeGreaterThan(before.pixelH);
  expect((await cardNow()).pixelW).toBe(before.pixelW);
  expect(app.consoleErrors).toEqual([]);
});

test("the note keeps what is done at it: Undo and Delete with the focus off its words stay out of the canvas, nothing typed is lost, a note made rich text is one", async ({ app }) => {
  const p = app.page;
  const NOTE = `# Keys\n\n![pic](pic.png)\n\n${"Words on the page.\n\n".repeat(25)}`;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "pic.png", mimeType: "image/png", buffer: CAT });
  await p.getByTestId("assets-import-input").setInputFiles({ name: "keys.md", mimeType: "text/markdown", buffer: Buffer.from(NOTE) });
  await card(p, hashOf(NOTE)).click();
  await p.getByTestId("asset-place").click();
  await p.getByTestId("view-canvas").click();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
  const left = () => p.evaluate(async () => { const d = window.__canvastDebug; const o = d.objects()[0]; return o ? d.objectScreen(o.id)!.box.minX : null; });
  const open = async (): Promise<void> => {
    const b = await p.evaluate(() => { const d = window.__canvastDebug; return d.objectScreen(d.objects()[0]!.id)!.box; });
    await p.mouse.dblclick((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  };
  // A step on the canvas (the card moved), then the note open beside it.
  const b0 = await p.evaluate(() => { const d = window.__canvastDebug; return d.objectScreen(d.objects()[0]!.id)!.box; });
  await p.mouse.click((b0.minX + b0.maxX) / 2, (b0.minY + b0.maxY) / 2);
  await p.keyboard.press("ArrowRight");
  await expect.poll(left).not.toBe(b0.minX);
  const moved = await left();
  await open();
  const panel = p.getByTestId("note-panel");
  const words = panel.locator(".sun-editor-editable").first();
  await expect(words.locator("h1")).toHaveText("Keys");
  // The panel's header pressed, then a picture of the note selected: Undo and Redo are the note's, and Delete takes the picture, not the card.
  await panel.locator(".panel-head h2").click();
  await p.keyboard.press("Control+z");
  await p.keyboard.press("Control+Shift+z");
  expect(await left()).toBe(moved);
  await words.locator("img").first().click({ force: true });
  await p.keyboard.press("Control+z");
  expect(await left()).toBe(moved);
  await p.keyboard.press("Delete");
  await expect(words.locator("img")).toHaveCount(0);
  expect(await p.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
  // A press outside: the canvas's keys are the canvas's again.
  await p.mouse.click(5, 450);
  await p.keyboard.press("Control+z");
  await expect.poll(left).not.toBe(moved);
  await p.keyboard.press("Control+Shift+z");
  // Typed while it is being saved: still a change, so leaving asks.
  await words.locator("h1").click();
  await p.keyboard.press("End");
  await p.keyboard.type("!");
  await p.keyboard.press("Control+s");
  await p.keyboard.type("more");
  await expect(words.locator("h1")).toContainText("more");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.some((e) => e.name === "keys.md" && e.hash !== "")))).toBe(true);
  await p.waitForTimeout(600); // (the save has ended)
  await panel.locator("[data-close]").click();
  const ask = p.getByTestId("choose-dialog");
  await expect(ask).toContainText("has changes that are not saved");
  // Saved as rich text on the way out (centred: markdown cannot hold it): the panel stays closed.
  await p.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await words.locator("h1").click();
  await panel.locator('.se-toolbar button[data-command="align"]').first().evaluate((b: HTMLElement) => b.click());
  await p.locator('.se-dropdown button[data-command="center"]').filter({ visible: true }).click();
  await panel.locator("[data-close]").click();
  await ask.getByLabel("Save them").check();
  await ask.getByRole("button", { name: "Go on" }).click();
  await ask.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => e.name).filter((n) => n.startsWith("keys"))))).toEqual(["keys.note.html"]);
  await p.waitForTimeout(300);
  await expect(panel).toBeHidden();
  // Opened again it is a rich text note: saved again, no question and no second suffix; the panel's title says so.
  await open();
  await expect(panel.locator(".panel-head h2")).toHaveText("keys.note.html");
  await words.locator("h1").click();
  await p.keyboard.press("End");
  await p.keyboard.type("?");
  await p.keyboard.press("Control+s");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => e.name).filter((n) => n.startsWith("keys"))))).toEqual(["keys.note.html"]);
  await expect(ask).toHaveCount(0);
});

test("Markdown view: what is typed there counts as a change; what a file writes survives a save (lines, marks, code, tables, brackets)", async ({ app }) => {
  const p = app.page;
  const SAME = "# Same\n\nfirst line\nsecond line\n\n==marked== and <kbd>Ctrl</kbd>\n\n> [!note] Title\n> body\n\n```c++ x\nint a;\n\n  int b;\n```\n\n````md\n```x\ny\n```\n````\n\n| a | b |\n| :--- | ---: |\n| *i* **b** | 2 |\n\n[[Foo (bar)]] and [x](obsidian://open?f=1)\n";
  const FIXED = "T\n===\n\n* star   list\n\n2 * 3 * 4 ![c](cat%20(2).png)\n\n![[cat (2).png]]\n\n1. a\n\n   para\n\n| a |\n|:--|\n| 1 | 2 |\n";
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles([
    { name: "cat (2).png", mimeType: "image/png", buffer: CAT },
    { name: "same.md", mimeType: "text/markdown", buffer: Buffer.from(SAME) },
    { name: "fixed.md", mimeType: "text/markdown", buffer: Buffer.from(FIXED) },
    { name: "first.md", mimeType: "text/markdown", buffer: Buffer.from("one\n") },
  ]);
  // Two notes with one text stay two.
  await p.getByTestId("assets-import-input").setInputFiles({ name: "second.md", mimeType: "text/markdown", buffer: Buffer.from("one\n") });
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => /^(first|second)/.test(e.name)).length))).toBe(2);
  const text = () => p.evaluate(() => window.__canvastDebug.notesAsText()[0]!);
  const close = async (): Promise<void> => {
    await p.getByTestId("slide-view").locator('[data-act="close"]').click();
    await expect(p.getByTestId("slide-view")).toBeHidden();
  };
  await card(p, hashOf(SAME)).dblclick();
  await expect(page(p).locator("h1")).toHaveText("Same");
  expect((await text()).keepsAll).toBe(true);
  await page(p).locator("h1").click();
  await p.keyboard.press("End");
  await p.keyboard.type("!");
  await expect.poll(async () => (await text()).text).toBe(SAME.replace("# Same", "# Same!"));
  await p.keyboard.press("Backspace");
  await close();
  await card(p, hashOf(FIXED)).dblclick();
  await expect(page(p).locator("h1")).toHaveText("T");
  await expect.poll(() => page(p).locator("img").evaluateAll((l) => l.map((i) => (i as HTMLImageElement).naturalWidth > 0))).toEqual([true, true]); // (a name with brackets, an embed)
  await expect(page(p).locator("li").filter({ hasText: "para" })).toHaveCount(1); // (a paragraph under its list item)
  // Nothing edited: written as the file has it. One word edited: only that part changes.
  expect((await text()).text).toBe(FIXED);
  await page(p).locator("h1").click();
  await p.keyboard.press("End");
  await p.keyboard.type("!");
  await expect.poll(async () => (await text()).text).toBe(FIXED.replace("T\n===", "# T!"));
  await p.keyboard.press("Control+s");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.name === "fixed.md")?.hash))).not.toBe(hashOf(FIXED));
  await close();
  // Typed in the Markdown view, on the way out or back in the page.
  await card(p, hashOf(SAME)).dblclick();
  const toggle = note(p).locator('[data-command="markdownView"]').first();
  await toggle.evaluate((b: HTMLElement) => b.click());
  await note(p).locator("textarea.se-markdown-viewer").click();
  await p.keyboard.press("Control+End");
  await p.keyboard.type("typed");
  await p.getByTestId("slide-view").locator('[data-act="close"]').click();
  await expect(p.getByTestId("choose-dialog")).toContainText("has changes that are not saved");
  await p.keyboard.press("Escape");
  await expect(p.getByTestId("choose-dialog")).toHaveCount(0);
  await toggle.evaluate((b: HTMLElement) => b.click());
  await expect(page(p)).toContainText("typed");
  await p.getByTestId("slide-view").locator('[data-act="close"]').click();
  await expect(p.getByTestId("choose-dialog")).toContainText("has changes that are not saved");
  await p.getByTestId("choose-dialog").getByLabel("Don't save").check();
  await p.getByTestId("choose-dialog").getByRole("button", { name: "Go on" }).click();
});

test("a note's content pasted into another note keeps its pictures, after the first note closes; a file saved with a dead address finds them too", async ({ app }) => {
  test.skip(test.info().project.name === "firefox", "Firefox does not let a test make a paste with its data");
  const p = app.page;
  const A = "# From\n\n![pic](pic.png)\n\n| h | i |\n| --- | --- |\n| ![pic](pic.png) | z |\n";
  const DEAD = "# Old save\n\n![pic.png](blob:null/00000000-0000-0000-0000-000000000000)\n";
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles([
    { name: "pic.png", mimeType: "image/png", buffer: CAT },
    { name: "a.md", mimeType: "text/markdown", buffer: Buffer.from(A) },
    { name: "b.md", mimeType: "text/markdown", buffer: Buffer.from("# To\n\nWords.\n") },
    { name: "dead.md", mimeType: "text/markdown", buffer: Buffer.from(DEAD) },
  ]);
  const open = async (name: string): Promise<void> => {
    await p.locator(`[data-testid="asset-card"][title="${name}"]`).dblclick();
    await expect(page(p).locator("h1").first()).toBeVisible();
  };
  const leave = async (): Promise<void> => {
    await p.getByTestId("slide-view").locator('[data-act="close"]').click();
    await expect(p.getByTestId("slide-view")).toBeHidden();
  };
  const shows = () => page(p).locator("img").evaluateAll((l) => l.map((i) => (i as HTMLImageElement).naturalWidth > 0));
  await open("a.md");
  await expect.poll(shows).toEqual([true, true]);
  await expect(page(p).locator("td img")).toHaveCount(1); // (a picture in a table cell stays there)
  const copied = await page(p).innerHTML();
  await leave(); // (its address stops working here)
  await open("b.md");
  await page(p).locator("h1").evaluate((el, html) => {
    getSelection()!.collapse(el, el.childNodes.length);
    const dt = new DataTransfer();
    dt.setData("text/html", html);
    dt.setData("text/plain", "x");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, copied);
  await expect.poll(shows).toEqual([true, true]);
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.notesAsText()[0]!.text)).toContain("| ![pic](pic.png) | z |");
  expect(await p.evaluate(() => window.__canvastDebug.notesAsText()[0]!.text)).not.toContain("blob:");
  await p.keyboard.press("Control+s");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.some((e) => e.name === "b.md" && e.hash !== "")))).toBe(true);
  await p.waitForTimeout(500);
  if (await p.getByTestId("choose-dialog").count()) await p.getByTestId("choose-dialog").getByRole("button", { name: "Save" }).click();
  await p.waitForTimeout(300);
  await leave();
  await open("b.md");
  await expect.poll(shows).toEqual([true, true]);
  await leave();
  // Saved with a dead address by an older version: shown from the name it carries, its real link written at the next save.
  await open("dead.md");
  await expect.poll(shows).toEqual([true]);
  expect(await p.evaluate(() => window.__canvastDebug.notesAsText()[0]!.text)).toContain("(pic.png)");
});

test("Settings > Notes: Save notes on close saves without asking; a note's formatting is kept or dropped as chosen, without asking", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Notes", exact: true }).click();
  await p.locator('[data-set="notes.saveOnClose"]').click({ force: true });
  await p.locator('[data-set="notes.saveAs"]').selectOption("file");
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles([{ name: "keep.md", mimeType: "text/markdown", buffer: Buffer.from("# Keep\n\nWords.\n") }, { name: "rich.md", mimeType: "text/markdown", buffer: Buffer.from("# Rich\n\nWords.\n") }]);
  const names = () => p.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.map((e) => e.name).sort()));
  const edit = async (name: string): Promise<void> => {
    await p.locator(`[data-testid="asset-card"][title="${name}"]`).dblclick();
    await page(p).locator("h1").click();
    await p.keyboard.press("End");
    await p.keyboard.type("!");
    await note(p).locator('.se-toolbar button[data-command="align"]').first().click();
    await p.locator('.se-dropdown button[data-command="center"]').filter({ visible: true }).click();
    await p.getByTestId("slide-view").locator('[data-act="close"]').click();
    await expect(p.getByTestId("slide-view")).toBeHidden();
    await expect(p.getByTestId("choose-dialog")).toHaveCount(0);
  };
  await edit("keep.md");
  await expect.poll(names).toEqual(["keep.md", "rich.md"]);
  await p.locator('[data-testid="asset-card"][title="keep.md"]').dblclick();
  await expect(page(p).locator("h1")).toHaveText("Keep!");
  await expect(page(p).locator("h1")).not.toHaveCSS("text-align", "center");
  await p.getByTestId("slide-view").locator('[data-act="close"]').click();
  await expect(p.getByTestId("slide-view")).toBeHidden();
  await p.getByTestId("view-settings").click();
  await p.locator('[data-set="notes.saveAs"]').selectOption("rich");
  // The editor's style shows at once in a note open in it (the Note panel, which stays open beside Settings).
  await p.getByTestId("view-assets").click();
  await p.locator('[data-testid="asset-card"][title="keep.md"]').click();
  await p.getByTestId("asset-place").click();
  await p.getByTestId("view-canvas").click();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
  await expect.poll(() => p.evaluate(() => (window.__canvastDebug.objects()[0] as unknown as { page?: boolean }).page)).toBe(true); // (its card fitted to its note)
  await p.waitForTimeout(300);
  const at = await p.evaluate(() => { const d = window.__canvastDebug; return d.objectScreen(d.objects()[0]!.id)!.box; });
  await p.mouse.dblclick((at.minX + at.maxX) / 2, (at.minY + at.maxY) / 2);
  const panelPage = p.getByTestId("note-panel").locator(".sun-editor-editable").first();
  await expect(panelPage).toHaveClass(/se-type-document/);
  await p.getByTestId("view-settings").click();
  await p.locator('[data-set="notes.panelStyle"]').selectOption("classic");
  await p.getByTestId("view-canvas").click();
  await expect(p.getByTestId("note-panel").locator(".sun-editor-editable").first()).not.toHaveClass(/se-type-document/);
  // The / menu is in every style: at a line's start it offers commands; inside a word it stays away.
  const typed = p.getByTestId("note-panel").locator(".sun-editor-editable").first();
  await typed.locator("p").first().click();
  await p.keyboard.press("Control+End");
  await p.keyboard.press("Enter");
  await p.keyboard.type("/head");
  const heading2 = p.locator(".se-cmd-row").filter({ hasText: "Heading 2" }).filter({ visible: true });
  await expect(heading2).toHaveCount(1);
  await heading2.click();
  await expect(typed.locator("h2")).toHaveCount(1);
  await p.keyboard.type("and/or");
  await p.waitForTimeout(300);
  await expect(p.locator(".se-cmd-row").filter({ visible: true })).toHaveCount(0);
  await expect(typed.locator("h2")).toHaveText("and/or");
  // Classic has one short row; what else there is waits behind its +.
  const tool = p.getByTestId("note-panel").locator('.se-toolbar button[data-command="strike"]');
  await expect(tool.first()).toBeHidden();
  await p.getByTestId("note-panel").getByRole("button", { name: "More" }).first().click();
  await expect(tool.filter({ visible: true })).toHaveCount(1);
  await p.getByTestId("note-panel").locator("[data-close]").click();
  await p.getByTestId("view-assets").click();
  await edit("rich.md");
  await expect.poll(names).toEqual(["keep.md", "rich.note.html"]);
  await p.waitForTimeout(300);
  await expect(p.getByTestId("slide-view")).toBeHidden();
});

test("the Note tool (M) makes a note file in the Notes folder, places its card and opens it; Make note files turns a text on a card into one", async ({ app }) => {
  const p = app.page;
  const objs = () => p.evaluate(() => window.__canvastDebug.objects() as unknown as Array<{ id: string; kind: string; assetId?: string; z: number }>);
  // Its name is the pattern of Settings > Notes > New note name.
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Notes", exact: true }).click();
  await p.locator('[data-row="notes.name"] input').fill("Idea {yyyy}");
  await p.locator('[data-row="notes.name"] input').press("Tab");
  await p.getByTestId("view-canvas").click();
  await p.keyboard.press("m");
  await p.mouse.click(420, 260);
  const panel = p.getByTestId("note-panel");
  await expect(panel.locator(".sun-editor-editable h1").first()).toHaveText(/^Idea \d{4}$/);
  await expect(panel.locator(".panel-head h2")).toHaveText(/^Idea \d{4}\.md$/);
  await expect.poll(async () => (await objs()).map((o) => o.kind)).toEqual(["image"]);
  // A text on a card (made before notes were files) becomes a note: the same place and stacking, its words in the file.
  await panel.locator("[data-close]").click();
  await p.keyboard.press("t");
  await p.mouse.click(420, 520);
  await p.keyboard.type("Buy paper");
  await p.keyboard.press("Escape");
  await p.keyboard.press("v");
  const text = (await objs()).find((o) => o.kind === "text")!;
  const tb = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), text.id))!.box;
  await p.mouse.click(Math.round((tb.minX + tb.maxX) / 2), Math.round((tb.minY + tb.maxY) / 2));
  await p.getByRole("button", { name: "Paragraph and box options" }).click();
  await p.locator('.colour-pop [data-card="#ffe58a"]').click();
  await p.keyboard.press("Escape");
  await p.locator('[data-ctx="makenote"]').filter({ visible: true }).click();
  await expect.poll(async () => (await objs()).find((o) => o.id === text.id)?.kind).toBe("image");
  const made = (await objs()).find((o) => o.id === text.id)!;
  expect(made.z).toBe(text.z);
  // Both are in the Notes folder of the library; the converted one is named by its words.
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-side").getByRole("button", { name: /^Notes/ }).click();
  await expect(p.getByTestId("asset-card")).toHaveCount(2);
  await expect(card(p, made.assetId!)).toContainText("Buy paper");
  // Settings > Notes > Note editor on a canvas: Window opens it centred over the canvas; a press beside it closes it.
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Notes", exact: true }).click();
  await p.locator('[data-row="notes.panelMode"] select').selectOption("window");
  await p.getByTestId("view-canvas").click();
  const mb = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), made.id))!.box;
  await p.mouse.dblclick(Math.round((mb.minX + mb.maxX) / 2), Math.round((mb.minY + mb.maxY) / 2));
  const win = p.getByTestId("note-window");
  await expect(win.locator(".sun-editor-editable p").first()).toContainText("Buy paper");
  await expect(p.getByTestId("note-panel")).toBeHidden();
  await p.mouse.click(4, 300);
  await expect(win).toBeHidden();
  // Reset size: a note card goes back to the Note card size (320 px wide), not to its picture's pixels.
  await p.mouse.click(Math.round((mb.minX + mb.maxX) / 2), Math.round((mb.minY + mb.maxY) / 2));
  await p.getByRole("button", { name: /Reset size/ }).click();
  await expect.poll(async () => { const b = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), made.id))!.box; return Math.round(b.maxX - b.minX); }).toBe(320);
  expect(app.consoleErrors).toEqual([]);
});

test("a hidden note open in the Note panel closes when hidden items are no longer shown (Exit hidden mode), its changes kept", async ({ app }) => {
  const p = app.page;
  // Hidden mode: the word in the search, and the password when it is asked (it is not while the hidden items are still open).
  const enter = async (): Promise<void> => {
    await p.getByTestId("assets-search").fill("hidden:");
    await expect(p.getByTestId("hidden-mode-bar").or(p.getByTestId("prompt-input")).filter({ visible: true })).toHaveCount(1);
    if (await p.getByTestId("prompt-input").isVisible()) {
      await p.getByTestId("prompt-input").fill("secret");
      await p.getByTestId("prompt-ok").click();
    }
    await expect(p.getByTestId("hidden-mode-bar")).toBeVisible();
  };
  const NOTE = "# Secret plan\n\nFirst words.\n";
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "secret.md", mimeType: "text/markdown", buffer: Buffer.from(NOTE) });
  await card(p, hashOf(NOTE)).click();
  await p.getByTestId("asset-place").click();
  await p.getByTestId("view-assets").click();
  await card(p, hashOf(NOTE)).click();
  await p.getByTestId("asset-hide").click();
  // A password; hidden mode, kept on outside the library (Stay), with remembering the password off.
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: /Privacy/ }).click();
  await p.getByTestId("hidden-pw-set").click();
  for (let i = 0; i < 2; i++) {
    await p.getByTestId("prompt-input").fill("secret");
    await p.getByTestId("prompt-ok").click();
  }
  await p.getByTestId("view-assets").click();
  await enter();
  await p.getByTestId("hidden-mode-stay").click();
  // On the canvas it opens in the Note panel and is edited, not saved.
  await p.getByTestId("view-canvas").click();
  const placedAt = await p.evaluate(async () => { const d = window.__canvastDebug; return d.objectScreen(d.objects()[0]!.id)!.box; });
  await p.mouse.dblclick((placedAt.minX + placedAt.maxX) / 2, (placedAt.minY + placedAt.maxY) / 2);
  const panel = p.getByTestId("note-panel");
  await expect(panel.locator(".sun-editor-editable h1").first()).toHaveText("Secret plan");
  await panel.locator(".sun-editor-editable p").first().click();
  await p.keyboard.press("End");
  await p.keyboard.type(" More.");
  // Exit hidden mode in the library: the panel is gone (it would let a hidden note be read and written with hidden items locked).
  await p.getByTestId("view-assets").click();
  await p.getByTestId("hidden-mode-exit").click();
  await p.getByTestId("view-canvas").click();
  await expect(panel).toBeHidden();
  // Its changes were saved as it closed: shown again (hidden mode), it has them.
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-search").fill(""); // (the search as it was before hidden mode: the word)
  await enter();
  await card(p, hashOf("# Secret plan\n\nFirst words. More.\n")).dblclick(); // (the saved version's own card: the old one may still be in the list)
  await expect(page(p).locator("p").first()).toContainText("More.");
  expect(app.consoleErrors).toEqual([]);
});
