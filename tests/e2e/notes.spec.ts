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
  // (the YAML lists the tags not written in the words)
  expect(file).toMatch(/^---\ntags:\n  - print\nauthor: Ana\ndescription: The cover plan\nnested:\n  a: 1\n---\n# Cover art/);
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
  // Settings > Notes, Preview length: Short makes a long note's card about a screen long (900 CSS px, drawn at twice that).
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Notes", exact: true }).click();
  await p.locator('[data-row="notes.cardLength"] select').selectOption("short");
  await p.getByTestId("view-assets").click();
  const LONG = `# Long\n\n${"A line of the note.\n\n".repeat(200)}`;
  await p.getByTestId("assets-import-input").setInputFiles({ name: "long.md", mimeType: "text/markdown", buffer: Buffer.from(LONG) });
  await expect.poll(() => p.evaluate((h) => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.hash === h).map((e) => [e.pixelW, e.pixelH])[0]), hashOf(LONG))).toEqual([1200, 1800]);
});

test("a note on a canvas opens in the note panel (a double-click, or Edit note): the same editor, saved in place, the card follows, renamed, undo never returns an old version", async ({ app }) => {
  const p = app.page;
  const NOTE = "# On the canvas\n\nFirst words.\n";
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
  await panel.locator(".sun-editor-editable p").first().click();
  await p.keyboard.press("End");
  await p.keyboard.type(" More words.");
  await p.keyboard.press("Control+s");
  await expect(p.getByTestId("assets-status").or(p.locator(".notice")).first()).toBeAttached();
  // Saved: the card on the canvas is the new version (its item followed it).
  await expect.poll(placed).not.toEqual([hashOf(NOTE)]);
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
  await p.keyboard.press("Control+s");
  // (the picture's size is formatting markdown cannot keep: asked, saved as plain markdown)
  await p.getByTestId("choose-dialog").getByLabel("Save as plain markdown").check();
  await p.getByTestId("choose-dialog").getByRole("button", { name: "Save" }).click();
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

test("the Note tool (M) makes a note file in the Notes folder, places its card and opens it; Make note files turns a text on a card into one", async ({ app }) => {
  const p = app.page;
  const objs = () => p.evaluate(() => window.__canvastDebug.objects() as unknown as Array<{ id: string; kind: string; assetId?: string; z: number }>);
  await p.keyboard.press("m");
  await p.mouse.click(420, 260);
  const panel = p.getByTestId("note-panel");
  await expect(panel.locator(".sun-editor-editable h1").first()).toContainText("Note ");
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
  expect(app.consoleErrors).toEqual([]);
});
