import { expect, test } from "@playwright/test";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * An update-safe origin for a replaced HTML file (Phase 8, docs/reference/storage-origin.md). The app is one file the owner replaces with a newer
 * one: what was saved must still be there. The page's storage belongs to the browser's origin for that file, so a file put back at the same
 * path is the same place for the data; a copy at another path is whatever the browser makes of it (it is not asserted here, only recorded).
 */
const BUILD = resolve(process.env["CANVAST_BUILD_DIR"] ?? "dist", "canvast.html");

test("a newer file put at the same path finds the canvas saved by the older one, and a camera, and keeps saving", async ({ page }, info) => {
  const dir = info.outputPath("app");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, "canvast.html");
  copyFileSync(BUILD, file);
  const url = pathToFileURL(file).href + "#debug";
  const ready = async () => {
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
    await page.waitForFunction(() => window.__canvastDebug.startupMarks()["first-frame"] !== undefined);
  };
  const saved = () => expect(page.getByTestId("save-status")).toContainText("Saved");
  const stored = () => page.evaluate(() => window.__canvastDebug.objects().length);

  // the older file: draw two shapes and save
  await page.goto(url);
  await ready();
  await page.keyboard.press("u");
  await page.locator('[data-shape-kind="rect"]').click();
  await page.mouse.move(420, 420);
  await page.mouse.down();
  await page.mouse.move(560, 500, { steps: 6 });
  await page.mouse.up();
  await page.locator('[data-shape-kind="ellipse"]').click();
  await page.mouse.move(620, 420);
  await page.mouse.down();
  await page.mouse.move(740, 500, { steps: 6 });
  await page.mouse.up();
  expect(await stored()).toBe(2);
  await saved();
  const before = await page.evaluate(() => ({ ids: window.__canvastDebug.objects().map((o) => String(o["id"])).sort(), camera: window.__canvastDebug.camera() }));

  // replaced: a different file (another version string and a comment) at the same path, opened as a fresh navigation
  const text = readFileSync(file, "utf8");
  expect(text).toContain("</html>");
  writeFileSync(file, text.replace("</html>", "<!-- a newer build --></html>"));
  expect(readFileSync(file, "utf8")).not.toBe(text);
  await page.goto("about:blank");
  await page.goto(url);
  await ready();
  const after = await page.evaluate(() => ({ ids: window.__canvastDebug.objects().map((o) => String(o["id"])).sort(), camera: window.__canvastDebug.camera() }));
  expect(after.ids, "the same objects").toEqual(before.ids);
  expect(after.camera, "the same view").toEqual(before.camera);
  // and it goes on saving
  await page.keyboard.press("u");
  await page.locator('[data-shape-kind="rect"]').click();
  await page.mouse.move(420, 560);
  await page.mouse.down();
  await page.mouse.move(520, 620, { steps: 6 });
  await page.mouse.up();
  await saved();
  await page.reload();
  await ready();
  expect(await stored()).toBe(3);

  // the same file at another path: recorded, not asserted (it is the browser's choice; Settings > Storage says to keep a backup)
  const other = resolve(dirname(file), "copy", "canvast.html");
  mkdirSync(dirname(other), { recursive: true });
  copyFileSync(file, other);
  const page2 = await page.context().newPage();
  await page2.goto(pathToFileURL(other).href + "#debug");
  await page2.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await page2.waitForFunction(() => window.__canvastDebug.startupMarks()["first-frame"] !== undefined);
  const elsewhere = await page2.evaluate(() => window.__canvastDebug.objects().length);
  info.annotations.push({ type: "another path", description: `${info.project.name}: ${elsewhere} objects (3 means the data is shared between paths)` });
  console.log(`another path: ${info.project.name} sees ${elsewhere} of 3 objects`);
});
