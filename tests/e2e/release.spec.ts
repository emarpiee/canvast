import { mkdtempSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, firefox, test } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { buildDir } from "./build-dir";
import { exportWith, expect, outlineShapes } from "./harness";
import { makePng } from "./png";

/**
 * Phase 9 release gate (docs/testing/phase-9.md): the one built file, alone in a folder with spaces in its name, opened in a fresh browser profile
 * with the network off, does the core work and needs nothing else (no request, no CSP violation, no error); and a workspace written by one
 * browser engine is read back exactly by the other (project portability). Not a copy of the feature specs: they use the `app` fixture and the
 * debug build's own folder; this one is what a person who is handed the file gets.
 */
const PIC = makePng(60, 40, (x, y) => [x * 4, y * 6, 120, 255]);

interface Clean {
  context: BrowserContext;
  page: Page;
  dir: string;
  problems: string[];
}

/** The built file alone in a new folder, opened in a new profile that is offline. `problems` collects everything that must stay empty. */
async function cleanMachine(browser: Browser): Promise<Clean> {
  const dir = mkdtempSync(resolve(tmpdir(), "canvast release ✓ "));
  const file = resolve(dir, "canvast.html");
  copyFileSync(resolve(buildDir(), "canvast.html"), file); // (only this file: no picker folder, no build.json, nothing beside it)
  const context = await browser.newContext({ offline: true, viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const problems: string[] = [];
  context.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) problems.push(`request ${r.url()}`);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => ((window as unknown as { __csp: string[] }).__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`console ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`error ${e}`));
  await page.goto(pathToFileURL(file).href + "#debug");
  await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await page.evaluate(() => window.__canvastDebug.nextFrame());
  return { context, page, dir, problems };
}

const saved = (p: Page): Promise<void> => expect.poll(() => p.evaluate(() => window.__canvastDebug.saveStatus()), { timeout: 8000 }).toBe("verified");
const objectIds = (p: Page): Promise<string[]> => p.evaluate(() => window.__canvastDebug.objects().map((o) => String(o["id"])).sort());

/** What a person does first: ink, a shape, a text, a picture, far in and back out. */
async function coreWork(p: Page): Promise<void> {
  await p.keyboard.press("p");
  await p.mouse.move(300, 600);
  await p.mouse.down();
  await p.mouse.move(400, 640, { steps: 6 });
  await p.mouse.up();
  await p.keyboard.press("u");
  await p.locator('[data-shape-kind="rect"]').click();
  await p.mouse.move(420, 300);
  await p.mouse.down();
  await p.mouse.move(560, 380, { steps: 6 });
  await p.mouse.up();
  await p.keyboard.press("t");
  await p.mouse.click(700, 300);
  await expect(p.getByTestId("text-editor")).toBeFocused();
  await p.keyboard.type("Hello, canvast");
  await p.keyboard.press("Escape");
  await expect(p.getByTestId("text-editor")).toBeHidden();
  await p.keyboard.press("v");
  await p.getByTestId("import-input").setInputFiles({ name: "pic.png", mimeType: "image/png", buffer: PIC });
  await expect.poll(async () => (await objectIds(p)).length).toBe(4);
  await p.evaluate(() => window.__canvastDebug.jump(40));
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  await p.evaluate(() => window.__canvastDebug.jump(-40));
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  await saved(p);
}

/** The first bytes a file of each kind must start with. */
const MAGIC: Record<string, RegExp> = { png: /^\x89PNG/, svg: /^(<\?xml|<svg)/, pdf: /^%PDF-/ };

async function download(p: Page, click: () => Promise<void>): Promise<{ name: string; bytes: Buffer }> {
  const [dl] = await Promise.all([p.waitForEvent("download"), click()]);
  return { name: dl.suggestedFilename(), bytes: readFileSync((await dl.path())!) };
}

/** One format of the open Export dialog, downloaded and checked by its first bytes. */
async function downloadFormat(p: Page, format: string): Promise<void> {
  const dlg = p.getByTestId("export-dialog");
  await dlg.locator(`[data-format="${format}"]`).click();
  const file = await download(p, () => dlg.locator('[data-ex="download"]').click());
  expect(file.bytes.length, `${format} is not empty`).toBeGreaterThan(200);
  expect(file.bytes.subarray(0, 8).toString("latin1"), `${format} starts like one`).toMatch(MAGIC[format]!);
}

/** PNG of everything (the picture too); SVG and PDF are for vectors only, so of the rectangle. */
async function exportAll(p: Page): Promise<void> {
  const dlg = p.getByTestId("export-dialog");
  await p.keyboard.press("v");
  await p.keyboard.press("Control+a");
  await exportWith(p, "exportpic");
  await downloadFormat(p, "png");
  await dlg.locator('[data-ex="close"]').click();
  await expect(dlg).toBeHidden();
  await p.mouse.click(1, 1);
  await p.mouse.click(490, 340); // inside the rectangle
  await exportWith(p, "exportpic");
  await downloadFormat(p, "svg");
  await downloadFormat(p, "pdf");
  await dlg.locator('[data-ex="close"]').click();
  await expect(dlg).toBeHidden();
}

async function exportWorkspace(p: Page): Promise<{ name: string; bytes: Buffer }> {
  if (await p.getByTestId("set-export-full").isHidden()) await p.getByTestId("save-status").click();
  await expect(p.getByTestId("set-export-full")).toBeVisible();
  return download(p, () => p.getByTestId("set-export-full").click());
}

async function importWorkspace(p: Page, name: string, bytes: Buffer): Promise<void> {
  if (await p.getByTestId("set-export-full").isHidden()) await p.getByTestId("save-status").click();
  await p.getByTestId("set-import-input").setInputFiles({ name, mimeType: "application/zip", buffer: bytes });
  const dlg = p.getByTestId("confirm-dialog");
  await expect(dlg).toBeVisible();
  await p.getByTestId("toast").evaluate((t) => (t.textContent = ""));
  await p.getByTestId("confirm-ok").click();
  await expect(dlg).toHaveCount(0);
  await expect(p.getByTestId("toast")).toContainText(/Imported|Import failed/);
}

/** Every canvas that holds something (a profile's own empty canvas is left out): objects, saved view and bookmarks. */
async function dumps(p: Page): Promise<unknown[]> {
  const tree = (await p.evaluate(() => window.__canvastDebug.session())).tree!;
  const all = await Promise.all(tree.flatMap((b) => b.canvases.map((c) => p.evaluate((id) => window.__canvastDebug.canvasDump(id), c.id))));
  return all.filter((d) => d.objects.length > 0);
}

test("the one built file, alone in a folder with spaces, in a fresh offline profile: core work, reload, export and backup with no request, violation or error", async ({ browser }) => {
  const m = await cleanMachine(browser);
  const p = m.page;
  try {
    await outlineShapes(p); // (the SVG export measured below has an outline in it)
    await coreWork(p);
    const ids = await objectIds(p);
    expect(ids.length).toBe(4);
    expect(await p.evaluate(() => window.__canvastDebug.inkedPixels(2)), "something is drawn").toBeGreaterThan(100);
    await p.reload();
    await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
    await p.evaluate(() => window.__canvastDebug.nextFrame());
    expect(await objectIds(p), "the same objects after a reload").toEqual(ids);
    await exportAll(p);
    const file = await exportWorkspace(p);
    expect(file.name).toMatch(/\.canvast$/);
    expect(file.bytes.subarray(0, 2).toString("latin1"), "a ZIP").toBe("PK");
    expect(await p.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []), "no CSP violation").toEqual([]);
    expect(m.problems, "nothing asked for, nothing failed").toEqual([]);
  } finally {
    await m.context.close();
    rmSync(m.dir, { recursive: true, force: true });
  }
});

test("a workspace written by Chromium is read back exactly by Firefox, and the one Firefox writes back by Chromium (project portability)", async ({}, info) => {
  test.skip(info.project.name !== "chromium", "both engines are launched here; one project runs it");
  const [a, b] = [await chromium.launch(), await firefox.launch()];
  try {
    const src = await cleanMachine(a);
    await coreWork(src.page);
    const original = await dumps(src.page);
    const out = await exportWorkspace(src.page);
    expect(src.problems).toEqual([]);

    const fx = await cleanMachine(b);
    await importWorkspace(fx.page, out.name, out.bytes);
    expect(await dumps(fx.page), "Firefox holds exactly what Chromium wrote (ids, exact anchors, views)").toEqual(original);
    const back = await exportWorkspace(fx.page);
    expect(fx.problems).toEqual([]);

    const cr = await cleanMachine(a);
    await importWorkspace(cr.page, back.name, back.bytes);
    expect(await dumps(cr.page), "and Chromium reads back what Firefox wrote").toEqual(original);
    expect(cr.problems).toEqual([]);
    for (const m of [src, fx, cr]) {
      await m.context.close();
      rmSync(m.dir, { recursive: true, force: true });
    }
  } finally {
    await a.close();
    await b.close();
  }
});
