import { expect, test as base } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DebugHook } from "../../src/app/debug-hook";
import type { SerializedCamera } from "../../src/core/camera";

/**
 * Acceptance thresholds, fixed before the Phase 0A runs (see
 * docs/testing/phase-0a.md). They must not be loosened to make a run pass.
 */
export const LIMITS = {
  /** Max distance between the zoom pointer and its world point after zoom. */
  anchorDriftPx: 0.01,
  /** Max landmark displacement after a navigation round trip. */
  roundTripPx: 0.01,
  /** Rendering must put visible ink on screen in every region. */
  minInkedSamples: 200,
  /** Render-call p95 on the reference machine (CPU-side recording time). */
  renderP95Ms: 8,
};

/** The build the tests open: `dist/` by default; `npm run test:snap` points CANVAST_BUILD_DIR at a snapshot of its own, so `dist/` can be rebuilt while it runs. */
export const APP_URL = pathToFileURL(resolve(process.env["CANVAST_BUILD_DIR"] ?? "dist", "canvast.html")).href + "#debug";

/**
 * Quick vs full suites (docs/testing/README.md). Every test runs in both;
 * only the length of the stress loops differs. The full suite (milestone
 * commits) sets CANVAST_E2E_FULL=1 via playwright.full.config.ts.
 */
export const FULL = process.env["CANVAST_E2E_FULL"] === "1";

/** Repetition count: `full` in the full suite, `quick` otherwise. */
export function reps(full: number, quick: number): number {
  return FULL ? full : quick;
}

type Hook = DebugHook;

declare global {
  interface Window {
    __canvastDebug: Hook;
  }
}

export interface App {
  page: Page;
  camera(): Promise<SerializedCamera>;
  frame(): Promise<void>;
  landmark(id: string): Promise<{ x: number; y: number; sizePx: number }>;
  worldAt(x: number, y: number): Promise<{ x: string; y: string }>;
  screenOf(w: { x: string; y: string }): Promise<{ x: number; y: number }>;
  inked(): Promise<number>;
  wheel(x: number, y: number, deltaY: number, opts?: { ctrl?: boolean }): Promise<void>;
  drag(from: { x: number; y: number }, to: { x: number; y: number }, steps?: number): Promise<void>;
  externalRequests: string[];
  consoleErrors: string[];
}

/**
 * Input helpers must start on the canvas, not on an overlay (toolbar, HUD,
 * dev panel); otherwise a test silently exercises the wrong element.
 */
const checkedPoints = new WeakMap<Page, Set<string>>();
async function assertCanvasAt(page: Page, x: number, y: number): Promise<void> {
  const key = `${x},${y}`;
  let seen = checkedPoints.get(page);
  if (!seen) checkedPoints.set(page, (seen = new Set()));
  if (seen.has(key)) return; // overlays are static during a test
  const id = await page.evaluate(([a, b]) => { const e = document.elementFromPoint(a!, b!); return e?.id === "canvas" ? "canvas" : `${e?.tagName ?? "nothing"}.${e?.className ?? ""} in ${e?.closest("[class]")?.className ?? ""}`; }, [x, y]);
  expect(id, `input at (${x}, ${y}) must land on the canvas, not an overlay`).toBe("canvas");
  seen.add(key);
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export const test = base.extend<{ app: App }>({
  app: async ({ page }, use) => {
    const externalRequests: string[] = [];
    const consoleErrors: string[] = [];
    page.on("request", (r) => {
      if (!/^(file|data|blob):/.test(r.url())) externalRequests.push(r.url());
    });
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    await page.goto(APP_URL);
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
    await page.evaluate(() => window.__canvastDebug.nextFrame());

    const app: App = {
      page,
      externalRequests,
      consoleErrors,
      camera: () => page.evaluate(() => window.__canvastDebug.camera()),
      frame: () => page.evaluate(() => window.__canvastDebug.nextFrame()),
      landmark: (id) => page.evaluate((i) => window.__canvastDebug.landmarkScreen(i), id),
      worldAt: (x, y) => page.evaluate(([a, b]) => window.__canvastDebug.screenToWorld(a!, b!), [x, y]),
      screenOf: (w) => page.evaluate((p) => window.__canvastDebug.worldToScreen(p.x, p.y), w),
      inked: () => page.evaluate(() => window.__canvastDebug.inkedPixels()),
      wheel: async (x, y, deltaY, opts) => {
        // Trusted input through the browser's own event pipeline.
        await assertCanvasAt(page, x, y);
        await page.mouse.move(x, y);
        if (opts?.ctrl) await page.keyboard.down("Control");
        await page.mouse.wheel(0, deltaY);
        if (opts?.ctrl) await page.keyboard.up("Control");
      },
      drag: async (from, to, steps = 8) => {
        await assertCanvasAt(page, from.x, from.y);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps });
        await page.mouse.up();
      },
    };
    await use(app);
  },
});

export { expect };

export function assertFiniteCamera(cam: SerializedCamera): void {
  expect(Number.isSafeInteger(cam.zi), `zi ${cam.zi}`).toBe(true);
  expect(cam.zf >= 0 && cam.zf < 1, `zf ${cam.zf}`).toBe(true);
  expect(cam.cx).toMatch(/^-?\d+p-?\d+$/);
  expect(cam.cy).toMatch(/^-?\d+p-?\d+$/);
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

/** Write a measurement to metrics/<project>--<name>.json (kept across runs; Playwright wipes test-results/). */
export function recordMetric(info: TestInfo, name: string, value: Record<string, unknown>): void {
  const dir = resolve("metrics");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${info.project.name}--${name}.json`);
  writeFileSync(file, JSON.stringify({ project: info.project.name, test: info.title, ...value }, null, 2));
  info.annotations.push({ type: "metric", description: `${name}: ${JSON.stringify(value)}` });
}

/** The readout starts in its Simple view; a few specs read the technical numbers (the third view of the information button). */
export async function showTechnicalReadout(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: /^Information shown/ });
  for (let i = 0; i < 3 && (await button.getAttribute("data-mode")) !== "technical"; i++) await button.click();
}

/** Open the actions (the "More" button) of a board or canvas in the workspace menu, opening the menu first if it is closed. */
export async function openActions(page: Page, kind: "board" | "canvas", name: string): Promise<void> {
  if (await page.getByTestId("workspace-menu").isHidden()) await page.getByTestId("workspace-nav").click();
  const open = page.getByRole("menu", { name: /^Actions for / });
  if (await open.isVisible()) await page.keyboard.press("Escape"); // a row's menu sits over the next row's button: close it first, as a person would
  const more = page.getByRole("button", { name: `More actions for ${kind} ${name}` }).last(); // the newest board when names repeat, as the plain buttons were
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
}

/** Rename, Export or Delete a board or canvas from its actions. */
export async function rowAction(page: Page, kind: "board" | "canvas", name: string, action: "Rename" | "Export" | "Delete"): Promise<void> {
  await openActions(page, kind, name);
  await page.getByRole("menuitem", { name: `${action} ${kind} ${name}` }).click();
}

type GroupMenu = "alignmenu" | "arrangemenu" | "boolmenu" | "maskmenu" | "pathmenu";
/**
 * Choose an item (e.g. "align:left") in a grouped-tools menu of the Actions bar. The menu stays open after a choice, so it is opened only when
 * it is not; it is closed again (Escape) unless `keepOpen`, so later input does not land on it.
 */
export async function chooseInMenu(page: Page, button: GroupMenu, id: string, keepOpen = false): Promise<void> {
  const b = page.locator(`[data-ctx="${button}"]`);
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click({ timeout: 5000 });
  await page.locator(`.pop-menu [data-id="${id}"]`).click();
  if (!keepOpen && (await b.getAttribute("aria-expanded")) === "true") {
    await page.keyboard.press("Escape");
    await expect(page.locator(".pop-menu")).toHaveCount(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // (the focus went back to the bar's button, whose name the hint line would show)
  }
}
export const alignWith = (page: Page, id: string, keepOpen = false): Promise<void> => chooseInMenu(page, "alignmenu", id, keepOpen);
export const arrangeWith = (page: Page, id: string, keepOpen = false): Promise<void> => chooseInMenu(page, "arrangemenu", id, keepOpen);
export const boolWith = (page: Page, id: string): Promise<void> => chooseInMenu(page, "boolmenu", id);
export const maskWith = (page: Page, id: string): Promise<void> => chooseInMenu(page, "maskmenu", id);
export const pathWith = (page: Page, id: string): Promise<void> => chooseInMenu(page, "pathmenu", id);
