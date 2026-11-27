import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { chooseInMenu, expect, test } from "./harness";
import { makePng } from "./png";

/** The notes editor (src/markdown-editor/) in the library viewer and beside a canvas: markdown and plain text notes, their links to library items. */

const CAT = makePng(4, 4, () => [200, 120, 40, 255]);
const TEMPLATE = "## Sketch log\n\nFrom the library.\n";
const MD = "# Plan\n\nSome **bold** words.\n\n- [ ] a task\n\n![cat](Pictures/cat.png)\n";
const hashOf = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
const card = (p: Page, hash: string) => p.locator(`[data-testid="asset-card"][data-hash="${hash}"]`);
const note = (p: Page) => p.getByTestId("note-editor");
/** The words of the note open in `within` (the library's viewer by default). */
const page = (p: Page, within: Locator = note(p)) => within.locator(".cm-content").first();
/** Its first heading of level `n`, as live mode draws it. */
const heading = (p: Page, n = 1, within?: Locator) => page(p, within).locator(`.cm-line.me-h${n}`).first();
/** Its first line of words that is no heading. */
const words = (p: Page, within?: Locator) => page(p, within).locator(".cm-line:not(.me-h)").filter({ hasText: /\S/ }).first();
/** The note's words as its file keeps them. */
const text = (p: Page) => p.evaluate(() => window.__canvastDebug.notesAsText()[0]?.text ?? "");
/** The cursor at the end of a line. */
const endOf = async (p: Page, line: Locator): Promise<void> => {
  await line.click();
  await p.keyboard.press("End");
};
/** A row of the editor's list (`[[`, `#`, `/`). */
const choice = (p: Page, name: string | RegExp) => p.locator(".cm-tooltip-autocomplete li").filter({ hasText: name }).first();
const downloaded = async (p: Page): Promise<string> => {
  if (!(await p.getByTestId("asset-download").isVisible())) await p.locator(".viewer-details").click(); // (the details panel, if it is closed)
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId("asset-download").click()]);
  return readFile((await dl.path())!, "utf8");
};
/** A paste of this clipboard into the note's words, where the cursor is. */
const paste = (p: Page, plain: string, html = "", within?: Locator) =>
  page(p, within).evaluate((el, [plain, html]) => {
    const dt = new DataTransfer();
    if (html) dt.setData("text/html", html);
    dt.setData("text/plain", plain!);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [plain, html]);
const shows = (p: Page) => page(p).locator(".me-media img").evaluateAll((l) => l.map((i) => (i as HTMLImageElement).naturalWidth > 0));

test("a markdown note opens in live mode with its library links, saves exactly what was typed, takes templates and pictures, and asks before changes are lost", async ({ app }) => {
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

  // Opened in live mode: its heading without its mark, its task box, and its picture shown from the library (the link names it by its path).
  await expect(heading(p)).toHaveText("Plan");
  await expect(page(p).locator(".me-task")).toHaveCount(1);
  await expect(page(p).locator(".me-media img")).toHaveAttribute("src", /^blob:/);
  expect(await text(p), "nothing is rewritten by opening it").toBe(MD);

  // Written to and saved (Ctrl+S): the same item, its file exactly what the editor holds.
  await endOf(p, heading(p));
  await p.keyboard.type(" for today");
  await page(p).locator(".me-task").click(); // (a task box is ticked in the note)
  await p.keyboard.press("Control+s");
  await expect(p.getByTestId("assets-status")).toContainText("Saved “plan.md”");
  expect(await downloaded(p)).toBe(MD.replace("# Plan", "# Plan for today").replace("- [ ]", "- [x]"));
  // Ctrl+S pressed fast, again and again: one save, not a question about another app (it is the same save).
  await endOf(p, heading(p));
  await p.keyboard.type("!");
  for (let i = 0; i < 3; i++) await p.keyboard.press("Control+s");
  await expect.poll(async () => (await downloaded(p)).includes("# Plan for today!")).toBe(true);
  await expect(p.getByTestId("confirm-dialog")).toHaveCount(0);

  // The / menu at a line's start: the built-in templates, then the library's notes tagged `template`.
  for (const name of ["Meeting notes", "Sketch log"]) {
    await page(p).click();
    await p.keyboard.press("Control+End");
    await p.keyboard.press("Enter");
    await p.keyboard.type("/");
    await choice(p, name).click();
    await expect.poll(() => text(p)).toContain(`## ${name}`);
  }
  expect(await text(p)).toMatch(/\*\*Date:\*\* \d{4}-\d\d-\d\d/); // ({{date}} in a template is filled in)

  // The toolbar's Picture: the library chooser (pictures only), the one chosen written as a link by its path and shown.
  await note(p).locator('[data-me="picture"]').click();
  const chooser = p.locator(".lib-pick.is-centred");
  await expect(chooser.locator(".lib-item")).toHaveCount(1);
  await chooser.getByRole("button", { name: "cat.png" }).click();
  await expect.poll(() => text(p)).toMatch(/!\[cat\.png\]\([^)]*cat\.png\)/);
  await page(p).locator(".cm-line").first().click(); // (the cursor off the new picture: it is drawn)
  await expect.poll(() => shows(p)).toEqual([true, true]);

  // A web address pasted over words makes those words the link. (Chromium only: Firefox does not let a test make a paste with its data.)
  if (test.info().project.name !== "firefox") {
    await heading(p).click();
    await p.keyboard.press("End");
    await p.keyboard.press("ArrowLeft"); // (before the `!`)
    for (let i = 0; i < 5; i++) await p.keyboard.press("Shift+ArrowLeft"); // (`today`)
    await paste(p, "https://example.com/brief");
    await expect.poll(() => text(p)).toContain("# Plan for [today](https://example.com/brief)!");
  }

  // Leaving with changes asks first: Don't save lets them go.
  await p.getByTestId("slide-view").locator('[data-act="close"]').click();
  await expect(p.getByTestId("choose-dialog")).toContainText("has changes that are not saved");
  await p.getByTestId("choose-dialog").getByLabel("Don't save").check();
  await p.getByTestId("choose-dialog").getByRole("button", { name: "Go on" }).click();
  await expect(p.getByTestId("slide-view")).toBeHidden();
});

test("New note makes a markdown note in the open folder and opens it to write in; the toolbar's Table puts a table in, whose cells are edited in place", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-menu").click();
  await p.getByRole("menuitem", { name: /New note/ }).click();
  await expect(heading(p)).toHaveText(/^Note \d{4}-\d\d-\d\d \d{6}$/);
  await expect(p.getByTestId("asset-card")).toHaveCount(1);
  await expect(p.getByTestId("asset-backlinks")).toContainText("No notes link here."); // (a note always has the card)
  await page(p).click();
  await p.keyboard.press("Control+End");
  await note(p).locator('[data-me="table"]').click();
  await expect.poll(() => text(p)).toContain("| Column 1 | Column 2 |\n| --- | --- |");
  await expect(page(p).locator(".me-table table th")).toHaveText(["Column 1", "Column 2"]);
  // A cell typed in, Tab to the next: the table's Markdown follows.
  await page(p).locator(".me-table td .me-cell").first().click();
  await p.keyboard.type("Ink");
  await p.keyboard.press("Tab");
  await expect(page(p).locator('.me-table td .me-cell[data-c="1"] .cm-content').first()).toBeFocused();
  await p.keyboard.type("Paper");
  await p.keyboard.press("Escape");
  await expect.poll(() => text(p)).toContain("| Ink | Paper |");
  // A bracket typed over a cell's selected words goes round them, as in the note's text.
  await page(p).locator(".me-table td .me-cell").first().click();
  await p.keyboard.press("Control+a");
  await p.keyboard.type("(");
  await p.keyboard.press("Escape");
  await expect.poll(() => text(p)).toContain("| (Ink) | Paper |");
  // A cell is edited as the note is: Ctrl+B bolds the selected words (never the browser's own key).
  await page(p).locator(".me-table td .me-cell").first().click();
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Control+b");
  await p.keyboard.press("Escape");
  await expect.poll(() => text(p)).toContain("| **(Ink)** | Paper |");
  // Cells dragged across are selected together; Delete empties them.
  const a = (await page(p).locator(".me-table td .me-cell").nth(0).boundingBox())!, b = (await page(p).locator(".me-table td .me-cell").nth(1).boundingBox())!;
  await p.mouse.move(a.x + 4, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await p.mouse.up();
  await expect(page(p).locator(".me-table .me-cell-selected")).toHaveCount(2);
  await p.keyboard.press("Delete");
  await expect.poll(() => text(p)).toContain("| Column 1 | Column 2 |\n| --- | --- |\n|  |  |");
});

test("a note's properties (YAML, as notes apps write them) are its item's tags, note and fields, both ways", async ({ app }) => {
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
  await expect(heading(p)).toHaveText("Cover");
  await expect(page(p)).not.toContainText("author");
  // A tag added in the details goes into the file's YAML (a new version: the same item, its name and place).
  await p.getByTestId("asset-tag-input").fill("print");
  await p.getByTestId("asset-tag-input").press("Enter");
  await expect.poll(async () => (await downloaded(p)).includes("  - print"), { timeout: 20_000 }).toBe(true); // (a new version, through the queue of writes)
  // Saved from the editor: the text changes, the properties stay.
  await endOf(p, heading(p));
  await p.keyboard.type(" art");
  // #tags in the words: typed, or chosen from the library's tags (# offers them); they are the item's tags too.
  await endOf(p, words(p));
  await p.keyboard.type(" #urgent and #des");
  await choice(p, "design").click();
  await p.keyboard.press("Control+s");
  await expect(p.getByTestId("assets-status")).toContainText("Saved “cover.md”");
  const file = await downloaded(p);
  // (the YAML lists the tags not written in the words, and keeps one it had already)
  expect(file).toMatch(/^---\ntags:\n  - design\n  - print\nauthor: Ana\ndescription: The cover plan\nnested:\n  a: 1\n---\n# Cover art/);
  expect(file).toMatch(/Text\. #urgent and #design/);
  await expect.poll(async () => (await entry())?.tags.sort()).toEqual(["design", "print", "urgent"]);
});

test("[[links]] between notes: shown by their words, Ctrl+click opens the note, [[ offers the library's notes and canvases, kept as written", async ({ app }) => {
  const p = app.page;
  const PLAN = "# Plan\n\nSee [[Brief|the brief]].\n";
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles([
    { name: "Plan.md", mimeType: "text/markdown", buffer: Buffer.from(PLAN) },
    { name: "Brief.md", mimeType: "text/markdown", buffer: Buffer.from("# Brief\n") },
  ]);
  await card(p, hashOf(PLAN)).dblclick();
  const link = page(p).locator('.me-wikilink[data-wiki="Brief"]').first();
  await expect(link).toHaveText("the brief");
  // Typed: [[ offers the notes of the library; the one chosen goes in as a link.
  await endOf(p, words(p));
  await p.keyboard.type(" Also [[Bri");
  const list = (await p.locator(".cm-tooltip-autocomplete").boundingBox())!;
  expect(list.x >= 0 && list.x + list.width <= (p.viewportSize()?.width ?? 1280), "the [[ list is inside the window").toBe(true);
  await choice(p, "Brief").click();
  await expect.poll(() => text(p)).toBe("# Plan\n\nSee [[Brief|the brief]]. Also [[Brief]]\n");
  // Resting the pointer on a link shows the preview of what it points at.
  await heading(p).click(); // (the cursor away from the links: they show their words)
  await link.hover();
  await expect(p.locator(".note-link-peek img")).toBeVisible();
  await p.mouse.move(5, 400);
  await p.keyboard.press("Control+s");
  await expect(p.getByTestId("assets-status")).toContainText("Saved “Plan.md”");
  // Ctrl+click opens the note it points at; its details list the notes that link to it.
  await link.click({ modifiers: ["ControlOrMeta"] });
  await expect(heading(p)).toHaveText("Brief");
  if (!(await p.getByTestId("asset-download").isVisible())) await p.locator(".viewer-details").click();
  await expect(p.getByTestId("asset-backlinks")).toContainText("Plan.md");
  await expect(p.getByTestId("asset-backlinks").locator("[data-count]")).toHaveText("1");
  await expect(p.getByTestId("asset-outlinks")).toContainText("links to nothing");
  // Renamed: the links to it follow ([[Brief]] was its name alone).
  await p.evaluate(() => window.__canvastDebug.assetListing().then((l) => window.__canvastDebug.libraryOp("rename", l.entries.find((e) => e.name === "Brief.md")!.hash, "Overview.md")));
  await p.getByTestId("asset-backlinks").getByRole("button", { name: "Plan.md" }).click();
  await expect.poll(async () => (await downloaded(p)).match(/\[\[[^\]]+\]\]/g)).toEqual(["[[Overview|the brief]]", "[[Overview]]"]);
  // [[ offers the canvases too: Ctrl+click opens one.
  await endOf(p, words(p));
  await p.keyboard.type(" [[canvas:Can");
  await choice(p, "Canvas 1").click();
  await heading(p).click();
  await page(p).locator('[data-wiki="canvas:Canvas 1"]').click({ modifiers: ["ControlOrMeta"] });
  await p.getByTestId("choose-dialog").getByRole("button", { name: "Go on" }).click(); // (Save them)
  await expect(p.locator(".asset-inspector")).toBeHidden();
});

test("a note's preview shows the pictures it links to (and an ![[embed]]), on the paper of the Preview look", async ({ app }) => {
  const p = app.page;
  const PIC = makePng(300, 180, (x) => [220, 40 + (x % 60), 30, 255]);
  const NOTE = "# Moodboard\n\n![](pic.png)\n\n![[pic.png]]\n";
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "pic.png", mimeType: "image/png", buffer: PIC });
  await expect(p.getByTestId("asset-card")).toHaveCount(1);
  await p.getByTestId("assets-import-input").setInputFiles({ name: "board.md", mimeType: "text/markdown", buffer: Buffer.from(NOTE) });
  /** A pixel test of a card's picture, run in the page: -1 while it has none. */
  const read = (hash: string, at: "reds" | "corner" | "bottom") =>
    card(p, hash)
      .locator("img")
      .evaluate((img: HTMLImageElement, at) => {
        if (!img.complete || !img.naturalWidth) return -1;
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        if (at === "corner") return g.getImageData(4, 4, 1, 1).data[0]!;
        if (at === "bottom") return g.getImageData(4, c.height - 2, 1, 1).data[0]!;
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i]! > 150 && d[i + 2]! < 90) n++;
        return n;
      }, at);
  // Its library preview has the picture in it: many red pixels (the page itself is near white and grey).
  await expect.poll(() => read(hashOf(NOTE), "reds"), { timeout: 10_000 }).toBeGreaterThan(500);
  // Settings > Notes, Preview look: Dark draws its preview on dark paper at once (Auto, the default, follows the app's theme).
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Notes", exact: true }).click();
  await p.locator('[data-row="notes.look"] select').selectOption("dark");
  await p.getByTestId("view-assets").click();
  await expect.poll(() => read(hashOf(NOTE), "corner"), { timeout: 10_000 }).toBeLessThan(80);
  const LONG = `# Long\n\n${"A line of the note.\n\n".repeat(200)}`;
  await p.getByTestId("assets-import-input").setInputFiles({ name: "long.md", mimeType: "text/markdown", buffer: Buffer.from(LONG) });
  await expect.poll(() => p.evaluate((h) => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.hash === h).map((e) => [e.pixelW, e.pixelH])[0]), hashOf(LONG))).toEqual([1200, 8000]);
  // Two versions alike in length and start (a size changed back) each get a card of their own height (the second took the first's).
  const sized = (px: number) => `<p><span style="font-size: ${px}px;">${"Words that wrap when they are big. ".repeat(6)}</span></p>\n`;
  await p.getByTestId("assets-import-input").setInputFiles([{ name: "big.md", mimeType: "text/markdown", buffer: Buffer.from(sized(66)) }, { name: "small.md", mimeType: "text/markdown", buffer: Buffer.from(sized(16)) }]);
  const tall = (h: string) => p.evaluate((x) => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.hash === x)?.pixelH), h);
  await expect.poll(() => tall(hashOf(sized(16)))).toBe(900);
  expect(await tall(hashOf(sized(66)))).toBeGreaterThan(900);
  // A long note fades out into its own paper: dark on the dark look (it faded to white).
  await expect.poll(() => read(hashOf(LONG), "bottom"), { timeout: 10_000 }).toBeGreaterThanOrEqual(0);
  expect(await read(hashOf(LONG), "bottom")).toBeLessThan(80);
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
  await expect(heading(p, 1, panel)).toHaveText("On the canvas");
  // A dock panel like the others: as wide as its place in the dock whatever it holds, its header the same as theirs.
  const widths = () => panel.evaluate((el) => [Math.round(el.getBoundingClientRect().width), Math.round(el.closest(".dock-item")!.getBoundingClientRect().width)]);
  await expect.poll(async () => { const [a, b] = await widths(); return a === b; }).toBe(true);
  expect(await panel.evaluate((el) => el.classList.contains("layers-panel"))).toBe(true);
  // An editor never folds (a press on its header is no fold), and the panels' header rules stay out of the note's headings (a ## heading is larger than the words).
  await panel.locator(".panel-head h2").click();
  await expect(heading(p, 1, panel)).toBeVisible();
  const size = (l: Locator) => l.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(await size(heading(p, 2, panel).locator(".me-t-h2").first())).toBeGreaterThan(await size(words(p, panel)));
  await endOf(p, words(p, panel));
  await p.keyboard.type(" More words.");
  await p.keyboard.press("Control+s");
  await expect(p.getByTestId("assets-status").or(p.locator(".notice")).first()).toBeAttached();
  // Saved: the card on the canvas is the new version (its item followed it).
  await expect.poll(placed).not.toEqual([hashOf(NOTE)]);
  // The library chooser works in the panel (nothing over it takes the clicks): a picture of the library goes in.
  await panel.locator('[data-me="picture"]').click();
  await p.locator(".lib-pick.is-centred").getByRole("button", { name: "pic.png" }).click();
  await expect.poll(() => text(p)).toMatch(/!\[pic\.png\]\([^)]*pic\.png\)/);
  await p.keyboard.press("Control+s");
  await expect(p.getByTestId("choose-dialog")).toBeHidden();
  await panel.locator("[data-close]").click();
  await expect(panel).toBeHidden();
  // Edit note, in the Actions bar of the selected card, opens it too.
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.locator('[data-ctx="editnote"]').filter({ visible: true }).click();
  await expect(words(p, p.getByTestId("note-panel"))).toContainText("More words.");
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
  await p.mouse.click(5, 450); // (a press outside the note)
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
  await page(p, panel).click();
  await p.keyboard.press("Control+End");
  for (let i = 0; i < 6; i++) await p.keyboard.press("Enter"), await p.keyboard.press("Enter"), await p.keyboard.type("More.");
  await p.keyboard.press("Control+s");
  await expect.poll(async () => (await cardNow()).assetId).not.toBe(hashOf(NOTE));
  await expect.poll(async () => (await cardNow()).pixelH).toBeGreaterThan(before.pixelH);
  expect((await cardNow()).pixelW).toBe(before.pixelW);
  expect(app.consoleErrors).toEqual([]);
});

test("the note keeps what is done at it: Undo and Redo with the focus off its words are the note's, not the canvas's; nothing typed while it saves is lost", async ({ app }) => {
  const p = app.page;
  const NOTE = `# Keys\n\n${"Words on the page.\n\n".repeat(25)}`;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "keys.md", mimeType: "text/markdown", buffer: Buffer.from(NOTE) });
  await card(p, hashOf(NOTE)).click();
  await p.getByTestId("asset-place").click();
  await p.getByTestId("view-canvas").click();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
  const left = () => p.evaluate(async () => { const d = window.__canvastDebug; const o = d.objects()[0]; return o ? d.objectScreen(o.id)!.box.minX : null; });
  // A step on the canvas (the card moved), then the note open beside it.
  const b0 = await p.evaluate(() => { const d = window.__canvastDebug; return d.objectScreen(d.objects()[0]!.id)!.box; });
  await p.mouse.click((b0.minX + b0.maxX) / 2, (b0.minY + b0.maxY) / 2);
  await p.keyboard.press("ArrowRight");
  await expect.poll(left).not.toBe(b0.minX);
  const moved = await left();
  const b1 = await p.evaluate(() => { const d = window.__canvastDebug; return d.objectScreen(d.objects()[0]!.id)!.box; });
  await p.mouse.dblclick((b1.minX + b1.maxX) / 2, (b1.minY + b1.maxY) / 2);
  const panel = p.getByTestId("note-panel");
  await expect(heading(p, 1, panel)).toHaveText("Keys");
  // Typed, then the panel's header pressed: Undo and Redo are the note's.
  await endOf(p, heading(p, 1, panel));
  await p.keyboard.type("!");
  await expect.poll(() => text(p)).toMatch(/^# Keys!/);
  await panel.locator(".panel-head h2").click();
  await p.keyboard.press("Control+z");
  await expect.poll(() => text(p)).toMatch(/^# Keys\n/);
  expect(await left()).toBe(moved);
  await p.keyboard.press("Control+Shift+z");
  await expect.poll(() => text(p)).toMatch(/^# Keys!/);
  expect(await left()).toBe(moved);
  // A press outside: the canvas's keys are the canvas's again.
  await p.mouse.click(5, 450);
  await p.keyboard.press("Control+z");
  await expect.poll(left).not.toBe(moved);
  await p.keyboard.press("Control+Shift+z");
  // Typed while it is being saved: still a change, so leaving asks.
  await endOf(p, heading(p, 1, panel));
  await p.keyboard.press("Control+s");
  await p.keyboard.type("more");
  await expect(heading(p, 1, panel)).toContainText("more");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.some((e) => e.name === "keys.md" && e.hash !== "")))).toBe(true);
  await p.waitForTimeout(600); // (the save has ended)
  await panel.locator("[data-close]").click();
  const ask = p.getByTestId("choose-dialog");
  await expect(ask).toContainText("has changes that are not saved");
  await ask.getByLabel("Save them").check();
  await ask.getByRole("button", { name: "Go on" }).click();
  await expect(panel).toBeHidden();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.filter((e) => e.name === "keys.md").length))).toBe(1);
});

test("live, source and preview: a file is kept exactly as written; source shows its marks, preview draws its page and ticks its tasks; Ctrl+4, 5 and 6 switch", async ({ app }) => {
  const p = app.page;
  const SAME = "# Same\n\nfirst line\nsecond line\n\n==marked== and <kbd>Ctrl</kbd>\n\n> [!note] Title\n> body\n\n```c++ x\nint a;\n\n  int b;\n```\n\n````md\n```x\ny\n```\n````\n\n| a | b |\n| :--- | ---: |\n| *i* **b** | 2 |\n\n[[Foo (bar)]] and [x](obsidian://open?f=1)\n\n- [ ] to do\n";
  const FIXED = "T\n===\n\n* star   list\n\n2 * 3 * 4 ![c](cat%20(2).png)\n\n![[cat (2).png]]\n\n1. a\n\n   para\n\n| a |\n|:--|\n| 1 | 2 |\n";
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles([
    { name: "cat (2).png", mimeType: "image/png", buffer: CAT },
    { name: "same.md", mimeType: "text/markdown", buffer: Buffer.from(SAME) },
    { name: "fixed.md", mimeType: "text/markdown", buffer: Buffer.from(FIXED) },
  ]);
  const close = async (): Promise<void> => {
    await p.getByTestId("slide-view").locator('[data-act="close"]').click();
    await expect(p.getByTestId("slide-view")).toBeHidden();
  };
  await card(p, hashOf(FIXED)).dblclick();
  await expect(heading(p)).toHaveText("T");
  await expect.poll(() => shows(p)).toEqual([true, true]); // (a name with brackets, an embed)
  // Nothing edited: as the file has it. One word edited: only that changes.
  expect(await text(p)).toBe(FIXED);
  await heading(p).click();
  await p.keyboard.press("End");
  await p.keyboard.type("!");
  await expect.poll(() => text(p)).toBe(FIXED.replace("T\n===", "T!\n==="));
  await p.keyboard.press("Control+s");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.name === "fixed.md")?.hash))).not.toBe(hashOf(FIXED));
  await close();
  await card(p, hashOf(SAME)).dblclick();
  await expect(heading(p)).toHaveText("Same");
  expect(await text(p)).toBe(SAME);
  // Source: the marks as written, in the editor's code font.
  await note(p).locator('[data-me="mode:source"]').click();
  await expect(note(p).locator('[data-me="mode:source"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page(p).locator(".cm-line").first()).toHaveText("# Same");
  // Preview: the page drawn, the formats unavailable; a task's box ticks it in the text.
  await note(p).locator('[data-me="mode:preview"]').click();
  const preview = note(p).locator(".me-preview");
  await expect(preview.locator("h1")).toHaveText("Same");
  await expect(preview.locator("table th")).toHaveText(["a", "b"]);
  await expect(preview.locator("mark")).toHaveText("marked");
  await expect(note(p).locator('[data-me="bold"]')).toBeDisabled();
  await preview.locator("input[data-task]").click();
  await expect.poll(() => text(p)).toBe(SAME.replace("- [ ] to do", "- [x] to do"));
  // Ctrl+4 back to live, Ctrl+6 to preview again.
  await p.keyboard.press("Control+4");
  await expect(note(p).locator('[data-me="mode:live"]')).toHaveAttribute("aria-pressed", "true");
  await expect(preview).toBeHidden();
  await p.keyboard.press("Control+6");
  await expect(preview).toBeVisible();
  await p.getByTestId("slide-view").locator('[data-act="close"]').click();
  await p.getByTestId("choose-dialog").getByLabel("Don't save").check();
  await p.getByTestId("choose-dialog").getByRole("button", { name: "Go on" }).click();
  await expect(p.getByTestId("slide-view")).toBeHidden();
});

test("a note copied from another notes app: its source, or the page it drew, shows its pictures; its properties join the note's at the save", async ({ app }) => {
  test.skip(test.info().project.name === "firefox", "Firefox does not let a test make a paste with its data");
  const p = app.page;
  const SOURCE = "---\ntitle: Sample\nstatus: new\ntags:\n  - alpha\n---\n# Sample\n\n| One | Two |\n| --- | --- |\n| ![[Mix (RGB) One.png]] | text |\n";
  const DRAWN = '<pre class="frontmatter language-yaml"><code class="language-yaml"><span class="token key">kind</span>: drawn\n<span class="token key">tags</span>:\n  - beta\n</code></pre><h1>Sample</h1><table><tbody><tr><td><span alt="Mix (RGB) One.png" src="Mix (RGB) One.png" class="internal-embed">Mix (RGB) One.png</span></td><td><img src="app://0abc/some/where/Mix%20(RGB)%20One.png?123"></td></tr></tbody></table>';
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles([{ name: "Mix (RGB) One.png", mimeType: "image/png", buffer: CAT }, { name: "to.md", mimeType: "text/markdown", buffer: Buffer.from("---\nstatus: mine\ntags:\n  - own\n---\n# To\n") }]);
  await p.locator('[data-testid="asset-card"][title="to.md"]').dblclick();
  await expect(heading(p)).toBeVisible();
  const atEnd = async (): Promise<void> => {
    await page(p).click();
    await p.keyboard.press("Control+End");
  };
  await atEnd();
  await paste(p, SOURCE, DRAWN);
  await expect.poll(() => text(p)).toContain("| ![[Mix (RGB) One.png]] | text |");
  expect(await text(p), "its properties are no words of the note").not.toContain("status: new");
  // No source with it (a notes app's reading view): the page it drew, read as Markdown.
  await atEnd();
  await paste(p, "Sample\nOne Two", DRAWN);
  await expect.poll(async () => (await text(p)).match(/!\[\[Mix \(RGB\) One\.png\]\]/g)?.length).toBe(3); // (a name with brackets, written whole)
  expect(await text(p)).not.toContain("kind: drawn");
  await heading(p).click(); // (the cursor off the tables: they are drawn, their pictures shown)
  await expect.poll(() => page(p).locator(".me-table img").evaluateAll((l) => l.map((i) => (i as HTMLImageElement).naturalWidth > 0))).toEqual([true, true, true]);
  // The save: what the note says stays, what it did not say is added, tags join; the library reads them from the file.
  await p.keyboard.press("Control+s");
  const entry = () => p.evaluate(async () => (await window.__canvastDebug.assetListing()).entries.find((x) => x.name === "to.md")!);
  await expect.poll(async () => (await entry()).fields?.find((f) => f.key === "kind")?.value).toBe("drawn");
  const e = await entry();
  const field = (k: string) => e.fields?.find((f) => f.key === k)?.value;
  expect(field("status")).toBe("mine");
  expect(field("title")).toBe("Sample");
  for (const t of ["own", "alpha", "beta"]) expect(e.tags).toContain(t);
  // Undone, what was pasted leaves its properties out of the next save.
  await atEnd();
  await paste(p, "---\nundone: yes\n---\nWords pasted and undone\n");
  await expect.poll(() => text(p)).toContain("Words pasted and undone");
  await p.keyboard.press("Control+z");
  await expect.poll(() => text(p)).not.toContain("Words pasted and undone");
  await p.keyboard.type(" more");
  await p.keyboard.press("Control+s");
  await expect.poll(async () => (await entry()).hash).not.toBe(e.hash);
  await expect.poll(async () => (await entry()).fields?.find((f) => f.key === "status")?.value).toBe("mine");
  expect((await entry()).fields?.find((f) => f.key === "undone")).toBeUndefined();
});

test("copying the whole note takes its properties, as the file's YAML; a part is copied as it is written; Copy in the library too", async ({ app, browserName }) => {
  test.skip(browserName === "firefox", "Firefox does not let a test give a copy its data, or read the clipboard");
  const p = app.page;
  const FILE = '---\ntitle: "Sample"\ncast:\n  - "Smith, John"\n---\n# Words\n\nMore **words**\n\n- one\n- two\n';
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "c.md", mimeType: "text/markdown", buffer: Buffer.from(FILE) });
  await p.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await p.locator('[data-testid="asset-card"][title="c.md"]').click({ button: "right" });
  await p.getByRole("menu", { name: "Library actions" }).getByRole("menuitem", { name: "Copy", exact: true }).click();
  await expect.poll(() => p.evaluate(() => navigator.clipboard.readText())).toBe(FILE);
  await p.locator('[data-testid="asset-card"][title="c.md"]').dblclick();
  await expect(heading(p)).toBeVisible();
  await heading(p).click();
  await p.keyboard.press("Control+a");
  await p.evaluate(() => navigator.clipboard.writeText(""));
  await p.keyboard.press("Control+c");
  await expect.poll(() => p.evaluate(() => navigator.clipboard.readText())).toBe(FILE);
  // A part: as written, a heading with its mark, list items with theirs.
  await heading(p).click();
  await p.keyboard.press("Home");
  await p.keyboard.press("Shift+End");
  await p.keyboard.press("Control+c");
  await expect.poll(() => p.evaluate(() => navigator.clipboard.readText())).toBe("# Words");
  await page(p).click();
  await p.keyboard.press("Control+End");
  await p.keyboard.press("Shift+ArrowUp");
  await p.keyboard.press("Shift+ArrowUp");
  await p.keyboard.press("Shift+Home");
  await p.keyboard.press("Control+c");
  await expect.poll(() => p.evaluate(() => navigator.clipboard.readText())).toBe("- one\n- two\n");
});

test("a note's created and modified are automatic: a save writes them, under the names and in the format of the settings, and the panel does not edit them", async ({ app }) => {
  const p = app.page;
  await p.evaluate(() => window.__canvastDebug.setSetting("notes.autoDates", true));
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "d.md", mimeType: "text/markdown", buffer: Buffer.from("---\ncreated: 2000-01-02T03:04\nmodified: 2000-01-02T03:04\n---\n# Dated\n") });
  await p.locator('[data-testid="asset-card"][title="d.md"]').dblclick();
  await expect(heading(p)).toBeVisible();
  const saved = () => p.evaluate(async () => (await window.__canvastDebug.assetListing()).entries.find((x) => x.name === "d.md")!.fields ?? []);
  await endOf(p, heading(p));
  await p.keyboard.type("x");
  await p.keyboard.press("Control+s");
  await expect.poll(async () => (await saved()).find((f) => f.key === "modified")?.value).toMatch(/^20[2-9]\d-\d\d-\d\dT\d\d:\d\d$/);
  expect((await saved()).find((f) => f.key === "created")?.value, "created stays").toBe("2000-01-02T03:04");
  // In the panel: read only, no remove.
  await expect(p.getByLabel("Value of modified")).toHaveAttribute("readonly");
  await expect(p.getByRole("button", { name: "Remove the property modified" })).toHaveCount(0);
  // Their own names and format: a note with none shows them, and has them after a save.
  await p.evaluate(() => {
    const d = window.__canvastDebug;
    d.setSetting("notes.createdKey", "created-on");
    d.setSetting("notes.modifiedKey", "updated");
    d.setSetting("notes.dateFormat", "DD/MM/YYYY [at] HH:mm");
  });
  await expect(p.getByLabel("Value of updated")).toHaveAttribute("placeholder", "Set at the next save");
  await endOf(p, heading(p));
  await p.keyboard.type("y");
  await p.keyboard.press("Control+s");
  await expect.poll(async () => (await saved()).find((f) => f.key === "updated")?.value).toMatch(/^\d\d\/\d\d\/20[2-9]\d at \d\d:\d\d$/);
  await expect.poll(async () => (await saved()).find((f) => f.key === "created-on")?.value).toMatch(/^\d\d\/\d\d\/20[2-9]\d at /);
  expect(await text(p)).toContain("# Dated");
  // The title follows the first heading, read only.
  await p.evaluate(() => window.__canvastDebug.setSetting("notes.titleFrom", "h1"));
  await expect(p.getByLabel("Value of title")).toHaveAttribute("readonly");
  await endOf(p, heading(p));
  await p.keyboard.type(": z");
  await p.keyboard.press("Control+s");
  await expect.poll(async () => (await saved()).find((f) => f.key === "title")?.value).toBe("Datedxy: z");
  // Rename notes on save: off, the name stays (above). On: from the heading, as written but for what a file cannot hold; then clean. A rename keeps the note's text.
  const named = () => p.evaluate(async () => (await window.__canvastDebug.assetListing()).entries.map((e) => e.name));
  expect(await named()).toEqual(["d.md"]);
  await p.evaluate(() => window.__canvastDebug.setSetting("notes.renameOnSave", true));
  expect(await named(), "turned on: nothing until a save").toEqual(["d.md"]);
  await heading(p).click();
  await p.keyboard.press("Control+s");
  await expect.poll(named).toEqual(["Datedxy- z.md"]);
  await p.evaluate(() => window.__canvastDebug.setSetting("notes.nameStyle", "clean"));
  await endOf(p, heading(p));
  await p.keyboard.type("!");
  await p.keyboard.press("Control+s");
  await expect.poll(named).toEqual(["datedxy-z.md"]);
  expect(await text(p)).toContain("Datedxy: z!");
});

test("Copy, by kind of file: words of notes, joined when several; only a name where that is all there can be; a note card on a canvas is its note, and pastes back as the card", async ({ app, browserName }) => {
  test.skip(browserName === "firefox", "Firefox does not let a test read the clipboard");
  const p = app.page;
  await p.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await p.getByTestId("view-assets").click();
  const FILE = "---\nstatus: new\n---\n# One\n";
  await p.getByTestId("assets-import-input").setInputFiles([
    { name: "one.md", mimeType: "text/markdown", buffer: Buffer.from(FILE) },
    { name: "two.txt", mimeType: "text/plain", buffer: Buffer.from("Two words") },
    { name: "four.zip", mimeType: "application/zip", buffer: Buffer.from("PK") },
  ]);
  const card = (n: string) => p.locator(`[data-testid="asset-card"][title="${n}"]`);
  await expect(card("four.zip")).toBeAttached();
  const clip = () => p.evaluate(() => navigator.clipboard.readText());
  const copy = async (n: string) => {
    await p.evaluate(() => navigator.clipboard.writeText(""));
    await card(n).click();
    await p.keyboard.press("Control+c");
  };
  await copy("one.md");
  await expect.poll(clip).toBe(FILE);
  await copy("two.txt");
  await expect.poll(clip).toBe("Two words");
  await copy("four.zip");
  await expect.poll(clip).toBe("four.zip");
  await p.evaluate(() => navigator.clipboard.writeText(""));
  await card("one.md").click();
  await card("two.txt").click({ modifiers: ["Control"] });
  await p.keyboard.press("Control+c");
  await expect.poll(clip).toContain("# One");
  expect(await clip()).toContain("Two words");
  // On a canvas.
  await card("one.md").click();
  await p.getByTestId("asset-place").click();
  await p.getByTestId("view-canvas").click();
  const objects = () => p.evaluate(() => window.__canvastDebug.objects().length);
  await expect.poll(objects).toBe(1);
  await p.keyboard.press("Control+a");
  await p.evaluate(() => navigator.clipboard.writeText(""));
  await p.keyboard.press("Control+c");
  await expect.poll(clip).toBe(FILE);
  await p.keyboard.press("Control+v");
  await expect.poll(objects).toBe(2);
});

test("Note cards show properties: a card shows the note's chosen properties, at once", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "b.md", mimeType: "text/markdown", buffer: Buffer.from("---\nstatus: done\n---\n# Words\n") });
  await p.locator('[data-testid="asset-card"][title="b.md"]').click();
  await p.getByTestId("asset-place").click();
  await p.getByTestId("view-canvas").click();
  const tall = () => p.evaluate(() => (window.__canvastDebug.objects().at(-1) as unknown as { pixelH: number }).pixelH);
  await expect.poll(tall).toBeGreaterThan(0);
  await p.waitForTimeout(400);
  const plain = await tall();
  await p.evaluate(() => window.__canvastDebug.setSetting("notes.cardProps", "Status, nothing"));
  await expect.poll(tall, "the label takes a line of the page").toBeGreaterThan(plain);
  await p.evaluate(() => window.__canvastDebug.setSetting("notes.cardProps", ""));
  await expect.poll(tall).toBe(plain);
  // A property only the library has (not written into the file): the card shows it too, as soon as it changes.
  await p.evaluate(() => window.__canvastDebug.setSetting("notes.cardProps", "reviewer"));
  await p.waitForTimeout(400);
  expect(await tall(), "nothing to show yet").toBe(plain);
  await p.getByTestId("view-assets").click();
  await p.locator('[data-testid="asset-card"][title="b.md"]').click();
  await p.getByTestId("asset-field-add").click();
  await p.locator(".field-key").last().fill("reviewer");
  await p.locator(".field-value").last().fill("Ana");
  await p.locator(".field-value").last().blur();
  await p.getByTestId("view-canvas").click();
  await expect.poll(tall, "its label takes a line of the page").toBeGreaterThan(plain);
});

test("Settings > Notes: Save notes on close saves without asking; Notes open in sets the mode; the / menu offers blocks at a line's start, never inside a word", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Notes", exact: true }).click();
  await p.locator('[data-set="notes.saveOnClose"]').click({ force: true });
  await p.locator('[data-row="notes.editorMode"] select').selectOption("source");
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "keep.md", mimeType: "text/markdown", buffer: Buffer.from("# Keep\n\nWords.\n") });
  await p.locator('[data-testid="asset-card"][title="keep.md"]').dblclick();
  await expect(note(p).locator('[data-me="mode:source"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page(p).locator(".cm-line").first()).toHaveText("# Keep");
  // The / menu: at a line's start it offers blocks; inside a word it stays away.
  await page(p).click();
  await p.keyboard.press("Control+End");
  await p.keyboard.type("/Head");
  await choice(p, "Heading 2").click();
  await p.keyboard.type("and/or");
  await p.waitForTimeout(300);
  await expect(p.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
  await expect.poll(() => text(p)).toBe("# Keep\n\nWords.\n## and/or");
  // Closed with a change: saved, nothing asked.
  await p.getByTestId("slide-view").locator('[data-act="close"]').click();
  await expect(p.getByTestId("slide-view")).toBeHidden();
  await expect(p.getByTestId("choose-dialog")).toHaveCount(0);
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.assetListing().then((l) => l.entries.find((e) => e.name === "keep.md")?.hash))).not.toBe(hashOf("# Keep\n\nWords.\n"));
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
  await expect(heading(p, 1, panel)).toHaveText(/^(# )?Idea \d{4}$/); // (opened to write in: its line may show its mark)
  await expect(panel.locator(".panel-head h2")).toHaveText(/^Idea \d{4}\.md$/);
  await expect.poll(async () => (await objs()).map((o) => o.kind)).toEqual(["image"]);
  // A text on a card (made before notes were files) becomes a note: the same place and stacking, its words in the file.
  await panel.locator("[data-close]").click();
  await p.keyboard.press("t");
  await p.mouse.click(420, 520);
  await p.keyboard.type("Buy paper");
  await p.keyboard.press("Escape");
  await p.keyboard.press("v");
  const made0 = (await objs()).find((o) => o.kind === "text")!;
  const tb = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), made0.id))!.box;
  await p.mouse.click(Math.round((tb.minX + tb.maxX) / 2), Math.round((tb.minY + tb.maxY) / 2));
  await p.getByRole("button", { name: "Paragraph and box options" }).click();
  await p.locator('.colour-pop [data-card="#ffe58a"]').click();
  await p.keyboard.press("Escape");
  await p.locator('[data-ctx="makenote"]').filter({ visible: true }).click();
  await expect.poll(async () => (await objs()).find((o) => o.id === made0.id)?.kind).toBe("image");
  const made = (await objs()).find((o) => o.id === made0.id)!;
  expect(made.z).toBe(made0.z);
  // Both are in the Notes folder of the library; the converted one is named by its words.
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-side").getByRole("button", { name: /^Notes/ }).click();
  await expect(p.getByTestId("asset-card")).toHaveCount(2);
  await expect(card(p, made.assetId!)).toContainText("Buy paper");
  // Settings > Notes > Files on a canvas: Window opens it centred over the canvas; a press beside it closes it.
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Notes", exact: true }).click();
  await p.locator('[data-row="notes.panelMode"] select').selectOption("window");
  await p.getByTestId("view-canvas").click();
  const mb = (await p.evaluate((i) => window.__canvastDebug.objectScreen(i), made.id))!.box;
  await p.mouse.dblclick(Math.round((mb.minX + mb.maxX) / 2), Math.round((mb.minY + mb.maxY) / 2));
  const win = p.getByTestId("note-window");
  await expect(page(p, win)).toContainText("Buy paper");
  await expect(p.getByTestId("note-panel")).toBeHidden();
  await p.mouse.click(4, 300);
  await expect(win).toBeHidden();
  // Reset size: a note card goes back to the Note card size (320 px wide), not to its picture's pixels.
  await p.mouse.click(Math.round((mb.minX + mb.maxX) / 2), Math.round((mb.minY + mb.maxY) / 2));
  await chooseInMenu(p, "sizemenu", "size:reset");
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
  await expect(heading(p, 1, panel)).toHaveText("Secret plan");
  await endOf(p, words(p, panel));
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
  await expect(words(p)).toContainText("More.");
  expect(app.consoleErrors).toEqual([]);
});

test("a data file opens as plain text: its spaces, tabs and line ends come back exactly, and one not in UTF-8 stays a file", async ({ app }) => {
  const p = app.page;
  const JSON_TEXT = '{\n  "a": [\n    1,\n\t\t2\n  ],\n  "b":   "x  y",\n\n    "c": "<&>"\n}\n';
  const YAML_TEXT = "a:\r\n  b: 1\r\n";
  const LATIN = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles([
    { name: "data.json", mimeType: "application/json", buffer: Buffer.from(JSON_TEXT) },
    { name: "conf.yaml", mimeType: "text/yaml", buffer: Buffer.from(YAML_TEXT) },
    { name: "old.log", mimeType: "text/plain", buffer: LATIN },
  ]);
  const back = () => p.locator(".viewer-back").click();
  await card(p, hashOf(JSON_TEXT)).dblclick();
  await expect(page(p)).toContainText('"b"');
  await expect(note(p).locator('[data-me="mode:live"]'), "plain text has no modes").toHaveCount(0);
  await expect.poll(() => text(p)).toBe(JSON_TEXT);
  await page(p).click();
  await p.keyboard.press("Control+End");
  await p.keyboard.type("z");
  await expect.poll(() => text(p)).toBe(`${JSON_TEXT}z`);
  await p.keyboard.press("Backspace");
  await expect.poll(() => text(p)).toBe(JSON_TEXT);
  // The viewer's zoom control and keys are the note's too: its words are drawn bigger, its file stays.
  const pct = p.locator(".viewer-zoom-pct");
  const zoomed = () => page(p).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const base = await zoomed();
  await expect(pct).toHaveText("100%");
  await p.locator('.viewer-zoom [data-zoom="in"]').click();
  await expect(pct).toHaveText("125%");
  expect(await zoomed()).toBeCloseTo(base * 1.25, 1);
  await page(p).click();
  await p.keyboard.press("Control+-");
  await expect(pct).toHaveText("100%");
  expect(await zoomed()).toBeCloseTo(base, 1);
  await expect.poll(() => text(p)).toBe(JSON_TEXT);
  await back();
  await card(p, hashOf(YAML_TEXT)).dblclick();
  await expect.poll(() => text(p)).toBe(YAML_TEXT);
  await back();
  await card(p, hashOf(LATIN)).dblclick();
  await expect(p.locator(".assets-body.is-viewing")).toBeVisible();
  await expect(page(p)).toBeHidden();
});

test("a note's Links card lists what it links to, pictures too, and links that find nothing; a link and the rows open them", async ({ app }) => {
  const p = app.page;
  const NOTE = "# Note\n\nSee [[Other]], [[Gone]] and ![cat](cat.png).\n";
  const OTHER = "# Other\n";
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles([
    { name: "cat.png", mimeType: "image/png", buffer: CAT },
    { name: "Note.md", mimeType: "text/markdown", buffer: Buffer.from(NOTE) },
    { name: "Other.md", mimeType: "text/markdown", buffer: Buffer.from(OTHER) },
  ]);
  await card(p, hashOf(NOTE)).dblclick();
  await expect(heading(p)).toHaveText("Note");
  if (!(await p.getByTestId("asset-download").isVisible())) await p.locator(".viewer-details").click();
  const out = p.getByTestId("asset-outlinks");
  await expect(out.locator("[data-count]")).toHaveText("3");
  await expect(out.getByRole("button", { name: "Other.md" })).toBeVisible();
  await expect(out.getByRole("button", { name: "cat.png" })).toBeVisible();
  await expect(out.locator(".asset-link-missing")).toHaveText("Gone");
  // The link goes where it points (Ctrl+click).
  await page(p).locator('[data-wiki="Other"]').click({ modifiers: ["ControlOrMeta"] });
  await expect(heading(p)).toHaveText("Other");
  await expect(p.getByTestId("asset-backlinks").getByRole("button", { name: "Note.md" })).toBeVisible();
  // Back by the card, which is there each time.
  await p.getByTestId("asset-backlinks").getByRole("button", { name: "Note.md" }).click();
  await expect(heading(p)).toHaveText("Note");
  await expect(p.getByTestId("asset-backlinks")).toContainText("No notes link here.");
  await expect(out.locator("[data-count]")).toHaveText("3");
  expect(app.consoleErrors).toEqual([]);
});

test("Ctrl+F in an open note finds in that note with the focus off its words, in the library's viewer and beside a canvas", async ({ app }) => {
  const p = app.page;
  const NOTE = `# Find here\n\n${"Some words of the page.\n\n".repeat(30)}`;
  const inFind = () => p.evaluate(() => !!document.activeElement?.closest(".cm-search"));
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "find.md", mimeType: "text/markdown", buffer: Buffer.from(NOTE) });
  await card(p, hashOf(NOTE)).dblclick();
  await expect(heading(p)).toHaveText("Find here");
  await p.locator(".viewer-details").click();
  await p.keyboard.press("Control+f");
  await expect.poll(inFind).toBe(true);
  await expect(p.locator(".assets-body.is-viewing")).toBeVisible();
  await p.locator(".viewer-details").click(); // (back on: Place is in the details)
  await p.locator(".viewer-back").click();
  await card(p, hashOf(NOTE)).click();
  await p.getByTestId("asset-place").click();
  await p.getByTestId("view-canvas").click();
  const box = (await p.locator("canvas").first().boundingBox())!;
  await p.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const panel = p.getByTestId("note-panel");
  await expect(heading(p, 1, panel)).toHaveText("Find here");
  await panel.locator("header").first().click();
  await p.keyboard.press("Control+f");
  await expect.poll(inFind).toBe(true);
});

test("selected words: a sign typed over them goes round them as Markdown marks; Ctrl+B and Ctrl+I wrap and unwrap, or make an empty pair to type in", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "signs.md", mimeType: "text/markdown", buffer: Buffer.from("first\n\nsecond\n\nthird\n\nfourth word here\n") });
  await p.locator('[data-testid="asset-card"][title="signs.md"]').dblclick();
  const line = (n: number) => page(p).locator(".cm-line").filter({ hasText: /\S/ }).nth(n);
  const select = async (n: number): Promise<void> => {
    await line(n).click();
    await p.keyboard.press("End");
    await p.keyboard.press("Shift+Home");
  };
  await expect(line(2)).toHaveText("third");
  await select(0);
  await p.keyboard.type('"');
  await p.keyboard.type("(");
  await expect.poll(() => text(p), "the word stays selected: another goes round it").toMatch(/^"\(first\)"\n/);
  await select(1);
  await p.keyboard.type("*");
  await p.keyboard.type("*");
  await expect.poll(() => text(p), "twice: bold").toContain("\n**second**\n");
  await select(2);
  await p.keyboard.type("`");
  await expect.poll(() => text(p)).toContain("\n`third`\n");
  // Ctrl+B over selected words: marks round them, and off again. With nothing selected: an empty pair, the cursor in it; at its closing
  // mark, Ctrl+I steps out.
  await select(3);
  await p.keyboard.press("Control+b");
  await expect.poll(() => text(p)).toContain("\n**fourth word here**");
  await p.keyboard.press("Control+b");
  await expect.poll(() => text(p)).toContain("\nfourth word here");
  // With the cursor inside a word: the word takes the format, the cursor staying where it was; inside the format, it comes off.
  await p.keyboard.press("Home");
  await p.keyboard.press("ArrowRight");
  await p.keyboard.press("ArrowRight");
  await p.keyboard.press("Control+b");
  await p.keyboard.type("X");
  await expect.poll(() => text(p), "the cursor is where it was").toContain("**foXurth** word here");
  await p.keyboard.press("Control+b");
  await expect.poll(() => text(p)).toContain("\nfoXurth word here");
  await p.keyboard.press("Backspace");
  await p.keyboard.press("End");
  await p.keyboard.type(" ");
  await p.keyboard.press("Control+i");
  await p.keyboard.type("x");
  await p.keyboard.press("Control+i");
  await p.keyboard.type(" y");
  await expect.poll(() => text(p)).toContain("fourth word here *x* y");
  expect(app.consoleErrors).toEqual([]);
});

test("a code block with a language is coloured over its words, and the note is as it was", async ({ app }) => {
  const p = app.page;
  const FILE = "```python\ndef f():\n    return 'x'\n```\n";
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "code.md", mimeType: "text/markdown", buffer: Buffer.from(FILE) });
  await p.locator('[data-testid="asset-card"][title="code.md"]').dblclick();
  await expect(page(p)).toContainText("return");
  const seen = (group: string) => page(p).locator(`.me-tok-${group}`).allTextContents();
  await expect.poll(() => seen("keyword")).toEqual(["def", "return"]);
  expect(await seen("string")).toEqual(["'x'"]);
  expect(await text(p), "nothing added to the note").toBe(FILE);
  // Typing changes them.
  await page(p).locator(".cm-line", { hasText: "return" }).click();
  await p.keyboard.press("End");
  await p.keyboard.type(" import os");
  await expect.poll(() => seen("keyword")).toContain("import");
  expect(app.consoleErrors).toEqual([]);
});

test("in the library's viewer the arrows go to the next note unless the cursor is in the words", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles([{ name: "one.md", mimeType: "text/markdown", buffer: Buffer.from("# One\n") }, { name: "two.md", mimeType: "text/markdown", buffer: Buffer.from("# Two\n") }]);
  await p.locator('[data-testid="asset-card"][title="one.md"]').dblclick();
  await expect(heading(p)).toHaveText("One");
  // The cursor in the words: the arrow moves the cursor, and the note stays.
  await heading(p).click();
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(300);
  await expect(heading(p)).toContainText("One");
  // Off the words: the arrow is the viewer's.
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // (the focus on nothing)
  await p.keyboard.press("ArrowRight");
  await expect(heading(p)).toHaveText("Two");
  await p.keyboard.press("ArrowLeft");
  await expect(heading(p)).toHaveText("One");
  // On a button of the note's toolbar: still the viewer's.
  await note(p).locator('[data-me="bold"]').focus();
  await p.keyboard.press("ArrowRight");
  await expect(heading(p)).toHaveText("Two");
  // Escape in the words closes the viewer, as it does for a picture: the note stays selected, its details shown.
  await heading(p).click();
  await p.keyboard.press("Escape");
  await expect(p.getByTestId("slide-view")).toBeHidden();
  await expect(p.getByTestId("asset-inspector")).toContainText("two.md");
  expect(app.consoleErrors).toEqual([]);
});

test("Escape closes a note open on a canvas, in the panel and in the window: the first one right after it opens, from its words, and from the canvas with nothing selected; the editor's open list closes first", async ({ app }) => {
  const p = app.page;
  await p.evaluate(() => window.__canvastDebug.setSetting("notes.saveOnClose", true)); // (a change is saved on close, not asked about)
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "esc.md", mimeType: "text/markdown", buffer: Buffer.from("# Esc\n\nWords.\n") });
  await p.locator('[data-testid="asset-card"][title="esc.md"]').click();
  await p.getByTestId("asset-place").click();
  await p.getByTestId("view-canvas").click();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
  await p.waitForTimeout(300);
  const at = await p.evaluate(() => { const d = window.__canvastDebug; return d.objectScreen(d.objects()[0]!.id)!.box; });
  const open = async (host: "note-panel" | "note-window") => {
    await p.evaluate(() => window.__canvastDebug.select([]));
    await p.mouse.dblclick((at.minX + at.maxX) / 2, (at.minY + at.maxY) / 2);
    await expect(page(p, p.getByTestId(host))).toBeVisible();
    await p.evaluate(() => document.querySelectorAll<HTMLElement>("[data-escape]").forEach((x) => delete x.dataset["escape"])); // (what the last Escape did, forgotten)
  };
  const said = () => p.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-escape]")].map((x) => x.dataset["escape"]).join(", ") || "no Escape heard");
  for (const mode of ["panel", "window"] as const) {
    const host = mode === "panel" ? "note-panel" : "note-window";
    await p.evaluate((m) => window.__canvastDebug.setSetting("notes.panelMode", m), mode);
    // the first Escape right after it opens (double-clicked on its card, nothing else pressed)
    await open(host);
    await p.keyboard.press("Escape");
    await expect(p.getByTestId(host), `${mode}: the first Escape after opening (${await said()})`).toBeHidden();
    // from the words
    await open(host);
    await words(p, p.getByTestId(host)).click();
    await p.keyboard.press("Escape");
    await expect(p.getByTestId(host), `${mode}: Escape in the words`).toBeHidden();
    if (mode === "window") continue; // (the window covers the canvas: its own Escape is the one above)
    // from the canvas, with nothing selected
    await open(host);
    await p.mouse.click(400, 680); // (empty canvas, clear of the tools and the dev panel)
    await p.evaluate(() => window.__canvastDebug.select([]));
    await p.keyboard.press("Escape");
    await expect(p.getByTestId(host), `${mode}: Escape on the canvas (${await said()})`).toBeHidden();
  }
  // The editor's list open: the first Escape closes it, the note stays; the next closes the note.
  await p.evaluate(() => window.__canvastDebug.setSetting("notes.panelMode", "panel"));
  await open("note-panel");
  await endOf(p, words(p, p.getByTestId("note-panel")));
  await p.keyboard.press("Enter");
  await p.keyboard.type("/");
  await expect(p.locator(".cm-tooltip-autocomplete")).toBeVisible();
  await p.keyboard.press("Escape");
  await expect(p.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
  await expect(p.getByTestId("note-panel")).toBeVisible();
  await p.keyboard.press("Escape");
  await expect(p.getByTestId("note-panel")).toBeHidden();
});

test("lists as notes apps write them: Enter adds the next item right below, numbers follow a moved line, Ctrl+L makes and ticks a task, Alt+Up moves a line", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "lists.md", mimeType: "text/markdown", buffer: Buffer.from("# Lists\n\n1. one\n\n2. two\n3. three\n\nplain\n") });
  await p.locator('[data-testid="asset-card"][title="lists.md"]').dblclick();
  await expect(heading(p)).toBeVisible();
  // (a loose list: Enter still opens the next item without a blank line)
  await page(p).locator(".cm-line", { hasText: "three" }).click();
  await p.keyboard.press("End");
  await p.keyboard.press("Enter");
  await p.keyboard.type("four");
  await expect.poll(() => text(p)).toContain("3. three\n4. four\n");
  // Alt+Up: the line moves up, and the numbers follow it.
  await p.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => text(p)).toContain("2. two\n3. four\n4. three\n");
  // Ctrl+L: a plain line becomes a task, then is ticked.
  await page(p).locator(".cm-line", { hasText: "plain" }).click();
  await p.keyboard.press("Control+l");
  await expect.poll(() => text(p)).toContain("- [ ] plain");
  await p.keyboard.press("Control+l");
  await expect.poll(() => text(p)).toContain("- [x] plain");
});

test("callouts are cards (typed with [! and its list), a heading folds what is under it, and a table cell's menu acts on its row and column", async ({ app }) => {
  const p = app.page;
  const FILE = "# Folds\n\nUnder the heading.\n\n> [!warning] Mind\n> the step\n\n| a | b |\n| --- | --- |\n| 2 | x |\n| 1 | y |\n";
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "folds.md", mimeType: "text/markdown", buffer: Buffer.from(FILE) });
  await p.locator('[data-testid="asset-card"][title="folds.md"]').dblclick();
  await expect(page(p).locator(".me-callout-warning.me-callout-head")).toContainText("Mind");
  // Sort by the first column from a cell's menu.
  await page(p).locator(".me-table td .me-cell").first().click({ button: "right" });
  await p.locator(".me-pop .me-pop-item", { hasText: "Sort column (A → Z)" }).click();
  await expect.poll(() => text(p)).toContain("| 1 | y |\n| 2 | x |");
  // The sort is a step of the note's undo, also from a cell (the cell's own typing is undone first).
  await page(p).locator(".me-table td .me-cell").first().click();
  await p.keyboard.press("Control+z");
  await expect.poll(() => text(p)).toContain("| 2 | x |\n| 1 | y |");
  await p.keyboard.press("Escape");
  // A new callout: `[!` in a quote offers the types.
  await page(p).click();
  await p.keyboard.press("Control+End");
  await p.keyboard.type("> [!");
  await choice(p, "Tip").click();
  await expect.poll(() => text(p)).toMatch(/> \[!tip\] $/);
  // The heading's arrow folds everything under it.
  await heading(p).hover();
  await page(p).locator(".me-foldable .me-fold").first().dispatchEvent("mousedown");
  await expect(page(p).locator(".cm-foldPlaceholder")).toHaveCount(1);
  await expect(page(p).locator(".cm-line", { hasText: "Under the heading." })).toHaveCount(0);
});

test("the right-click menu highlights in colours; the link popover opens a linked note to write in; math and diagrams are drawn", async ({ app }) => {
  test.skip(test.info().project.name !== "chromium", "one browser is enough for what the libraries draw");
  const p = app.page;
  const OTHER = "# Other\n\nIts words.\n";
  const NOTE = "# Note\n\nSee [[Other]] here.\n\nArea $a^2$ found.\n\n```mermaid\ngraph TD; A-->B\n```\n\nlast\n";
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles([{ name: "Other.md", mimeType: "text/markdown", buffer: Buffer.from(OTHER) }, { name: "Note.md", mimeType: "text/markdown", buffer: Buffer.from(NOTE) }]);
  await card(p, hashOf(NOTE)).dblclick();
  await expect(page(p).locator(".me-math .katex")).toHaveCount(1);
  await expect(page(p).locator(".me-diagram svg")).toHaveCount(1, { timeout: 20_000 });
  // The popover: the pointer resting on the link opens the note; what is typed there is saved into that note.
  await page(p).locator('[data-wiki="Other"]').hover();
  const pop = p.locator(".me-link-pop");
  await expect(pop.locator(".me-link-pop-title")).toHaveText("Other");
  await pop.locator(".cm-content").click();
  await p.keyboard.press("Control+End");
  await p.keyboard.type(" More.");
  await expect.poll(() => p.evaluate(async () => (await window.__canvastDebug.assetListing()).entries.find((e) => e.name === "Other.md")!.hash), { timeout: 10_000 }).not.toBe(hashOf(OTHER));
  await p.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  // Right click on selected words: Highlight: Red.
  await page(p).locator(".cm-line", { hasText: "last" }).click();
  await p.keyboard.press("End");
  await p.keyboard.press("Shift+Home");
  const line = (await page(p).locator(".cm-line", { hasText: "last" }).boundingBox())!;
  await p.mouse.click(line.x + 8, line.y + line.height / 2, { button: "right" });
  await p.locator(".me-pop .me-pop-item", { hasText: "Highlight: Red" }).click();
  await expect.poll(() => text(p)).toContain('<mark class="hl-red">last</mark>');
});
