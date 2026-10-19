import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { buildDir } from "./build-dir";

/**
 * The low-memory tier (Phase 8, ADR 0155): a device that says it has 1 GB gets a 128 MB budget for decoded pictures, and a normal one 384 MB;
 * a choice made in Settings is kept over the tier.
 */
const url = pathToFileURL(resolve(buildDir(), "canvast.html")).href + "#debug";
const budgetMb = (page: import("@playwright/test").Page) => page.evaluate(() => window.__canvastDebug.decodedStats().budget / 2 ** 20);

test("a device with 1 GB of memory starts at 128 MB for decoded pictures, a normal one at 384 MB", async ({ browser }) => {
  const low = await browser.newContext();
  await low.addInitScript(() => Object.defineProperty(Navigator.prototype, "deviceMemory", { get: () => 1, configurable: true }));
  const a = await low.newPage();
  await a.goto(url);
  await a.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  expect(await budgetMb(a)).toBe(128);
  await low.close();
  const normal = await browser.newContext();
  const b = await normal.newPage();
  await b.goto(url);
  await b.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  expect(await budgetMb(b)).toBe(384);
  await normal.close();
});
