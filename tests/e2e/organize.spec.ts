import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { APP_URL, expect, test } from "./harness";
import { blockyFixture, makePng } from "./png";
import { readZip } from "../../src/storage/zip";

/**
 * Phase 1, slice 6: organizing the asset library (ADR 0011): tags,
 * favourites, nested folders with non-exclusive membership, search, sidebar
 * scopes, and their round trip through archives.
 */

const BLOCKS = blockyFixture();
const HASH = createHash("sha256").update(BLOCKS).digest("hex");
const GREEN = makePng(4, 4, () => [30, 160, 70, 255]);
const GREEN_HASH = createHash("sha256").update(GREEN).digest("hex");

const card = (p: Page, hash: string) => p.locator(`[data-testid="asset-card"][data-hash="${hash}"]`);
const cards = (p: Page) => p.getByTestId("asset-card");
const side = (p: Page, label: RegExp) => p.getByTestId("assets-side").getByRole("button", { name: label });

async function libraryWithTwo(p: Page): Promise<void> {
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles([
    { name: "blocks.png", mimeType: "image/png", buffer: BLOCKS },
    { name: "green.png", mimeType: "image/png", buffer: GREEN },
  ]);
  await expect(cards(p)).toHaveCount(2);
}

/** Select an asset and wait until the inspector shows it. */
async function pick(p: Page, hash: string): Promise<void> {
  // A click opens the viewer (with the details beside it); Esc closes it and the asset stays selected in the library.
  await card(p, hash).click();
  const viewer = p.getByTestId("slide-view");
  await expect(viewer).toBeVisible();
  await p.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(card(p, hash)).toHaveAttribute("aria-pressed", "true");
}

async function addTags(p: Page, hash: string, text: string): Promise<void> {
  await pick(p, hash);
  await p.getByTestId("asset-tag-input").fill(text);
  await p.getByTestId("asset-tag-input").press("Enter");
}

async function newFolder(p: Page, name: string, parent?: string): Promise<void> {
  if (parent) await p.getByRole("button", { name: `New folder inside ${parent}` }).click();
  else await p.getByTestId("folder-new").click();
  await p.getByTestId("folder-name-input").fill(name);
  await p.getByTestId("folder-name-input").press("Enter");
  await expect(side(p, new RegExp(`^${name}\\b`))).toBeVisible();
}

test("tags and favourites: edit in the inspector, filter by sidebar and search, and they persist", async ({ app }) => {
  const p = app.page;
  await libraryWithTwo(p);
  await addTags(p, HASH, "Hands, ref");
  await expect(p.getByTestId("asset-tags")).toContainText("#Hands");
  await expect(p.getByTestId("asset-tags")).toContainText("#ref");
  await addTags(p, HASH, "hands"); // case-insensitive duplicate: no change
  await expect(p.getByTestId("asset-tags").locator(".tag-chip")).toHaveCount(2);
  await p.getByTestId("asset-favorite").click();
  await expect(p.getByTestId("asset-favorite")).toHaveAttribute("aria-pressed", "true");
  await addTags(p, GREEN_HASH, "colour");
  await expect(card(p, HASH).getByTestId("asset-card-tags")).toHaveText("#Hands #ref");

  // Sidebar scopes.
  await expect(side(p, /Favourites/)).toContainText("1");
  await side(p, /Favourites/).click();
  await expect(cards(p)).toHaveCount(1);
  await side(p, /#ref/).click();
  await expect(cards(p)).toHaveCount(1);
  await expect(card(p, HASH)).toBeVisible();
  await side(p, /All assets/).click();
  await expect(cards(p)).toHaveCount(2);

  // Search: words match name, type or tags; #tag is exact.
  const searchFor = async (q: string, n: number): Promise<void> => {
    await p.getByTestId("assets-search").fill(q);
    await expect(cards(p)).toHaveCount(n);
  };
  await searchFor("hand", 1);
  await searchFor("#ref", 1);
  await searchFor("#re", 0);
  await searchFor("png colour", 1);
  await searchFor("", 2);

  // A smart folder saves a search (ADR 0035): it counts its matches, applies them when clicked, and can be renamed.
  await expect(p.getByTestId("smart-new")).toBeDisabled();
  await searchFor("#ref", 1);
  await p.getByTestId("smart-new").click();
  await p.getByTestId("folder-name-input").fill("Refs");
  await p.keyboard.press("Enter");
  const smartItem = p.locator('[data-testid="smart-list"] .side-item');
  await expect(smartItem).toHaveText(/Refs\s*1/);
  await searchFor("", 2);
  await smartItem.click();
  await expect(p.getByTestId("assets-search")).toHaveValue("#ref");
  await expect(cards(p)).toHaveCount(1);
  await p.getByRole("button", { name: "Rename smart folder Refs" }).click();
  await p.getByTestId("folder-name-input").fill("Reference");
  await p.keyboard.press("Enter");
  await expect(smartItem).toHaveText(/Reference/);
  await searchFor("", 2);

  // Removing a tag.
  await card(p, HASH).click();
  await p.getByRole("button", { name: "Remove tag ref" }).click();
  await expect(p.getByTestId("asset-tags").locator(".tag-chip")).toHaveCount(1);

  // Everything survives a reload.
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.getByTestId("view-assets").click();
  await pick(p, HASH);
  await expect(p.getByTestId("asset-tags")).toHaveText(/#Hands/);
  await expect(p.getByTestId("asset-favorite")).toHaveAttribute("aria-pressed", "true");
  await expect(p.getByTestId("tag-list")).toContainText("#colour");
  await expect(p.getByTestId("smart-list")).toContainText("Reference");
  await p.getByRole("button", { name: "Delete smart folder Reference" }).click();
  await expect(p.getByTestId("smart-list")).not.toContainText("Reference");
  expect(app.consoleErrors).toEqual([]);
});

test("folders nest, an asset can be in several, and deleting a folder never deletes assets", async ({ app }) => {
  const p = app.page;
  await libraryWithTwo(p);
  await newFolder(p, "Refs");
  await newFolder(p, "Hands", "Refs");
  // File blocks in Hands and in Refs (two folders, one original); green in Refs only.
  await pick(p, HASH);
  await p.getByTestId("asset-folders").getByLabel("Refs › Hands").check();
  await p.getByTestId("asset-folders").getByRole("checkbox", { name: "Refs", exact: true }).check();
  await pick(p, GREEN_HASH);
  await p.getByTestId("asset-folders").getByRole("checkbox", { name: "Refs", exact: true }).check();

  await side(p, /^Refs/).click();
  await expect(cards(p)).toHaveCount(2); // a folder shows its subfolders too
  await side(p, /^Hands/).click();
  await expect(cards(p)).toHaveCount(1);
  await side(p, /^Unfiled/).click();
  await expect(cards(p)).toHaveCount(0);
  expect(await p.evaluate(() => window.__canvastDebug.storedAssetHashes())).toEqual([HASH, GREEN_HASH].sort());

  // Rename.
  await p.getByRole("button", { name: "Rename folder Hands" }).click();
  await p.getByTestId("folder-name-input").fill("Palms");
  await p.getByTestId("folder-name-input").press("Enter");
  await expect(side(p, /^Palms/)).toBeVisible();
  // An empty name is refused with a message, and nothing changes.
  await p.getByRole("button", { name: "Rename folder Palms" }).click();
  await p.getByTestId("folder-name-input").fill("   ");
  await p.getByTestId("folder-name-input").press("Enter");
  await expect(p.getByTestId("assets-status")).toHaveText("A folder needs a name.");
  await expect(side(p, /^Palms/)).toBeVisible();

  // Delete Refs (with Palms inside): confirmed; both assets stay, now unfiled.
  await p.getByRole("button", { name: "Delete folder Refs" }).click();
  await expect(p.getByTestId("confirm-dialog")).toContainText("stay in the library");
  await p.getByTestId("confirm-ok").click();
  await expect(p.getByTestId("folder-tree")).toContainText("No folders yet.");
  await expect(side(p, /^Unfiled/)).toContainText("2");
  await expect(side(p, /^All assets/)).toContainText("2");
  expect(await p.evaluate(() => window.__canvastDebug.storedAssetHashes())).toEqual([HASH, GREEN_HASH].sort());
  expect(app.consoleErrors).toEqual([]);
});

test("tags, favourites and folders travel in archives and merge on import without duplicate folders", async ({ app, browser }) => {
  const p = app.page;
  await libraryWithTwo(p);
  await newFolder(p, "Refs");
  await newFolder(p, "Hands", "Refs");
  await addTags(p, HASH, "Hands");
  await p.getByTestId("asset-favorite").click();
  await p.getByTestId("asset-folders").getByLabel("Refs › Hands").check();
  await expect(p.getByTestId("asset-folders").getByLabel("Refs › Hands")).toBeChecked();

  await p.getByTestId("view-canvas").click();
  await p.getByTestId("save-status").click();
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId("export-workspace").click()]);
  const bytes = await readFile((await dl.path())!);
  const man = JSON.parse(await (await readZip(new Blob([new Uint8Array(bytes)]))).get("manifest.json")!.data.text()) as {
    assets: Array<{ hash: string; tags: string[]; favorite: boolean; folders: string[][] }>;
  };
  expect(man.assets.find((a) => a.hash === HASH)).toMatchObject({ tags: ["Hands"], favorite: true, folders: [["Refs", "Hands"]] });
  expect(man.assets.find((a) => a.hash === GREEN_HASH)).toMatchObject({ tags: [], favorite: false, folders: [] });

  // Into a fresh profile, twice: the second import merges and creates no second "Refs" or "Hands".
  const context = await browser.newContext();
  const q = await context.newPage();
  await q.setViewportSize({ width: 1280, height: 800 });
  await q.goto(APP_URL);
  await q.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  for (let i = 0; i < 2; i++) {
    if (await q.getByTestId("storage-panel").isHidden()) await q.getByTestId("save-status").click();
    await q.getByTestId("import-archive-input").setInputFiles({ name: dl.suggestedFilename(), mimeType: "application/zip", buffer: bytes });
    await q.getByTestId("confirm-ok").click();
    await expect(q.getByTestId("toast")).toContainText("Imported");
  }
  await q.getByTestId("view-assets").click();
  await expect(q.getByTestId("folder-tree").getByRole("button", { name: /^Refs/ })).toHaveCount(1);
  await expect(q.getByTestId("folder-tree").getByRole("button", { name: /^Hands/ })).toHaveCount(1);
  await q.locator(`[data-testid="asset-card"][data-hash="${HASH}"]`).click();
  await expect(q.getByTestId("asset-favorite")).toHaveAttribute("aria-pressed", "true");
  await expect(q.getByTestId("asset-tags").locator(".tag-chip")).toHaveCount(1);
  await expect(q.getByTestId("asset-folders").getByLabel("Refs › Hands")).toBeChecked();
  await context.close();
});

test("a read-only tab sees the writer's changes and cannot edit organization", async ({ app, context }) => {
  const p1 = app.page;
  await libraryWithTwo(p1);
  const p2 = await context.newPage();
  await p2.setViewportSize({ width: 1280, height: 800 });
  await p2.goto(APP_URL);
  await p2.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p2.getByTestId("view-assets").click();
  await card(p2, HASH).click();
  await expect(p2.getByTestId("asset-tag-input")).toBeDisabled();
  await expect(p2.getByTestId("asset-favorite")).toBeDisabled();
  await expect(p2.getByTestId("folder-new")).toHaveCount(0);
  // The writer tags it; the reader's view follows.
  await addTags(p1, HASH, "shared");
  await expect(p2.getByTestId("tag-list")).toContainText("#shared");
  await p2.close();
});
