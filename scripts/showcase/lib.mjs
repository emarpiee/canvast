// What the README's screenshot scripts share: a fresh profile of the app (dark, the default theme colour), waiting for frames, taking a
// picture without notices or a stray pointer, the public-domain artworks (scripts/showcase/art, art.json: where each comes from) and the
// steps that build a scene. Each picture is its own step: one that fails is logged and the others are still taken.
import { chromium } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** The artworks: files in scripts/showcase/art with their artist, title, date and source (all public domain, The Met Open Access). */
export const ART = JSON.parse(readFileSync(resolve("scripts/showcase/art/art.json"), "utf8"));
export const artPath = (file) => resolve("scripts/showcase/art", file);
/** The artworks whose file name starts with one of these (an artist, or artist-title). */
export const artOf = (...starts) => ART.filter((a) => starts.some((s) => a.file.startsWith(s))).map((a) => a.file);

export async function open(out, { width = 1440, height = 900, args = [] } = {}) {
  const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cv-shots-"));
  const ctx = await chromium.launchPersistentContext(join(work, "profile"), { viewport: { width, height }, colorScheme: "dark", args });
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  p.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
  await p.goto("file://" + process.cwd() + "/dist/canvast.html#debug");
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
  const H = (fn, arg) => p.evaluate(fn, arg);
  const frame = () => H(() => window.__canvastDebug.nextFrame());
  const settle = async (ms = 600) => { await frame(); await p.waitForTimeout(ms); await frame(); };
  const quiet = () => H(() => { for (const b of document.querySelectorAll(".notice-close")) b.click(); getSelection()?.removeAllRanges(); });
  let failed = 0;
  const shot = async (name, clip) => {
    await quiet();
    await settle();
    await quiet();
    await settle(300);
    await p.screenshot({ path: `${out}/${name}.png`, ...(clip ? { clip } : {}) });
    console.log("shot", name);
  };
  /** One picture: its steps, then the shot; a failure is said and the next picture goes on (with Escape pressed to leave what was open). */
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      failed++;
      console.log("FAILED", name, String(e).split("\n")[0]);
      for (let i = 0; i < 3; i++) await p.keyboard.press("Escape").catch(() => undefined);
    }
  };
  const off = () => p.mouse.move(width / 2, height - 7); // (the pointer on the status bar: no hover outlines)
  const blur = () => H(() => document.activeElement?.blur());
  const drag = async (a, b, steps = 8) => {
    await p.mouse.move(a[0], a[1]);
    await p.mouse.down();
    await p.mouse.move(b[0], b[1], { steps });
    await p.mouse.up();
  };
  /** A line through these points with the pointer held: a pen stroke, a lasso. */
  const stroke = async (pts) => {
    await p.mouse.move(pts[0][0], pts[0][1]);
    await p.mouse.down();
    for (const [x, y] of pts.slice(1)) await p.mouse.move(x, y, { steps: 3 });
    await p.mouse.up();
  };
  const menu = async (button, id) => {
    const b = p.locator(`[data-ctx="${button}"]`);
    if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
    await p.locator(`.pop-menu [data-id="${id}"]`).click();
    if ((await b.getAttribute("aria-expanded")) === "true") await p.keyboard.press("Escape");
    await blur();
  };
  const panel = async (name, on = true) => {
    const btn = p.getByRole("button", { name, exact: true });
    if (((await btn.getAttribute("aria-pressed")) === "true") !== on) await btn.click();
    await settle(400);
  };
  /** A new canvas in the first board, named, and open. */
  const newCanvas = async (name) => {
    const tree = await H(() => window.__canvastDebug.session().tree);
    await H((id) => window.__canvastDebug.workspaceOp("newCanvas", id), tree[0].id);
    const now = (await H(() => window.__canvastDebug.session().tree))[0];
    const c = now.canvases[now.canvases.length - 1];
    await H(([id, n]) => window.__canvastDebug.workspaceOp("renameCanvas", id, n), [c.id, name]);
    await p.getByTestId("workspace-nav").click();
    await p.getByTestId("workspace-menu").getByText(name, { exact: true }).click();
    if (await p.getByTestId("workspace-menu").isVisible()) await p.keyboard.press("Escape");
    await blur();
    await settle();
  };
  /** Import files into the library (the Library view is left open); the hash of each, by its file name. */
  const importFiles = async (files) => {
    await p.getByTestId("view-assets").click();
    await p.getByTestId("assets-import-input").setInputFiles(files);
    const names = files.map((f) => (typeof f === "string" ? f.split("/").pop() : f.name));
    const hashes = {};
    for (let t = 0; t < 120 && Object.keys(hashes).length < names.length; t++) {
      const entries = await H(() => window.__canvastDebug.catalogEntries());
      for (const e of entries) if (names.includes(e.name)) hashes[e.name] = e.hash;
      if (Object.keys(hashes).length < names.length) await p.waitForTimeout(500);
    }
    await settle(800);
    return hashes;
  };
  /** Place library items on the open canvas (each in the middle of the view), and the ids of what was placed. */
  const place = async (hashes) => {
    const ids = [];
    for (const h of hashes) ids.push(await H((x) => window.__canvastDebug.placeFromLibrary(x), h));
    await settle(400);
    return ids;
  };
  const select = (ids) => H((x) => window.__canvastDebug.select(x), ids);
  const boxOf = async (id) => (await H((i) => window.__canvastDebug.objectScreen(i), id))?.box ?? null;
  /** The view fitted to these objects (all of them when none are given), through the Fit selection button: no keys, so no field takes them. */
  const fit = async (ids) => {
    await blur();
    await select(ids ?? (await H(() => window.__canvastDebug.objects())).map((o) => o.id));
    await settle(200);
    await p.locator('[data-action="fit-selection"]').click();
    await settle(900);
    await select([]);
    await settle(300);
  };
  const done = async () => {
    await ctx.close();
    if (failed) console.log(`${failed} picture(s) FAILED`);
  };
  return { p, ctx, H, frame, settle, shot, step, off, blur, drag, stroke, menu, panel, newCanvas, importFiles, place, select, boxOf, fit, done, work };
}
