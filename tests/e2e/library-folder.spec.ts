import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./harness";
import { makePng } from "./png";
import { readZip } from "../../src/storage/zip";

/**
 * The library folder (ADR 0159): originals kept as files outside the browser's storage. Chromium only (the File
 * System Access API); a private browser directory (OPFS) stands in for the folder the picker would give.
 */
test.skip(({ browserName }) => browserName !== "chromium", "the library folder is a Chromium feature");

const PNG = makePng(24, 24, (x, y) => [x * 10, y * 10, 90, 255]);

type Rec = { ext: number; blob: number } | null;
const record = (p: Page, hash: string): Promise<Rec> =>
  p.evaluate(
    (h) =>
      new Promise<Rec>((res) => {
        const r = indexedDB.open("canvast");
        r.onsuccess = () => {
          const g = r.result.transaction("assets").objectStore("assets").get(h);
          g.onsuccess = () => res(g.result ? { ext: g.result.ext ?? 0, blob: g.result.blob.size } : null);
        };
      }),
    hash,
  );

async function importPng(p: Page, name = "a.png"): Promise<string> {
  const before = await p.evaluate(() => window.__canvastDebug.storedAssetHashes());
  await p.getByTestId("import-input").setInputFiles({ name, mimeType: "image/png", buffer: PNG });
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.storedAssetHashes()).then((h) => h.length)).toBe(before.length + 1);
  return (await p.evaluate(() => window.__canvastDebug.storedAssetHashes())).find((h) => !before.includes(h))!;
}

const reload = async (p: Page): Promise<void> => {
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate(() => window.__canvastDebug.nextFrame());
};

const present = (p: Page, hash: string): Promise<boolean | undefined> =>
  p.evaluate(async (h) => (await window.__canvastDebug.assetListing()).entries.find((e) => e.hash === h)?.present, hash);

test("with a library folder an import is a file there and a stub in the browser; it survives a reload, is flagged when the file is gone, comes back on re-import and is in the backup", async ({ app }) => {
  const p = app.page;
  await p.evaluate(() => window.__canvastDebug.useTestFolder("lib-a"));
  const hash = await importPng(p);
  expect(await p.evaluate(() => window.__canvastDebug.testFolderFiles())).toEqual([`${hash}.png`]); // (the hash and the extension, so other programs open it)
  expect(await record(p, hash)).toEqual({ ext: 1, blob: 0 });

  await reload(p);
  await p.evaluate(() => window.__canvastDebug.useTestFolder("lib-a")); // (the saved handle of a real folder is attached at start-up)
  expect(await p.evaluate(() => window.__canvastDebug.folderState())).toBe("ready");
  expect(await present(p, hash)).toBe(true);

  // A backup holds the bytes of an original that lives in the folder.
  await p.getByTestId("save-status").click();
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId("set-export-full").click()]);
  const z = await readZip(new Blob([new Uint8Array(await readFile((await dl.path())!))]));
  expect((await z.get(`assets/${hash}`)!.data.arrayBuffer()).byteLength).toBe(PNG.length);

  // The file moved away: the original shows as missing, nothing else breaks, and importing it again restores it.
  await p.evaluate((h) => window.__canvastDebug.testFolderDelete(`${h}.png`), hash);
  expect(await present(p, hash)).toBe(false);
  await p.getByTestId("import-input").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG });
  await expect.poll(() => present(p, hash)).toBe(true);
  expect(await p.evaluate(() => window.__canvastDebug.testFolderFiles())).toEqual([`${hash}.png`]);
});

test("files move into the folder and back from the storage panel, each one proven before the other copy goes", async ({ app }) => {
  const p = app.page;
  const hash = await importPng(p);
  expect(await record(p, hash)).toEqual({ ext: 0, blob: PNG.length });
  await p.evaluate(() => window.__canvastDebug.useTestFolder("lib-b"));
  await p.getByTestId("save-status").click();
  await expect(p.getByTestId("browser-count")).toHaveText("1");
  await p.getByRole("button", { name: "Move browser files into the folder" }).click();
  await expect.poll(() => record(p, hash)).toEqual({ ext: 1, blob: 0 });
  expect(await p.evaluate(() => window.__canvastDebug.testFolderFiles())).toEqual([`${hash}.png`]);
  expect(await present(p, hash)).toBe(true);

  await expect(p.getByTestId("folder-count")).toHaveText("1");
  await expect(p.getByRole("button", { name: "Choose another folder…" })).toBeDisabled(); // (files in it would show as missing)
  await p.getByRole("button", { name: "Move files back into the browser" }).click();
  await expect.poll(() => record(p, hash)).toEqual({ ext: 0, blob: PNG.length });
  expect(await p.evaluate(() => window.__canvastDebug.testFolderFiles())).toEqual([]);
});

test("erasing an original from the library (garbage collection) removes its file from the folder", async ({ app }) => {
  const p = app.page;
  await p.evaluate(() => window.__canvastDebug.useTestFolder("lib-c"));
  await p.evaluate(() => window.__canvastDebug.setView("assets"));
  await p.getByTestId("assets-import-input").setInputFiles({ name: "lib.png", mimeType: "image/png", buffer: PNG });
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.testFolderFiles()).then((f) => f.length)).toBe(1);
  const hash = (await p.evaluate(() => window.__canvastDebug.testFolderFiles()))[0]!.split(".")[0]!;
  await p.evaluate((h) => window.__canvastDebug.forceCatalogState(h, "deleted"), hash);
  await p.evaluate(() => window.__canvastDebug.gc());
  expect(await p.evaluate(() => window.__canvastDebug.testFolderFiles())).toEqual([]);
  expect(await p.evaluate(() => window.__canvastDebug.storedAssetHashes())).toEqual([]);
});

test("files stored before names had extensions are written again as hash.ext from Settings > Storage", async ({ app }) => {
  const p = app.page;
  await p.evaluate(() => window.__canvastDebug.useTestFolder("lib-d"));
  const hash = await importPng(p);
  await p.evaluate((h) => window.__canvastDebug.makeBareName(h), hash);
  expect(await p.evaluate(() => window.__canvastDebug.testFolderFiles())).toEqual([hash]);
  expect(await present(p, hash)).toBe(true); // (a bare name is still read)
  await p.getByTestId("save-status").click();
  await p.getByRole("button", { name: "Add file extensions to 1 file" }).click();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.testFolderFiles())).toEqual([`${hash}.png`]);
  expect(await present(p, hash)).toBe(true);
  await expect(p.getByRole("button", { name: /Add file extensions/ })).toHaveCount(0);
});
