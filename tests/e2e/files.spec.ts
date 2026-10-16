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
  await expect(p.getByRole("button", { name: "Download the original file" })).toBeHidden(); // two selected: the file buttons are for one
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
