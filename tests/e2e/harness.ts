import { expect, test as base } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildDir } from "./build-dir";
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

/** The build the tests open: the snapshot `npm run test:snap` made (CANVAST_BUILD_DIR), never `dist/` (see build-dir.ts). */
export const APP_URL = pathToFileURL(resolve(buildDir(), "canvast.html")).href + "#debug";

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
    page.on("pageerror", (e) => consoleErrors.push(String(e) + "\n" + (e.stack ?? "")));
    await page.goto(APP_URL);
    // (an app that never starts says why: the page's errors so far)
    await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined").catch((e: Error) => {
      throw new Error(`${e.message}\nThe page's errors: ${consoleErrors.join("\n") || "none"}`);
    });
    // (a drag in a test goes by the pixels it says: the grid catching it is tested on its own)
    await page.evaluate(() => window.__canvastDebug.setSetting("snap.grid", false));
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

type GroupMenu = "alignmenu" | "arrangemenu" | "boolmenu" | "maskmenu" | "pathmenu" | "sheetmenu" | "exportmenu" | "statemenu" | "sizemenu";

/** Give the pen a colour through the colour picker of the Properties bar (it has no row of colours any more): type the hex, close the picker. */
/** New shapes have no outline: a test about outlines first gives the next shapes the one they used to get, 2 px of the ink (slider 25). */
export async function outlineShapes(page: Page): Promise<void> {
  await page.keyboard.press("u");
  await page.locator("[data-shape-width]").fill("25");
}

export async function setPenColour(page: Page, hex: string): Promise<void> {
  await page.locator("[data-colour-open]").click();
  const field = page.locator(".colour-pop [data-hex]");
  await field.fill(hex.replace("#", ""));
  await field.press("Enter");
  await page.keyboard.press("Escape");
}

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
/** Show the saved styles of a kind in the Styles panel: its one list of kinds (the shared menu). */
export async function styleKind(page: Page, kind: string): Promise<void> {
  await page.locator("[data-kind-pick]").click();
  await page.locator(`.pop-menu [data-id="kind:${kind}"]`).click();
  await expect(page.locator("[data-kind-pick]")).toHaveAttribute("aria-label", new RegExp(`^Kind of style: `));
}
export const alignWith = (page: Page, id: string, keepOpen = false): Promise<void> => chooseInMenu(page, "alignmenu", id, keepOpen);
export const arrangeWith = (page: Page, id: string, keepOpen = false): Promise<void> => chooseInMenu(page, "arrangemenu", id, keepOpen);
export const boolWith = (page: Page, id: string): Promise<void> => chooseInMenu(page, "boolmenu", id);
export const maskWith = (page: Page, id: string): Promise<void> => chooseInMenu(page, "maskmenu", id);
export const sheetWith = (page: Page, id: string): Promise<void> => chooseInMenu(page, "sheetmenu", id);
export const stateWith = (page: Page, id: "stateset" | "stateupdate" | "statereset"): Promise<void> => chooseInMenu(page, "statemenu", id);
export const exportWith = (page: Page, id: string): Promise<void> => chooseInMenu(page, "exportmenu", id);
/** Right-click empty canvas at (x, y) and choose a row of the context menu by its name (what the Properties bar's Show all and Unlock all buttons became). */
export async function contextChoose(page: Page, x: number, y: number, name: string): Promise<void> {
  await page.mouse.click(x, y, { button: "right" });
  await page.getByRole("menuitem", { name }).click();
}
export const pathWith = (page: Page, id: string): Promise<void> => chooseInMenu(page, "pathmenu", id);

/**
 * After a backup is picked for import: a workspace backup asks how to import it (update this workspace, or add new boards); this answers
 * it, "add" by default (what an import did before the choice). Another backup goes straight to its confirmation.
 */
export async function importMode(p: Page, mode: "add" | "update" = "add"): Promise<void> {
  const choose = p.getByTestId("choose-dialog").filter({ hasText: "How to import" });
  await expect(choose.or(p.getByTestId("confirm-dialog")).first()).toBeVisible({ timeout: 30_000 });
  if (!(await choose.isVisible())) return;
  await choose.locator(`input[value="${mode}"]`).check();
  await choose.getByTestId("choose-ok").click();
}

/**
 * Every visible settings row of a panel, checked as one design: its controls end at the row's right edge, sit on one line, and each
 * button, field and select is the standard control height (`--ctl`). Answers what is wrong, by row name (empty when nothing is).
 */
export function settingsRowProblems(panel: ReturnType<Page["locator"]>): Promise<string[]> {
  return panel.evaluate((root) => {
    const probe = document.createElement("div");
    probe.style.height = "var(--ctl)";
    root.appendChild(probe);
    const ctl = probe.getBoundingClientRect().height;
    probe.remove();
    const out: string[] = [];
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    for (const row of root.querySelectorAll<HTMLElement>(".set-row")) {
      if (!visible(row)) continue;
      const name = row.querySelector(".set-label")?.textContent?.trim() ?? "(a row)";
      const control = row.querySelector<HTMLElement>(":scope > .set-control");
      if (!control) continue;
      if (control.querySelector("input.set-hue")) continue; // (the hue slider takes a line of its own, by design)
      const kids = [...control.children].filter(visible);
      if (!kids.length) continue;
      const box = control.getBoundingClientRect();
      const last = kids.at(-1)!.getBoundingClientRect();
      if (Math.abs(box.right - last.right) > 2) out.push(`${name}: its controls do not end at the right edge (${Math.round(box.right - last.right)} px short)`);
      const mids = kids.map((k) => k.getBoundingClientRect()).map((r) => r.top + r.height / 2);
      if (Math.max(...mids) - Math.min(...mids) > 4) out.push(`${name}: its controls are on more than one line`);
      for (const k of kids) {
        const sized = k.matches("button, select, input[type=text], input[type=password], input:not([type])");
        const h = k.getBoundingClientRect().height;
        if (sized && Math.abs(h - ctl) > 1) out.push(`${name}: “${(k.textContent || k.getAttribute("aria-label") || k.tagName).trim().slice(0, 30)}” is ${Math.round(h)} px high, not ${Math.round(ctl)}`);
      }
    }
    return out;
  });
}
