import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

/** The pattern generators as a package (src/gen/README.md): the demo page, built on its own, from the standalone script. No canvast code is loaded. */
// the demo page: the snapshot's own copy (`npm run test:snap`, CANVAST_PATTERNS_DIR), else `dist-patterns/` (`npm run build:patterns`)
const DIR = process.env["CANVAST_PATTERNS_DIR"] ? resolve(process.env["CANVAST_PATTERNS_DIR"]) : fileURLToPath(new URL("../../dist-patterns", import.meta.url));
const DEMO = `file://${resolve(DIR, "demo.html")}`;

test("pattern package: every generator is in the gallery, the same seed gives the same SVG, Randomize changes it, and the settings are built from the generator", async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("request", (r) => !/^(file|data|blob):/.test(r.url()) && requests.push(r.url()));
  await page.goto(DEMO);

  const count = await page.evaluate(() => (window as unknown as { CanvastPatterns: { GENERATORS: unknown[] } }).CanvastPatterns.GENERATORS.length);
  expect(count).toBeGreaterThan(30);
  await expect(page.locator(".card")).toHaveCount(count);
  expect(await page.locator(".card svg path").count()).toBeGreaterThan(count); // every card is drawn

  // a generator's own settings, and a seed that always gives the same picture
  await page.locator('.card[data-id="tides"]').click();
  await expect(page.locator('#settings [data-key="layers"]')).toBeVisible();
  const svg = () => page.evaluate(() => (window as unknown as { lastSvg: string }).lastSvg);
  await page.locator("#seed").fill("42");
  await page.locator("#seed").dispatchEvent("change");
  const a = await svg();
  await page.locator('.card[data-id="stripes"]').click();
  await page.locator('.card[data-id="tides"]').click();
  await page.locator("#seed").fill("42");
  await page.locator("#seed").dispatchEvent("change");
  expect(await svg()).toBe(a);
  expect(a).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 900 600"/);

  // a setting changes the picture; Randomize changes the seed and the settings
  const layers = page.locator('#settings [data-key="layers"] input');
  await layers.fill("3");
  await layers.dispatchEvent("input");
  expect(await svg()).not.toBe(a);
  await page.locator("#random").click();
  expect(await page.locator("#seed").inputValue()).not.toBe("42");
  expect(await svg()).not.toBe(a);

  // the module and the declarations are built too
  const { existsSync } = await import("node:fs");
  for (const f of ["canvast-patterns.mjs", "types/index.d.ts"]) expect(existsSync(resolve(DIR, f)), f).toBe(true);
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

test("pattern package: the seed changes every generator (the exact ones too, once Looseness is raised), and exact settings stay exact", async ({ page }) => {
  await page.goto(DEMO);
  const r = await page.evaluate(() => {
    const P = (window as unknown as { CanvastPatterns: { GENERATORS: Array<{ id: string; sections: Array<{ items: Array<{ k: string }> }> }>; defaultValues(g: unknown): Record<string, unknown>; generate(g: unknown, v: unknown, s: number, w: number, h: number): unknown } }).CanvastPatterns;
    const sig = (g: unknown, v: unknown, s: number) => JSON.stringify(P.generate(g, v, s, 900, 600));
    const same: string[] = [], loose: string[] = [];
    for (const g of P.GENERATORS) {
      const v = P.defaultValues(g);
      const j = g.sections.some((x) => x.items.some((i) => i.k === "jitter"));
      if (!j) { loose.push(g.id); continue; }
      if (sig(g, { ...v, jitter: 60 }, 1) === sig(g, { ...v, jitter: 60 }, 2)) same.push(g.id);
      if (sig(g, { ...v, jitter: 0 }, 1) !== sig(g, { ...v, jitter: 0 }, 2) && ["stripes", "chevrons", "checks", "rings", "spiral", "grid", "halftone", "scales", "weave"].includes(g.id)) same.push(`${g.id} (not exact at 0)`);
    }
    // the generators with no Looseness vary with the seed already
    const stillSame = loose.filter((id) => { const g = P.GENERATORS.find((x) => x.id === id)!; return sig(g, P.defaultValues(g), 1) === sig(g, P.defaultValues(g), 2); });
    return { same, stillSame };
  });
  expect(r.same, "the seed moves them once Looseness is up (and Looseness 0 is exact)").toEqual([]);
  expect(r.stillSame, "no generator without Looseness ignores the seed").toEqual([]);
});
