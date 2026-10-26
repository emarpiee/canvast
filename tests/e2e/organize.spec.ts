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
  await card(p, hash).click();
  await expect(card(p, hash)).toHaveAttribute("aria-pressed", "true");
}

async function addTags(p: Page, hash: string, text: string): Promise<void> {
  await pick(p, hash);
  await p.getByTestId("asset-tag-input").fill(text);
  await p.getByTestId("asset-tag-input").press("Enter");
}

/** Open a sidebar row's More menu and choose one of its actions (the sidebar keeps one "more" button per row, not a row of buttons). */
async function sideAct(p: Page, kind: "folder" | "tag", name: string, action: string): Promise<void> {
  await p.getByRole("button", { name: `More actions for ${kind} ${name}`, exact: true }).click();
  await p.getByRole("menuitem", { name: action, exact: true }).click();
}

async function newFolder(p: Page, name: string, parent?: string): Promise<void> {
  if (parent) await sideAct(p, "folder", parent, `New folder inside ${parent}`);
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
  // Choosing the chosen tag again lets go of it.
  await side(p, /#ref/).click();
  await expect(cards(p)).toHaveCount(2);
  await expect(side(p, /All items/)).toHaveAttribute("aria-current", "true");
  await side(p, /All items/).click();
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
  // AND, OR, XOR, NOT and brackets (ADR 0069); an unreadable query is read as plain words.
  await searchFor("hand OR png", 2);
  await searchFor("hand AND png", 1);
  await searchFor("hand XOR png", 1);
  await searchFor("png -#ref", 1);
  await searchFor("NOT (hand OR colour)", 0);
  await searchFor("(hand", 1);
  await p.getByRole("button", { name: "How to combine search words" }).click();
  await p.getByRole("dialog", { name: "Combining search words" }).getByRole("button", { name: "red OR blue", exact: true }).click();
  await expect(p.getByTestId("assets-search")).toHaveValue("red OR blue");
  // Suggestions follow the word being typed (ADR 0083): a dot word suggests file types, a plain word tags, a finished word the operators.
  const sg = p.locator(".assets-search-pop").getByTestId("search-suggest");
  await p.getByTestId("assets-search").focus();
  await p.getByTestId("assets-search").fill(".p");
  await expect(sg.getByRole("button", { name: /^\.png/ })).toBeVisible();
  await sg.getByRole("button", { name: /^\.png/ }).click();
  await expect(p.getByTestId("assets-search")).toHaveValue(".png ");
  await expect(sg.getByRole("button", { name: /^OR/ })).toBeVisible(); // after a finished word: what can follow
  await p.getByTestId("assets-search").fill("han");
  await expect(sg.getByRole("button", { name: /^#hands/i })).toBeVisible();
  await p.keyboard.press("Tab"); // Tab takes the first suggestion
  await expect(p.getByTestId("assets-search")).toHaveValue("#Hands ");
  await expect(cards(p)).toHaveCount(1);
  await p.getByTestId("assets-search").fill("");
  // The same search as the canvas search (ADR 0071): ways, a first "/" for Name, a clear button and recent searches that found something.
  const box = p.getByTestId("assets-search");
  const pop = p.getByTestId("assets-search-pop");
  await box.focus();
  await pop.getByRole("tab", { name: /Tag/ }).click();
  await searchFor("png", 0); // tags only
  await searchFor("hand", 1);
  await pop.getByRole("tab", { name: /Name/ }).click();
  await searchFor("hand", 0); // names only
  await searchFor("blocks", 1);
  await pop.getByRole("tab", { name: "All" }).click();
  await box.fill("/green"); // a first "/" chooses Name and is not part of the search
  await expect(box).toHaveValue("green");
  await expect(pop.getByRole("tab", { name: /Name/ })).toHaveAttribute("aria-selected", "true");
  await expect(cards(p)).toHaveCount(1);
  await box.press("Enter"); // used and it found something: remembered
  await p.getByRole("button", { name: "Clear the search" }).click();
  await expect(box).toHaveValue("");
  await expect(cards(p)).toHaveCount(2);
  const recent = pop.getByTestId("search-recent");
  await expect(recent).toContainText("/ green");
  await recent.getByRole("button", { name: "/ green", exact: true }).click();
  await expect(box).toHaveValue("green");
  await expect(cards(p)).toHaveCount(1);
  await box.fill("zzz-nothing");
  await box.press("Enter"); // found nothing: not remembered
  await box.fill("");
  await expect(recent).not.toContainText("zzz-nothing");
  await recent.getByRole("button", { name: "Clear recent" }).click();
  await expect(recent).toBeHidden();
  await pop.getByRole("tab", { name: "All" }).click();
  await searchFor("", 2);

  // File types (ADR 0082): one chip per extension in the library, with its count; pressing one shows those files, pressing it again lets go.
  const types = p.getByTestId("type-list");
  await expect(types).toContainText(".PNG");
  await expect(types.getByRole("button", { name: /^\.PNG/ })).toContainText("2");
  await p.getByTestId("assets-import-input").setInputFiles({ name: "robot.glb", mimeType: "model/gltf-binary", buffer: Buffer.from("glTF-demo-bytes") });
  await expect(cards(p)).toHaveCount(3);
  await expect(types.getByRole("button", { name: /^\.GLB/ })).toContainText("1");
  await types.getByRole("button", { name: /^\.GLB/ }).click();
  await expect(cards(p)).toHaveCount(1);
  await types.getByRole("button", { name: /^\.GLB/ }).click();
  await expect(cards(p)).toHaveCount(3);
  // A word that starts with a dot is a file type in the search, and combines like any other word.
  await searchFor(".png", 2);
  await searchFor(".glb", 1);
  await searchFor(".png OR .glb", 3);
  await searchFor(".png -#ref", 1);
  await searchFor(".jpg", 0);
  await searchFor("", 3);

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
  expect(app.consoleErrors).toEqual([]);
});

test("hiding: a hidden item is in no list until the word is typed (and the password given); an export asks about it", async ({ app }) => {
  const p = app.page;
  await libraryWithTwo(p);
  await pick(p, HASH);
  await p.getByTestId("asset-hide").click();
  await expect(cards(p)).toHaveCount(1); // gone from All; nothing stays picked
  await expect(side(p, /^All items/)).toContainText("1");
  await expect(side(p, /Hidden/)).toHaveCount(0); // (no Hidden row: the list is not shown anywhere)
  const search = p.getByTestId("assets-search");

  // A password, set in Settings > Privacy.
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: /Privacy/ }).click();
  await p.getByTestId("hidden-pw-set").click();
  await p.getByTestId("prompt-input").fill("secret");
  await p.getByTestId("prompt-ok").click();
  await p.getByTestId("prompt-input").fill("secret");
  await p.getByTestId("prompt-ok").click();
  await expect(p.locator("[data-hidden-state]")).toContainText("A password is set");

  // The word opens the list, after the password; a wrong one asks again.
  await p.getByTestId("view-assets").click();
  await search.fill("hidden:");
  await p.getByTestId("prompt-input").fill("nope");
  await p.getByTestId("prompt-ok").click();
  await expect(p.getByTestId("prompt-dialog")).toContainText("not the password");
  await p.getByTestId("prompt-input").fill("secret");
  await p.getByTestId("prompt-ok").click();
  await expect(side(p, /Hidden/)).toContainText("1");
  await expect(card(p, HASH)).toBeVisible();
  await expect(cards(p)).toHaveCount(1);

  // An export that would carry it asks; leaving it out keeps it out of the file.
  await p.getByTestId("view-canvas").click();
  await p.getByTestId("save-status").click();
  const [dl] = await Promise.all([p.waitForEvent("download"), (async () => {
    await p.getByTestId("set-export-full").click();
    await expect(p.getByTestId("choose-dialog")).toContainText("1 hidden item");
    await p.getByTestId("choose-ok").click(); // (the first choice: leave them out)
  })()]);
  const z = await readZip(new Blob([new Uint8Array(await readFile((await dl.path())!))]));
  const manifest = JSON.parse(await z.get("manifest.json")!.data.text()) as { assets: Array<{ hash: string }> };
  expect(manifest.assets.map((a) => a.hash)).toEqual([GREEN_HASH]);

  // Left alone, the list closes with the library; with "keep open" on, it stays (and asks no more) until the tab closes.
  await p.getByTestId("view-assets").click();
  await expect(side(p, /Hidden/)).toHaveCount(0);
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: /Privacy/ }).click();
  await p.locator('[data-row="library.hiddenRemember"] input').check();
  await p.getByTestId("view-assets").click();
  await search.fill("hidden:");
  await p.getByTestId("prompt-input").fill("secret");
  await p.getByTestId("prompt-ok").click();
  await expect(side(p, /Hidden/)).toContainText("1");
  await p.getByTestId("view-canvas").click();
  await p.getByTestId("view-assets").click();
  await expect(side(p, /Hidden/)).toContainText("1");
  await expect(p.getByTestId("prompt-dialog")).toHaveCount(0);
  expect(app.consoleErrors).toEqual([]);
});

test("folders nest, an asset is in one folder at a time, and deleting a folder never deletes assets", async ({ app }) => {
  const p = app.page;
  await libraryWithTwo(p);
  await newFolder(p, "Refs");
  await newFolder(p, "Hands", "Refs");
  // One folder each: blocks go to Hands, green to Refs. Choosing another folder moves the asset, it does not add one.
  await pick(p, HASH);
  await p.getByTestId("asset-folders").getByLabel("Refs › Hands").check();
  await expect(p.getByTestId("asset-folders").getByRole("radio", { name: "Refs", exact: true })).not.toBeChecked();
  await pick(p, GREEN_HASH);
  await p.getByTestId("asset-folders").getByRole("radio", { name: "Refs", exact: true }).check();
  await pick(p, HASH);
  await expect(p.getByTestId("asset-folders").getByLabel("Refs › Hands")).toBeChecked();
  await p.getByTestId("asset-folders").getByRole("radio", { name: "Refs", exact: true }).check();
  await expect(p.getByTestId("asset-folders").getByLabel("Refs › Hands")).not.toBeChecked();
  await p.getByTestId("asset-folders").getByLabel("Refs › Hands").check();

  await side(p, /^Refs/).click();
  await expect(cards(p)).toHaveCount(2); // a folder shows its subfolders too
  await side(p, /^Hands/).click();
  await expect(cards(p)).toHaveCount(1);
  await side(p, /^Unfiled/).click();
  await expect(cards(p)).toHaveCount(0);
  expect(await p.evaluate(() => window.__canvastDebug.storedAssetHashes())).toEqual([HASH, GREEN_HASH].sort());

  // Rename.
  await sideAct(p, "folder", "Hands", "Rename folder Hands");
  await p.getByTestId("folder-name-input").fill("Palms");
  await p.getByTestId("folder-name-input").press("Enter");
  await expect(side(p, /^Palms/)).toBeVisible();
  // An empty name is refused with a message, and nothing changes.
  await sideAct(p, "folder", "Palms", "Rename folder Palms");
  await p.getByTestId("folder-name-input").fill("   ");
  await p.getByTestId("folder-name-input").press("Enter");
  await expect(p.getByTestId("assets-status")).toHaveText("A folder needs a name.");
  await expect(side(p, /^Palms/)).toBeVisible();

  // Delete Refs (with Palms inside): confirmed; both assets stay, now unfiled.
  await sideAct(p, "folder", "Refs", "Delete folder Refs");
  await expect(p.getByTestId("confirm-dialog")).toContainText("stay in the library");
  await p.getByTestId("confirm-ok").click();
  await expect(p.getByTestId("folder-tree")).toContainText("No folders yet.");
  await expect(side(p, /^Unfiled/)).toContainText("2");
  await expect(side(p, /^All items/)).toContainText("2");
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
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId("set-export-full").click()]);
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
    if (await q.getByTestId("set-export-full").isHidden()) await q.getByTestId("save-status").click();
    await q.getByTestId("set-import-input").setInputFiles({ name: dl.suggestedFilename(), mimeType: "application/zip", buffer: bytes });
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

test("tags can be renamed and deleted for the whole library (ADR 0057)", async ({ app }) => {
  const p = app.page;
  await libraryWithTwo(p);
  await addTags(p, HASH, "hands, ref");
  await addTags(p, GREEN_HASH, "ref, colour");
  const tagRow = (name: string) => p.getByTestId("tag-list").getByRole("button", { name: new RegExp(`^#${name}\\b`) });
  await expect(tagRow("ref")).toContainText("2");
  // Rename: every asset that had it has the new name; renaming onto an existing tag merges.
  await sideAct(p, "tag", "ref", "Rename tag ref");
  await p.getByTestId("folder-name-input").fill("reference");
  await p.keyboard.press("Enter");
  await expect(tagRow("reference")).toContainText("2");
  await expect(tagRow("ref")).toHaveCount(0);
  await p.getByTestId("assets-search").fill("#reference");
  await expect(cards(p)).toHaveCount(2);
  await p.getByTestId("assets-search").fill("");
  await sideAct(p, "tag", "colour", "Rename tag colour");
  await p.getByTestId("folder-name-input").fill("hands");
  await p.keyboard.press("Enter");
  await expect(tagRow("hands")).toContainText("2");
  await expect(tagRow("colour")).toHaveCount(0);
  // Delete: taken off every asset, the assets stay.
  await sideAct(p, "tag", "hands", "Delete tag hands");
  await expect(p.getByTestId("confirm-dialog")).toContainText("items stay");
  await p.getByTestId("confirm-ok").click();
  await expect(tagRow("hands")).toHaveCount(0);
  await p.getByRole("button", { name: /^All items/ }).click();
  await expect(cards(p)).toHaveCount(2);
  await pick(p, HASH);
  await expect(p.getByTestId("asset-tags")).toHaveText(/#reference/);
  await expect(p.getByTestId("asset-tags")).not.toHaveText(/hands/);
  expect(app.consoleErrors).toEqual([]);
});

test("the workspace menu exports the whole workspace as a backup or as plain files (by file type or by folder) and imports a file (ADR 0057)", async ({ app, browser }) => {
  const p = app.page;
  await libraryWithTwo(p);
  await newFolder(p, "Refs");
  await pick(p, HASH);
  await p.getByTestId("asset-folders").getByLabel("Refs").check();
  await p.getByTestId("view-canvas").click();
  const crumb = p.getByTestId("view-canvas");
  const zipPaths = async (choice: RegExp): Promise<string[]> => {
    await crumb.click();
    const [dl] = await Promise.all([p.waitForEvent("download"), (async () => {
      await p.getByTestId("nav-export-files").click();
      await p.getByRole("radio", { name: choice }).check();
      await p.getByTestId("choose-ok").click();
    })()]);
    expect(dl.suggestedFilename()).toMatch(/-files-\d{4}-\d{2}-\d{2}\.zip$/);
    const entries = await readZip(new Blob([new Uint8Array(await readFile((await dl.path())!))]));
    return [...entries.keys()].sort();
  };
  // By file type: every file under its own name in a folder named for its extension.
  expect(await zipPaths(/By file type/)).toEqual(["png/blocks.png", "png/green.png"]);
  // By my folders: the filed one goes to its folder, the other to the folder of its kind.
  expect(await zipPaths(/By my folders/)).toEqual(["Refs/blocks.png", "png/green.png"]);
  // A backup of the whole workspace, imported into a fresh profile from the same menu.
  await crumb.click();
  const [bk] = await Promise.all([p.waitForEvent("download"), p.getByTestId("nav-export-workspace").click()]);
  expect(bk.suggestedFilename()).toMatch(/\.canvast$/);
  const bytes = await readFile((await bk.path())!);
  const context = await browser.newContext();
  const q = await context.newPage();
  await q.setViewportSize({ width: 1280, height: 800 });
  await q.goto(APP_URL);
  await q.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await q.getByTestId("view-canvas").click();
  await q.getByTestId("nav-import-input").setInputFiles({ name: bk.suggestedFilename(), mimeType: "application/zip", buffer: bytes });
  await q.getByTestId("confirm-ok").click();
  await expect(q.getByTestId("toast")).toContainText("Imported");
  await q.getByTestId("view-assets").click();
  await expect(cards(q)).toHaveCount(2);
  await expect(q.getByTestId("folder-tree").getByRole("button", { name: /^Refs/ })).toHaveCount(1);
  await context.close();
  expect(app.consoleErrors).toEqual([]);
});

test("sidebar: one More menu per row (Escape closes only it, one click elsewhere still works), sections fold and are remembered, and on a phone the list is a strip that opens on demand", async ({ app }) => {
  const p = app.page;
  await libraryWithTwo(p);
  await newFolder(p, "Refs");
  await pick(p, HASH);
  const more = p.getByRole("button", { name: "More actions for folder Refs", exact: true });
  await more.click();
  await expect(p.getByRole("menuitem")).toHaveCount(3); // New subfolder, Rename, Delete
  await p.keyboard.press("Escape");
  await expect(p.getByRole("menu")).toHaveCount(0);
  await expect(card(p, HASH), "Escape closed the menu only").toHaveAttribute("aria-pressed", "true");
  // With a menu open, one click on another row both closes it and does that row's action.
  await more.click();
  await side(p, /^Favourites/).click();
  await expect(p.getByRole("menu")).toHaveCount(0);
  await expect(side(p, /^Favourites/)).toHaveAttribute("aria-current", "true");
  // A section folds away and stays folded over a reload.
  await p.getByRole("button", { name: "Folders", exact: true }).click();
  await expect(p.getByTestId("folder-tree")).toHaveCount(0);
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.getByTestId("view-assets").click();
  await expect(p.getByTestId("folder-tree")).toHaveCount(0);
  await p.getByRole("button", { name: "Folders", exact: true }).click();
  await expect(p.getByTestId("folder-tree")).toBeVisible();
  // Small screen: a strip naming the current choice; opening it shows the lists; choosing folds it again.
  await p.setViewportSize({ width: 390, height: 800 });
  const strip = p.locator(".side-collapse");
  await expect(strip).toBeVisible();
  await expect(p.locator(".side-body")).toBeHidden();
  await strip.click();
  await expect(p.locator(".side-body")).toBeVisible();
  await side(p, /^Unfiled/).click();
  await expect(p.locator(".side-body")).toBeHidden();
  await expect(strip).toContainText("Library: Unfiled");
  expect(app.consoleErrors).toEqual([]);
});

test("the workspace menu's ⋯ menu opens right beside its button, even though the menu is a blurred panel (ADR 0068)", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("workspace-nav").click();
  const btn = p.getByRole("button", { name: /^More actions for canvas / }).first();
  await btn.click();
  const menu = p.getByRole("menu", { name: /^Actions for canvas / });
  await expect(menu).toBeVisible();
  const b = (await btn.boundingBox())!;
  const m = (await menu.boundingBox())!;
  expect(Math.abs(m.y - (b.y + b.height))).toBeLessThan(12); // just under the button
  // Right edges line up, or (near the window's left edge) the menu is kept inside the window and still sits under its button.
  expect(b.x).toBeGreaterThanOrEqual(m.x - 1);
  expect(b.x + b.width).toBeLessThanOrEqual(m.x + m.width + 1);
  await p.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  expect(app.consoleErrors).toEqual([]);
});

test("the workspace can be renamed from the menu's whole-workspace section, and the name is kept (ADR 0079)", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("workspace-chevron").click();
  await expect(p.locator(".nav-ws h3")).toContainText("My workspace");
  await p.getByRole("button", { name: /^Rename the workspace/ }).click();
  await p.getByLabel("New workspace name").fill("Studio 2026");
  await p.keyboard.press("Enter");
  await expect(p.locator(".nav-ws h3")).toContainText("Studio 2026");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.getByTestId("workspace-chevron").click();
  await expect(p.locator(".nav-ws h3")).toContainText("Studio 2026");
  expect(app.consoleErrors).toEqual([]);
});

test("the board menu keeps long names and counts inside its edges (ADR 0079)", async ({ app }) => {
  const p = app.page;
  await p.keyboard.press("p");
  for (let i = 0; i < 5; i++) await app.drag({ x: 500 + i * 60, y: 420 }, { x: 530 + i * 60, y: 450 }, 3);
  await p.getByTestId("workspace-chevron").click();
  await p.getByRole("button", { name: /^More actions for canvas/ }).click();
  await p.getByRole("menuitem", { name: /^Rename canvas/ }).click();
  await p.locator(".nav-rename").fill("this is an awesome canvas with a very long name indeed");
  await p.keyboard.press("Enter");
  await p.getByRole("button", { name: /^More actions for board/ }).click();
  await p.getByRole("menuitem", { name: /^Rename board/ }).click();
  await p.locator(".nav-rename").fill("a board with a long name too");
  await p.keyboard.press("Enter");
  await expect(p.locator(".nav-count")).toContainText("objects");
  const menu = (await p.locator(".nav-menu").boundingBox())!;
  const over = await p.locator(".nav-menu button, .nav-menu h3, .nav-menu section").evaluateAll((els, right) => els.filter((e) => e.getBoundingClientRect().right > (right as number) + 0.5).map((e) => e.className || e.tagName), menu.x + menu.width);
  expect(over).toEqual([]);
  expect(app.consoleErrors).toEqual([]);
});

test("canvases and boards can be duplicated, moved up and down, and a canvas moved to another board (ADR 0110)", async ({ app }) => {
  const p = app.page;
  const objects = () => p.evaluate(() => window.__canvastDebug.objects().length);
  const names = () => p.locator(".nav-canvas .nav-name").allTextContents();
  await p.keyboard.press("p");
  for (let i = 0; i < 3; i++) await app.drag({ x: 500 + i * 60, y: 420 }, { x: 530 + i * 60, y: 450 }, 3);
  const n = await objects();
  expect(n).toBeGreaterThan(0);
  const first = (await p.evaluate(() => window.__canvastDebug.objects()))[0]!.id;
  await p.getByTestId("workspace-chevron").click();
  await p.getByRole("button", { name: /^More actions for canvas Canvas 1/ }).click();
  await p.getByRole("menuitem", { name: /^Duplicate canvas/ }).click();
  await expect(p.getByTestId("workspace-nav")).toContainText("Canvas 1 copy"); // the copy is open
  expect(await objects()).toBe(n);
  expect((await p.evaluate(() => window.__canvastDebug.objects())).some((o) => o.id === first), "new ids").toBe(false);

  // the copy sits after the original; move it up
  await p.getByTestId("workspace-chevron").click();
  expect(await names()).toEqual(["Canvas 1", "Canvas 1 copy"]);
  await p.getByRole("button", { name: /^More actions for canvas Canvas 1 copy/ }).click();
  await p.getByRole("menuitem", { name: /^Move canvas Canvas 1 copy up/ }).click();
  await expect.poll(names).toEqual(["Canvas 1 copy", "Canvas 1"]);

  // a second board; the copy moves to it (the open canvas stays open)
  await p.getByRole("button", { name: "+ New board" }).click();
  await p.getByTestId("workspace-chevron").click();
  await p.getByRole("button", { name: /^More actions for canvas Canvas 1 copy/ }).click();
  await p.getByRole("menuitem", { name: /^Move canvas Canvas 1 copy to board Board 2/ }).click();
  await p.getByTestId("workspace-chevron").click();
  await expect(p.locator(".nav-board").nth(1).locator(".nav-name")).toContainText(["Canvas 1", "Canvas 1 copy"]);
  await expect(p.locator(".nav-board").first().locator(".nav-name")).toHaveText(["Canvas 1"]);

  // a board is duplicated with its canvases, and moves
  await p.getByRole("button", { name: /^More actions for board Board 1/ }).click();
  await p.getByRole("menuitem", { name: /^Duplicate board/ }).click();
  await p.getByTestId("workspace-chevron").click();
  await expect(p.locator(".nav-board-name")).toHaveText(["Board 1", "Board 1 copy", "Board 2"]);
  await p.getByRole("button", { name: /^More actions for board Board 2/ }).click();
  await p.getByRole("menuitem", { name: /^Move board Board 2 up/ }).click();
  await expect(p.locator(".nav-board-name")).toHaveText(["Board 1", "Board 2", "Board 1 copy"]);
  expect(app.consoleErrors).toEqual([]);
});

test("several picked: each tag with how many have it, removed from all or added to the rest at once; tags typed with commas and a new folder go to all; a mixed folder shows counts, nothing ticked", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  const files = [0, 1, 2, 3].map((i) => ({ name: `p${i}.png`, mimeType: "image/png", buffer: makePng(4, 4, () => [40 * i, 90, 160, 255]) }));
  await p.getByTestId("assets-import-input").setInputFiles(files);
  await expect(cards(p)).toHaveCount(4);
  const hashes = await cards(p).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset["hash"]!));
  await addTags(p, hashes[0]!, "half");
  await addTags(p, hashes[1]!, "half");
  await expect(p.getByTestId("asset-tags")).toContainText("#half"); // (stored: the field gets the focus back after it)
  const all = async () =>
    expect(async () => {
      await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // (Ctrl+A in a text field selects its text)
      await p.keyboard.press("Control+a");
      await expect(p.getByTestId("bulk-tags")).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10000 });
  await all();
  const chip = p.getByTestId("bulk-tags").locator(".tag-chip", { hasText: "#half" });
  await expect(chip).toContainText("2/4");
  // + puts it on the rest
  await chip.getByRole("button", { name: "Add tag half to all 4" }).click();
  await expect(chip).not.toContainText("2/4");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.catalogEntries().then((es) => es.filter((e) => (e.tags ?? []).includes("half")).length))).toBe(4);
  // × takes it off all of them
  await chip.getByRole("button", { name: "Remove tag half from all 4" }).click();
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.catalogEntries().then((es) => es.filter((e) => (e.tags ?? []).length).length))).toBe(0);
  // two tags at once, to all
  await p.getByTestId("bulk-tag-input").fill("one, two");
  await p.getByTestId("bulk-tag-input").press("Enter");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.catalogEntries().then((es) => es.filter((e) => (e.tags ?? []).length === 2).length))).toBe(4);
  // a new folder for these, all moved in
  await p.getByTestId("bulk-new-folder").click();
  await p.getByTestId("prompt-dialog").locator("input").fill("Mix");
  await p.getByTestId("prompt-dialog").getByRole("button", { name: "Make and move" }).click();
  await expect(p.getByTestId("bulk-folders").getByRole("radio", { name: /Mix/ })).toBeChecked();
  // two of them out again: the four together are mixed (counts, no tick)
  await p.keyboard.press("Escape");
  await pick(p, hashes[0]!);
  await card(p, hashes[1]!).click({ modifiers: ["Shift"] });
  await p.getByTestId("bulk-folders").getByRole("radio", { name: "No folder" }).check();
  await p.keyboard.press("Escape");
  await pick(p, hashes[0]!);
  await all();
  await expect(p.getByTestId("bulk-folders").getByRole("radio", { name: /Mix/ })).not.toBeChecked();
  await expect(p.getByTestId("bulk-folders")).toContainText("2 of 4");
  expect(app.consoleErrors).toEqual([]);
});

test("the library's own undo and redo; items dragged onto a folder or a tag; a plain click picks one alone after Ctrl+A; picks a search hides are shown and can be dropped", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  const files = [0, 1, 2].map((i) => ({ name: `q${i}.png`, mimeType: "image/png", buffer: makePng(4, 4, () => [60 * i, 120, 90, 255]) }));
  await p.getByTestId("assets-import-input").setInputFiles(files);
  await expect(cards(p)).toHaveCount(3);
  const hashes = await cards(p).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset["hash"]!));
  const tagsOf = (h: string) => p.evaluate((x) => window.__canvastDebug.catalogEntries().then((es) => es.find((e) => e.hash === x)?.tags ?? []), h);
  const keyOutside = async (key: string) => {
    await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await p.keyboard.press(key);
  };
  // undo and redo, one step each
  await addTags(p, hashes[0]!, "keep");
  await expect.poll(() => tagsOf(hashes[0]!)).toEqual(["keep"]);
  await keyOutside("Control+z");
  await expect.poll(() => tagsOf(hashes[0]!)).toEqual([]);
  await keyOutside("Control+Shift+z");
  await expect.poll(() => tagsOf(hashes[0]!)).toEqual(["keep"]);
  // dragged onto a tag of the sidebar: tagged; onto a folder: moved in
  await card(p, hashes[1]!).dragTo(side(p, /#keep/));
  await expect.poll(() => tagsOf(hashes[1]!)).toEqual(["keep"]);
  await newFolder(p, "Box");
  await card(p, hashes[2]!).dragTo(side(p, /^Box/));
  await expect.poll(() => p.evaluate((x) => window.__canvastDebug.catalogEntries().then((es) => (es.find((e) => e.hash === x)?.folderIds ?? []).length), hashes[2]!)).toBe(1);
  // Ctrl+A, then a plain click: that one alone
  await keyOutside("Escape");
  await keyOutside("Control+a");
  await expect(p.getByText("3 selected")).toBeVisible();
  await card(p, hashes[1]!).click();
  await expect(card(p, hashes[1]!)).toHaveAttribute("aria-pressed", "true");
  await expect(card(p, hashes[0]!)).toHaveAttribute("aria-pressed", "false");
  // two picked, a search hides one: said, and it can be dropped
  await card(p, hashes[0]!).click({ modifiers: ["Control"] });
  await expect(p.getByText("2 selected")).toBeVisible();
  const name0 = await p.evaluate((x) => window.__canvastDebug.catalogEntries().then((es) => es.find((e) => e.hash === x)!.name), hashes[0]!);
  await p.getByTestId("assets-search").fill(name0);
  await expect(p.getByTestId("bulk-hidden")).toContainText("1 not shown");
  await p.getByTestId("bulk-hidden").click();
  await expect(card(p, hashes[0]!)).toHaveAttribute("aria-pressed", "true");
  await expect(p.getByTestId("bulk-hidden")).toHaveCount(0);
  expect(app.consoleErrors).toEqual([]);
});

test("a plain click picks without opening or closing the details panel, so nothing moves under the pointer; toggling the panel keeps the picked item where it is", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  const files = Array.from({ length: 40 }, (_, i) => ({ name: `g${i}.png`, mimeType: "image/png", buffer: makePng(8 + (i % 5) * 4, 8 + (i % 3) * 6, () => [6 * i, 100, 200, 255]) }));
  await p.getByTestId("assets-import-input").setInputFiles(files);
  await expect(cards(p)).toHaveCount(40);
  const panelButton = p.locator('.assets-bar [data-action="details"]');
  await panelButton.click(); // the panel closed
  await expect(p.getByTestId("asset-inspector")).toBeHidden();
  const c = cards(p).nth(17);
  const before = await c.boundingBox();
  await c.click();
  await expect(c).toHaveAttribute("aria-pressed", "true");
  expect(await c.boundingBox(), "the click did not open the panel: nothing moved").toEqual(before);
  // the panel opened again: the grid is narrower, the picked item keeps its height on the screen
  await panelButton.click();
  await expect(p.getByTestId("asset-inspector")).toBeVisible();
  await expect.poll(async () => Math.abs((await c.boundingBox())!.y - before!.y)).toBeLessThan(2);
  // with nothing picked the panel stays (and says so), so the grid does not change width
  await p.keyboard.press("Escape");
  await expect(p.getByTestId("inspector-empty")).toBeVisible();
  expect(app.consoleErrors).toEqual([]);
});

test("Delete everywhere: an item in use on two canvases goes from both and from the library; Undo on the open canvas brings its instance and the item back", async ({ app }) => {
  const p = app.page;
  const place = async () => {
    await p.getByTestId("import-input").setInputFiles({ name: "blocks.png", mimeType: "image/png", buffer: BLOCKS });
    await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().filter((o) => o.kind === "image").length)).toBe(1);
  };
  await place(); // Board 1 › Canvas 1
  await p.getByTestId("workspace-nav").click();
  await p.getByRole("button", { name: /^\+ New canvas/ }).click();
  await expect(p.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 2");
  await place(); // the same original again, on Canvas 2 (open)
  await p.getByTestId("view-assets").click();
  await pick(p, HASH);
  await expect(p.getByTestId("asset-delete")).toBeDisabled();
  await p.getByTestId("asset-delete-everywhere").click();
  await expect(p.getByTestId("confirm-dialog")).toContainText("used 2 times");
  await p.getByTestId("confirm-ok").click();
  const active = () => p.evaluate((h) => window.__canvastDebug.catalogEntries().then((es) => es.find((e) => e.hash === h)?.state), HASH);
  await expect.poll(active).toBe("deleted");
  const images = () => p.evaluate(async () => {
    const tree = window.__canvastDebug.session().tree!;
    const all = await Promise.all(tree.flatMap((b) => b.canvases.map((c) => window.__canvastDebug.canvasDump(c.id))));
    return all.reduce((n, d) => n + d.objects.filter((o) => o.kind === "image").length, 0);
  });
  await expect.poll(images, { message: "off both canvases" }).toBe(0);
  // on the open canvas, Undo brings its instance back, and with it the item
  await p.getByTestId("view-canvas").click();
  await p.keyboard.press("Control+z");
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().filter((o) => o.kind === "image").length)).toBe(1);
  await expect.poll(active).toBe("active");
  expect(app.consoleErrors).toEqual([]);
});
