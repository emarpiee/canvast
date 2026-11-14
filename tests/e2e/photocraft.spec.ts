import type { Page } from "@playwright/test";
import { expect, test } from "./harness";
import type { App } from "./harness";
import { makePng } from "./png";

/**
 * PhotoCraft (src/artcraft/photocraft/): its released web build runs in a frame of its own; canvast stands in for its file picker (the
 * library chooser) and its downloads (back to the library and the canvas). What happens inside its own interface is PhotoCraft's.
 */

type Pic = { id: string; kind: string };
const objs = async (app: App): Promise<Pic[]> => (await app.page.evaluate(() => window.__canvastDebug.objects())) as unknown as Pic[];

async function place(app: App, name: string): Promise<Pic> {
  const before = (await objs(app)).length;
  await app.page.getByTestId("import-input").setInputFiles({ name, mimeType: "image/png", buffer: makePng(90, 60, (x, y) => [x * 2, y * 4, 120, 255]) });
  await expect.poll(async () => (await objs(app)).length).toBe(before + 1);
  await app.frame();
  return (await objs(app)).at(-1)!;
}

/** Whether this browser can draw PhotoCraft (it needs WebGPU or WebGL2: a test machine's headless Firefox has neither). */
const canDraw = (p: Page): Promise<boolean> => p.evaluate(() => !!(navigator as Navigator & { gpu?: unknown }).gpu || !!document.createElement("canvas").getContext("webgl2"));

/**
 * Selects the picture and opens it in PhotoCraft from the Actions bar; resolves once PhotoCraft runs (its loading message is gone). Where
 * the browser cannot draw it, canvast says it could not start, and the test ends there.
 */
async function editInPhotoCraft(app: App, pic: Pic): Promise<void> {
  const p = app.page;
  await p.evaluate((id) => window.__canvastDebug.select([id]), pic.id);
  await app.frame();
  await p.locator('[data-ctx="photocraft"]').click();
  await running(p);
}

/** Its view is shown and it runs; where the browser cannot draw it, canvast says it could not start, and the test ends there. */
async function running(p: Page): Promise<void> {
  await expect(p.getByTestId("photocraft-view")).toBeVisible();
  if (!(await canDraw(p))) {
    await expect(p.locator(".photocraft-status")).toContainText("could not start", { timeout: 120_000 });
    test.skip(true, "no WebGPU or WebGL2 in this browser: PhotoCraft cannot draw (canvast said so)");
  }
  await expect.poll(() => p.evaluate(() => {
    const d = document.querySelector<HTMLIFrameElement>(".photocraft-frame")?.contentDocument;
    const stopped = d?.getElementById("photocraft_stopped");
    if (stopped && !stopped.hidden) return `stopped: ${stopped.textContent}`;
    return !!d?.getElementById("photocraft_canvas") && !d.getElementById("photocraft_loading") ? "running" : "starting";
  }), { timeout: 120_000 }).toBe("running");
}

/** What PhotoCraft's Save does in a browser: a download of a blob, made in its frame (the frame hands it to canvast). */
const saveFromPhotoCraft = (p: Page, name: string, png: Buffer): Promise<void> =>
  p.evaluate(([n, bytes]) => {
    const w = document.querySelector<HTMLIFrameElement>(".photocraft-frame")!.contentWindow! as Window & typeof globalThis;
    const a = w.document.createElement("a");
    a.href = w.URL.createObjectURL(new w.Blob([new w.Uint8Array(bytes as number[])], { type: "image/png" }));
    a.download = n as string;
    w.document.body.append(a);
    a.click();
    a.remove();
  }, [name, [...png]] as const);

test("PhotoCraft opens a selected picture; its File > Open asks the library, and cancelling leaves it running", async ({ app }) => {
  const p = app.page;
  const pic = await place(app, "harbour.png");
  await editInPhotoCraft(app, pic);
  // its own shortcut, in its own frame: canvast's library chooser answers, not the browser's file picker
  await p.frameLocator(".photocraft-frame").locator("#photocraft_canvas").click({ position: { x: 300, y: 300 } });
  await p.keyboard.press("Control+o");
  await expect(p.locator(".lib-pick")).toBeVisible({ timeout: 20_000 });
  await expect(p.locator(".lib-pick")).toContainText("harbour.png");
  await p.keyboard.press("Escape");
  await expect(p.locator(".lib-pick")).toBeHidden();
  // a view of its own: the Library shown, then PhotoCraft again, still running (its frame kept)
  await p.getByTestId("view-assets").click();
  await expect(p.getByTestId("photocraft-view")).toBeHidden();
  await p.getByTestId("view-photocraft").click();
  await running(p);
  await expect(p.locator(".photocraft-frame")).toHaveCount(1);
  // its preferences, as it saves them, are kept with the workspace
  await p.evaluate(() => document.querySelector<HTMLIFrameElement>(".photocraft-frame")!.contentWindow!.localStorage.setItem("photocraft.preferences", '{"version":2,"probe":7}'));
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.getSetting("photocraft.prefs"))).toContain('"probe":7');
  expect(await p.evaluate(() => document.querySelector<HTMLIFrameElement>(".photocraft-frame")!.contentDocument!.getElementById("photocraft_stopped")!.hidden)).toBe(true);
});

test("what PhotoCraft saves comes back: asked, added beside, Don't ask again kept; closed from its tab without asking once saved", async ({ app }) => {
  const p = app.page;
  const pic = await place(app, "harbour.png");
  await editInPhotoCraft(app, pic);
  const edited = makePng(90, 60, () => [200, 40, 40, 255]);
  await saveFromPhotoCraft(p, "harbour.png", edited);
  await expect(p.getByTestId("choose-dialog")).toBeVisible();
  await p.getByTestId("choose-dialog").locator('input[value="beside"]').check();
  await p.getByTestId("choose-remember").check();
  await p.getByTestId("choose-ok").click();
  await expect.poll(async () => (await objs(app)).length).toBe(2);
  expect(await p.evaluate(() => window.__canvastDebug.getSetting("photocraft.saveCanvas"))).toBe("beside");
  // a new library item, named after the original (Settings > Saving to the library > Edited pictures), the original kept
  const names = (await p.evaluate(() => window.__canvastDebug.assetListing())).entries.map((e) => e.name).sort();
  expect(names).toEqual(["harbour-edited.png", "harbour.png"]);
  // not asked again
  await saveFromPhotoCraft(p, "harbour-v2.png", makePng(90, 60, () => [40, 200, 40, 255]));
  await expect.poll(async () => (await objs(app)).length).toBe(3);
  await expect(p.getByTestId("choose-dialog")).toBeHidden();
  // close: the view and its frame go
  // (its tab's ×; nothing was done in it since its last save, so it is not asked about unsaved changes)
  await p.getByTestId("photocraft-close").click();
  await expect(p.getByTestId("confirm-dialog")).toBeHidden();
  await expect(p.getByTestId("photocraft-view")).toBeHidden();
  await expect(p.locator(".photocraft-frame")).toHaveCount(0);
});

test("two pictures as layers of one document: the size asked as Export asks, what it saves placed beside them", async ({ app }) => {
  const p = app.page;
  const a = await place(app, "left.png");
  const b = await place(app, "right.png");
  await p.evaluate((ids) => window.__canvastDebug.select(ids), [a.id, b.id]);
  await app.frame();
  await p.locator('[data-ctx="photocraft"]').click();
  await p.locator('[data-id="photocraft-layers"]').click();
  await expect(p.getByTestId("photocraft-size")).toBeVisible();
  await expect(p.getByTestId("photocraft-size")).toContainText("2 layers");
  await p.getByTestId("photocraft-size-ok").click();
  await running(p);
  // (PhotoCraft names the document after the project file, pictures.ora: a save of it comes back beside the two pictures, not asked)
  await saveFromPhotoCraft(p, "pictures.png", makePng(180, 60, () => [90, 90, 200, 255]));
  await expect.poll(async () => (await objs(app)).length).toBe(3);
  await expect(p.getByTestId("choose-dialog")).toBeHidden();
});
