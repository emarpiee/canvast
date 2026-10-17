import { expect, test } from "./harness";
import { readFileSync } from "node:fs";
import { blockyFixture } from "./png";

/** Any file can be imported (ADR 0078): what the browser cannot show is kept as a card with its extension, name and kind. */

const GLB = Buffer.concat([Buffer.from("glTF"), Buffer.from([2, 0, 0, 0]), Buffer.alloc(200, 7)]);
const NOTES = Buffer.from("plain notes\nsecond line\n");

const objects = (p: import("@playwright/test").Page) => p.evaluate(() => window.__canvastDebug.objects()) as Promise<Array<{ id: string; kind: string; assetId?: string }>>;

test("any file imports: a 3D model becomes a card on the canvas and in the library, with its extension chip and the buttons that fit it (ADR 0078)", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("import-input").setInputFiles({ name: "robot.glb", mimeType: "model/gltf-binary", buffer: GLB });
  await expect.poll(async () => (await objects(p)).length).toBe(1);
  await expect(p.getByTestId("toast")).toContainText("robot.glb");
  await expect(p.getByTestId("toast")).toContainText("no preview");
  const [card] = await objects(p);
  expect(card!.kind).toBe("image"); // a card is an ordinary instance of the stored original
  // Selected, the bar offers to download the original (a 3D model cannot be opened in a tab).
  await p.locator("#canvas").focus();
  await p.keyboard.press("Control+a");
  await expect(p.getByRole("button", { name: "Download the original file" })).toBeVisible();
  await expect(p.getByRole("button", { name: "Open in a new tab" })).toBeHidden();
  const dl = p.waitForEvent("download");
  await p.getByRole("button", { name: "Download the original file" }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toBe("robot.glb");
  expect(readFileSync((await download.path())!).equals(GLB)).toBe(true);
  // A text file can also be opened in a tab, as plain text.
  await p.getByTestId("import-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: NOTES });
  await expect.poll(async () => (await objects(p)).length).toBe(2);
  await p.locator("#canvas").focus();
  await p.keyboard.press("Control+a");
  await expect(p.getByRole("button", { name: "Open in a new tab" })).toBeHidden(); // two selected: opening is for one
  // two selected: Download brings both originals in one ZIP
  const zipDl = p.waitForEvent("download");
  await p.getByRole("button", { name: "Download the original file" }).click();
  const zip = await zipDl;
  expect(zip.suggestedFilename()).toMatch(/^canvast-files-\d{8}-\d{4}\.zip$/);
  const zbytes = readFileSync((await zip.path())!).toString("latin1");
  expect(zbytes.startsWith("PK")).toBe(true);
  expect(zbytes).toContain("robot.glb");
  expect(zbytes).toContain("notes.txt");
  // The library: a card for each, the chip and what to do in the details, download there too.
  await p.getByTestId("view-assets").click();
  await expect(p.getByTestId("asset-card")).toHaveCount(2);
  await p.locator('[data-testid="asset-card"][aria-label^="robot.glb"]').click();
  const info = p.getByTestId("asset-file-info");
  await expect(info).toContainText("3D model");
  await expect(info).toContainText("Blender");
  await expect(p.getByTestId("asset-open-tab")).toHaveCount(0);
  await expect(p.locator(".asset-facts .ext-chip")).toHaveText("GLB");
  await p.locator('[data-testid="asset-card"][aria-label^="notes.txt"]').click();
  await expect(p.getByTestId("asset-open-tab")).toBeVisible();
  const popup = p.waitForEvent("popup");
  await p.getByTestId("asset-open-tab").click();
  expect((await popup).url()).toMatch(/^blob:/);
  // The viewer shows the card large with what it is.
  await p.locator('[data-testid="asset-card"][aria-label^="robot.glb"]').click();
  await p.getByTestId("asset-preview").click();
  await expect(p.getByTestId("slide-view")).toBeVisible();
  await expect(p.locator('[data-testid="slide-view"] figcaption')).toContainText("No preview for this kind of file");
  await p.keyboard.press("Escape");
  expect(app.consoleErrors).toEqual([]);
});

test("files with an unknown extension, none, or a picture the browser cannot read all get a card with their own chip; they survive a reload (ADR 0078)", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("import-input").setInputFiles([
    { name: "scene.xyz", mimeType: "", buffer: Buffer.from("abc") },
    { name: "README", mimeType: "", buffer: Buffer.from("hello") },
    { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not a png") },
    { name: "ok.png", mimeType: "image/png", buffer: blockyFixture() },
  ]);
  await expect.poll(async () => (await objects(p)).length).toBe(4);
  await p.getByTestId("view-assets").click();
  await expect(p.getByTestId("asset-card")).toHaveCount(4);
  const chipOf = async (name: string, expected: string): Promise<void> => {
    await p.locator(`[data-testid="asset-card"][aria-label^="${name}"]`).click();
    await expect(p.locator(".asset-facts .ext-chip")).toHaveText(expected);
  };
  await chipOf("scene.xyz", "XYZ");
  await chipOf("README", "FILE");
  await chipOf("broken.png", "PNG");
  await expect(p.getByTestId("asset-file-info")).toContainText("Picture");
  await chipOf("ok.png", "PNG");
  await expect(p.getByTestId("asset-file-info")).toHaveCount(0); // a readable picture is not a card
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect.poll(async () => (await objects(p)).length).toBe(4);
  await p.getByTestId("view-assets").click();
  await expect(p.getByTestId("asset-card")).toHaveCount(4);
  expect(app.consoleErrors).toEqual([]);
});

test("an SVG keeps its real preview (not a card), and the extension chip shows only while a library card is pointed at (ADR 0078)", async ({ app }) => {
  const p = app.page;
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#c33"/></svg>');
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: svg });
  await expect(p.getByTestId("asset-card")).toHaveCount(1);
  const card = p.getByTestId("asset-card");
  await expect(p.locator(".asset-thumb img")).toHaveJSProperty("complete", true);
  // The picture is the SVG itself: red pixels, not the dark file card.
  const px = await p.locator(".asset-thumb img").evaluate((img: HTMLImageElement) => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 4;
    const x = c.getContext("2d")!;
    x.drawImage(img, 0, 0, 4, 4);
    return [...x.getImageData(2, 2, 1, 1).data];
  });
  expect(px[0]).toBeGreaterThan(150);
  expect(px[1]).toBeLessThan(100);
  // The chip: hidden until the card is pointed at (or picked).
  const chip = card.locator(".ext-chip");
  await p.mouse.move(5, 400);
  await expect(chip).toHaveCSS("opacity", "0");
  await card.hover();
  await expect(chip).toHaveCSS("opacity", /0\.9/);
  await card.click();
  await expect(p.getByTestId("asset-file-info")).toHaveCount(0); // a real picture is not a card
  expect(app.consoleErrors).toEqual([]);
});

test("opening the Assets view does not move the focus into the search box; only Ctrl+Shift+F does", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await expect(p.getByTestId("assets-search")).not.toBeFocused();
  await p.keyboard.press("Control+Shift+f");
  await expect(p.getByTestId("assets-search")).toBeFocused();
  expect(app.consoleErrors).toEqual([]);
});

test("rename assets: one (a new name, even a new extension) and many (enumerate, replace text, add text, change the extension), with a preview (ADR 0085)", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles([
    { name: "robot.glb", mimeType: "model/gltf-binary", buffer: Buffer.from("glTF-bytes-1") },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("some notes") },
    { name: "scene.xyz", mimeType: "", buffer: Buffer.from("scene-bytes") },
  ]);
  await expect(p.getByTestId("asset-card")).toHaveCount(3);
  const names = async (): Promise<string[]> => (await p.evaluate(async () => (await window.__canvastDebug.assetListing()).entries.map((e) => e.name))).sort();
  const dialog = p.getByTestId("rename-dialog");
  // One: the name to edit, extension included; the file type, chip and download name follow.
  await p.locator('[data-testid="asset-card"][aria-label^="robot.glb"]').click();
  await p.getByTestId("asset-rename").click();
  await expect(dialog).toBeVisible();
  await p.getByLabel("New name", { exact: true }).fill("droid.obj");
  await p.getByTestId("rename-ok").click();
  await expect(dialog).toBeHidden();
  await expect.poll(names).toEqual(["droid.obj", "notes.txt", "scene.xyz"]);
  await expect(p.locator(".asset-facts .ext-chip")).toHaveText("OBJ");
  await expect(p.getByTestId("type-list").getByRole("button", { name: /^\.OBJ/ })).toContainText("1");
  await expect(p.getByTestId("type-list").getByRole("button", { name: /^\.GLB/ })).toHaveCount(0);
  const dl = p.waitForEvent("download");
  await p.getByTestId("asset-download").click();
  expect((await dl).suggestedFilename()).toBe("droid.obj");
  // Many: Ctrl+A picks all three; Enumerate is the first way, with a preview before anything changes.
  await p.locator("#assets-view").press("Control+a");
  await p.getByTestId("bulk-rename").click();
  await expect(dialog).toContainText("Rename 3 assets");
  await p.getByLabel("Name pattern").fill("Item ##");
  await p.getByLabel("First number").fill("5");
  const preview = p.getByTestId("rename-preview");
  await expect(preview.locator("li")).toHaveCount(3); // every name is listed, whole
  await expect(preview).toContainText("Item 05");
  await expect(p.locator(".rn-h")).toContainText("all 3 change");
  await p.getByTestId("rename-ok").click();
  await expect.poll(async () => (await names()).every((n) => n.startsWith("Item 0"))).toBe(true);
  const after = await names();
  expect(after.map((n) => n.replace(/\.[a-z]+$/, "")).sort()).toEqual(["Item 05", "Item 06", "Item 07"]);
  expect(after.map((n) => n.replace(/^[^.]*\./, "")).sort()).toEqual(["obj", "txt", "xyz"]); // extensions kept
  // Replace text, Add text and Change the extension, through the same dialog (F2).
  await p.keyboard.press("F2");
  await dialog.getByLabel("How to rename:").selectOption("replace");
  await p.getByLabel("Text to find").fill("Item");
  await p.getByLabel("Replace with").fill("Shot");
  await p.getByTestId("rename-ok").click();
  await expect.poll(async () => (await names()).every((n) => n.startsWith("Shot 0"))).toBe(true);
  await p.keyboard.press("F2");
  await dialog.getByLabel("How to rename:").selectOption("add");
  await p.getByLabel("Text to add").fill("old-");
  await dialog.getByLabel("Before the name").check();
  await p.getByTestId("rename-ok").click();
  await expect.poll(async () => (await names()).every((n) => n.startsWith("old-Shot 0"))).toBe(true);
  await p.keyboard.press("F2");
  await dialog.getByLabel("How to rename:").selectOption("extension");
  await p.getByLabel("New extension").fill("dat");
  await expect(p.getByTestId("rename-preview")).toContainText(".dat");
  await p.getByTestId("rename-ok").click();
  await expect.poll(async () => (await names()).every((n) => n.endsWith(".dat"))).toBe(true);
  // Cancel changes nothing; an unreadable pattern says so and cannot be applied.
  await p.keyboard.press("F2");
  await dialog.getByLabel("How to rename:").selectOption("replace");
  await p.getByLabel("Regular expression").check();
  await p.getByLabel("Text to find").fill("(");
  await expect(p.getByTestId("rename-error")).toContainText("regular expression");
  await expect(p.getByTestId("rename-ok")).toBeDisabled();
  await p.getByTestId("rename-cancel").click();
  expect((await names()).every((n) => n.endsWith(".dat"))).toBe(true);
  expect(app.consoleErrors).toEqual([]);
});
