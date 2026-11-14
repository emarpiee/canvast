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

/** The names of the library's items, but PhotoCraft's own presets pack (it keeps it there while it runs). */
const itemNames = async (p: Page): Promise<string[]> => (await p.evaluate(() => window.__canvastDebug.assetListing())).entries.map((e) => e.name).filter((n) => n !== "photocraft-presets.zip").sort();

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
const saveFromPhotoCraft = (p: Page, name: string, bytes: Buffer, type = "image/png"): Promise<void> =>
  p.evaluate(([n, b, t]) => {
    const w = document.querySelector<HTMLIFrameElement>(".photocraft-frame")!.contentWindow! as Window & typeof globalThis;
    const a = w.document.createElement("a");
    a.href = w.URL.createObjectURL(new w.Blob([new w.Uint8Array(b as number[])], { type: t as string }));
    a.download = n as string;
    w.document.body.append(a);
    a.click();
    a.remove();
  }, [name, [...bytes], type] as const);

/** A Photoshop file as PhotoCraft's page saves one: 8 bits, RGB, its merged picture stored as it is (`rgb` for every pixel). */
function makePsd(w: number, h: number, rgb: readonly [number, number, number]): Buffer {
  const head = Buffer.alloc(26);
  head.write("8BPS", 0, "latin1");
  head.writeUInt16BE(1, 4);
  head.writeUInt16BE(3, 12);
  head.writeUInt32BE(h, 14);
  head.writeUInt32BE(w, 18);
  head.writeUInt16BE(8, 22);
  head.writeUInt16BE(3, 24);
  const lengths = Buffer.alloc(12); // (no colour mode data, no image resources, no layers)
  const planes = Buffer.concat(rgb.map((c) => Buffer.alloc(w * h, c)));
  return Buffer.concat([head, lengths, Buffer.from([0, 0]), planes]);
}

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
  // a picker of another kind (its Import Shortcuts asks for "kys,json", without dots): only files of that kind are offered
  await p.evaluate(() => {
    const d = document.querySelector<HTMLIFrameElement>(".photocraft-frame")!.contentDocument!;
    const i = d.createElement("input");
    i.type = "file";
    i.accept = "kys,json";
    i.click();
  });
  await expect(p.locator(".lib-pick")).toBeVisible();
  await expect(p.locator(".lib-pick .lib-item")).toHaveCount(0);
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
  // a PSD of the library saved as PSD is a new version of that item, in its place: no copy, and no question of its type
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "sketch.psd", mimeType: "image/vnd.adobe.photoshop", buffer: Buffer.from("8BPS not a real one") });
  await p.getByTestId("asset-card").filter({ hasText: "sketch.psd" }).click();
  await p.getByTestId("asset-photocraft").click();
  await running(p);
  await saveFromPhotoCraft(p, "sketch.psd", makePng(20, 20, () => [1, 2, 3, 255]));
  await expect.poll(() => itemNames(p)).toEqual(["harbour.png", "sketch.psd"]);
  await expect(p.getByTestId("choose-dialog")).toBeHidden();
  expect(await p.evaluate(() => document.querySelector<HTMLIFrameElement>(".photocraft-frame")!.contentDocument!.getElementById("photocraft_stopped")!.hidden)).toBe(true);
});

test("a picture saved in PhotoCraft is saved into its file, as Save does on a desktop; Save a Copy goes beside it; closed from its tab without asking once saved", async ({ app }) => {
  const p = app.page;
  const pic = await place(app, "harbour.png");
  await editInPhotoCraft(app, pic);
  // Save: into harbour.png itself (a new version in its place), not asked, no copy
  await saveFromPhotoCraft(p, "harbour.png", makePng(90, 60, () => [200, 40, 40, 255]));
  await expect.poll(() => itemNames(p)).toEqual(["harbour.png"]);
  const hashes = async (): Promise<string[]> => (await p.evaluate(() => window.__canvastDebug.assetListing())).entries.filter((e) => e.name === "harbour.png").map((e) => e.hash);
  const first = await hashes();
  await expect(p.getByTestId("choose-dialog")).toBeHidden();
  expect((await objs(app)).length).toBe(1);
  // saved again: still that one file, its newer version
  await saveFromPhotoCraft(p, "harbour.png", makePng(90, 60, () => [10, 10, 220, 255]));
  await expect.poll(hashes).not.toEqual(first);
  // (the new version comes in, then the older one goes to the trash)
  await expect.poll(() => itemNames(p)).toEqual(["harbour.png"]);
  // Save a Copy (another name): a new item, beside the picture
  await saveFromPhotoCraft(p, "harbour copy.png", makePng(90, 60, () => [40, 200, 40, 255]));
  await expect.poll(() => itemNames(p)).toEqual(["harbour copy.png", "harbour.png"]);
  await expect.poll(async () => (await objs(app)).length).toBe(2);
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
  // (its layers are drawn while it starts: the project is in it once the view is no longer busy)
  await expect(p.locator('[data-testid="photocraft-view"]:not([data-busy])')).toBeVisible({ timeout: 60_000 });
  // (PhotoCraft names the document after the project file, pictures.ora: a save of it comes back beside the two pictures, not asked)
  await saveFromPhotoCraft(p, "pictures.png", makePng(180, 60, () => [90, 90, 200, 255]));
  await expect.poll(async () => (await objs(app)).length).toBe(3);
  await expect(p.getByTestId("choose-dialog")).toBeHidden();
});

test("PhotoCraft's own settings survive a restart: its theme (which its web build sets to Pro at each start) is applied again by its own command, its shortcuts and toolbar kept", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-photocraft").click();
  await running(p);
  // what PhotoCraft saves when its theme, a shortcut and its toolbar are changed in it (its preferences, in the browser's storage)
  const chosen = { version: 2, interface: { theme: "solarizedDark", appearanceMode: "dark", darkTheme: "solarizedDark" }, shortcuts: { "file.new": "Cmd+Alt+Shift+N" }, toolbar: { hidden: ["Sponge"], order: [] } };
  // (chosen in it: a press in it first, as any change there begins with one)
  await p.evaluate((t) => {
    const w = document.querySelector<HTMLIFrameElement>(".photocraft-frame")!.contentWindow! as Window & typeof globalThis;
    w.document.body.dispatchEvent(new w.Event("pointerdown", { bubbles: true }));
    w.localStorage.setItem("photocraft.preferences", t);
  }, JSON.stringify(chosen));
  await expect.poll(() => p.evaluate(() => String(window.__canvastDebug.getSetting("photocraft.prefs")))).toContain("solarizedDark");
  await p.getByTestId("photocraft-close").click();
  await expect(p.getByTestId("photocraft-view")).toBeHidden();
  await p.evaluate(() => window.__canvastDebug.flushSave());
  // the app started again
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.getByTestId("view-photocraft").click();
  await running(p);
  // PhotoCraft's preferences as it holds them now (it saves them when they change): the theme chosen, applied by its own Window › Theme command
  const held = (): Promise<{ interface?: Record<string, unknown>; shortcuts?: Record<string, string>; toolbar?: { hidden?: string[] } }> =>
    p.evaluate(() => JSON.parse(document.querySelector<HTMLIFrameElement>(".photocraft-frame")!.contentWindow!.localStorage.getItem("photocraft.preferences") ?? "{}"));
  await expect.poll(async () => (await held()).interface?.["darkTheme"], { timeout: 20_000 }).toBe("solarizedDark");
  const now = await held();
  expect(now.interface?.["appearanceMode"]).toBe("dark");
  expect(now.shortcuts?.["file.new"]).toBe("Cmd+Alt+Shift+N");
  expect(now.toolbar?.hidden).toContain("Sponge");
  // the keys canvast gave its theme commands for the start are not kept in the workspace
  const kept = JSON.parse(String(await p.evaluate(() => window.__canvastDebug.getSetting("photocraft.prefs")))) as { shortcuts?: Record<string, string> };
  expect(Object.values(kept.shortcuts ?? {})).not.toContain("F13");
});

test("a file of any kind saved in PhotoCraft goes back into that file, session after session: never a copy, never -edited", async ({ app }) => {
  const p = app.page;
  const png = makePng(40, 30, () => [90, 120, 200, 255]);
  // (what is in the library, and what PhotoCraft's page hands back for it: a picture comes back as PSD, its layers kept; a PSD or an
  // OpenRaster file as itself)
  const kinds: Array<{ name: string; type: string; back: (n: number) => { name: string; bytes: Buffer; type: string } }> = [
    { name: "art.png", type: "image/png", back: (n) => ({ name: "art.psd", bytes: makePsd(40, 30, [n * 40, 10, 10]), type: "image/vnd.adobe.photoshop" }) },
    { name: "photo.jpg", type: "image/jpeg", back: (n) => ({ name: "photo.psd", bytes: makePsd(40, 30, [10, n * 40, 10]), type: "image/vnd.adobe.photoshop" }) },
    { name: "shot.webp", type: "image/webp", back: (n) => ({ name: "shot.psd", bytes: makePsd(40, 30, [10, 10, n * 40]), type: "image/vnd.adobe.photoshop" }) },
    { name: "sketch.psd", type: "image/vnd.adobe.photoshop", back: (n) => ({ name: "sketch.psd", bytes: makePsd(40, 30, [n * 30, n * 30, 10]), type: "image/vnd.adobe.photoshop" }) },
    { name: "paint.ora", type: "image/openraster", back: (n) => ({ name: "paint.ora", bytes: Buffer.concat([png, Buffer.from([n])]), type: "image/openraster" }) },
  ];
  await p.getByTestId("view-assets").click();
  for (const k of kinds) await p.getByTestId("assets-import-input").setInputFiles({ name: k.name, mimeType: k.type, buffer: k.name.endsWith(".psd") ? makePsd(40, 30, [5, 5, 5]) : png });
  const names = kinds.map((k) => k.name).sort();
  await expect.poll(() => itemNames(p)).toEqual(names);
  for (const session of [1, 2]) {
    for (const k of kinds) {
      await p.getByTestId("view-assets").click();
      await p.getByTestId("asset-card").filter({ hasText: k.name }).first().click();
      await p.getByTestId("asset-photocraft").click();
      await running(p);
      const before = (await p.evaluate(() => window.__canvastDebug.assetListing())).entries.find((e) => e.name === k.name)?.hash;
      const out = k.back(session);
      await saveFromPhotoCraft(p, out.name, out.bytes, out.type);
      // a new version of that file, in its place: the same name, newer bytes, nothing added and no question
      await expect.poll(async () => (await p.evaluate(() => window.__canvastDebug.assetListing())).entries.find((e) => e.name === k.name)?.hash).not.toBe(before);
      await expect.poll(() => itemNames(p)).toEqual(names);
      await expect(p.getByTestId("choose-dialog")).toBeHidden();
    }
    // PhotoCraft closed and opened again: what it saves of the same files still goes into them
    await p.getByTestId("photocraft-close").click();
    if (await p.getByTestId("confirm-dialog").isVisible().catch(() => false)) await p.getByTestId("confirm-ok").click();
    await expect(p.getByTestId("photocraft-view")).toBeHidden();
  }
  expect((await itemNames(p)).some((n) => n.includes("-edited"))).toBe(false);
});
