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
/** Open the Adjust panel for what is selected (its button on the Actions bar), and wait for its controls. */
export async function openAdjust(page: Page): Promise<void> {
  if (!(await page.getByTestId("adjust-panel").isVisible())) await page.getByRole("button", { name: /^Adjust the picture/ }).click();
  await page.getByTestId("adjust-panel").locator(".adjust-pop").waitFor();
}
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
/**
 * Contrast measured on the real thing: every text at 4.5:1 (3:1 when large) and every icon at 3:1 against what is really behind it, overlays
 * and translucent panels included, inside `scope` (a selector). Disabled controls and what lies on a picture are left out. One line a problem.
 */
export async function lowContrast(p: Page, scope: string): Promise<string[]> {
  return p.evaluate((sel) => {
    const pen = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const rgba = (css: string): number[] => {
      pen.clearRect(0, 0, 1, 1);
      pen.fillStyle = "oklch(0 0 0 / 0)";
      pen.fillStyle = css;
      pen.fillRect(0, 0, 1, 1);
      const d = pen.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
    };
    const over = (top: number[], under: number[]): number[] => [0, 1, 2].map((i) => top[i]! * top[3]! + under[i]! * (1 - top[3]!)).concat(1);
    const lum = (c: number[]): number => {
      const lin = c.slice(0, 3).map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
    };
    const ratio = (a: number[], b: number[]): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const opacityOf = (el: Element): number => {
      let o = 1;
      for (let at: Element | null = el; at; at = at.parentElement) o *= Number(getComputedStyle(at).opacity);
      return o;
    };
    const pageBg = rgba(getComputedStyle(document.documentElement).getPropertyValue("--theme-bg"));
    /** What is behind a point of this element: everything under it there, from the back up. Null when that is a picture. */
    const behind = (el: Element, x: number, y: number): number[] | null => {
      const stack = document.elementsFromPoint(x, y);
      const from = stack.findIndex((s) => s === el || s.contains(el));
      let back = pageBg;
      for (const s of stack.slice(from < 0 ? 0 : from).reverse()) {
        const cs = getComputedStyle(s);
        if (s.id !== "canvas" && (s instanceof HTMLImageElement || s instanceof HTMLVideoElement || s instanceof HTMLCanvasElement || cs.backgroundImage !== "none")) return null;
        const c = rgba(cs.backgroundColor);
        c[3] = c[3]! * opacityOf(s);
        back = over(c, back);
      }
      return back;
    };
    const out = new Set<string>();
    for (const el of document.querySelectorAll(`${sel} *`)) {
      const icon = el.localName === "svg";
      const words = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
      if ((!icon && !words) || el.closest("svg svg, :disabled, [aria-disabled='true'], [hidden], .thumb-slot, .asset-card")) continue;
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const opacity = opacityOf(el);
      if (!box.width || !box.height || cs.visibility === "hidden" || cs.display === "none" || opacity === 0) continue;
      if (box.right <= 0 || box.bottom <= 0 || box.left >= innerWidth || box.top >= innerHeight) continue;
      const back = behind(el, box.left + box.width / 2, box.top + box.height / 2);
      if (!back) continue;
      const ink = rgba(cs.color);
      ink[3] = ink[3]! * opacity;
      const px = parseFloat(cs.fontSize);
      const need = icon || px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5;
      const got = ratio(over(ink, back), back);
      if (got < need - 0.01) out.add(`${icon ? "icon" : "text"} ${got.toFixed(2)} < ${need}: ${el.closest("[class]")?.getAttribute("class")?.slice(0, 40)} in ${el.parentElement?.closest("[class]")?.getAttribute("class")?.slice(0, 40)} ${el.closest("[aria-label], [title]")?.getAttribute("aria-label") ?? el.closest("[title]")?.getAttribute("title")?.slice(0, 30) ?? ""} “${(el.textContent ?? "").trim().slice(0, 24)}”`);
    }
    return [...out];
  }, scope);
}

/**
 * The rules of the floating bars and popovers (ADR 0198, CLAUDE.md "Floating bars and popovers"), checked on what is open now: the value
 * chips by the selection, a chip's popover, the colour picker and any menu. Each problem is one line that says what and where:
 * - inside the window, and never over the selected things (the box menus keep clear of) nor over the chip or bar it came from;
 * - a chip's popover is a form: every control that shows has a visible name on its row, all names in one font and size, its rows apart
 *   by a spacing token, its padding a spacing token, and it is as wide as its rows (no empty room), with nothing cut off sideways;
 * - the colours in the chips are all the same size;
 * - the colour picker is whole (it scrolls only when the window is shorter than it);
 * - every text and icon in them has the contrast of the theme's rules (`lowContrast`).
 */
export async function floatingProblems(page: Page): Promise<string[]> {
  const contrast = (await lowContrast(page, ".vchip-pop, .props-near, .props-chips")).map((m) => `contrast: ${m}`);
  return [...contrast, ...(await floatingRules(page))];
}
function floatingRules(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const root = getComputedStyle(document.documentElement);
    const px = (v: string): number => {
      const probe = document.createElement("div");
      probe.style.width = v;
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width;
      probe.remove();
      return w;
    };
    const tokens = new Set(["--s-1", "--s-2", "--s-4", "--s-6", "--s-8", "--s-10", "--s-12", "--s-13", "--s-14", "--s-15", "--gap", "--pad", "--near"].filter((t) => root.getPropertyValue(t).trim()).map((t) => Math.round(px(`var(${t})`) * 10) / 10));
    tokens.add(0);
    const isToken = (v: number): boolean => [...tokens].some((t) => Math.abs(t - v) < 0.6);
    const shown = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const name = (el: Element): string => (el.getAttribute("aria-label") ?? el.textContent ?? el.className).trim().slice(0, 40);
    type Box = { left: number; top: number; right: number; bottom: number };
    const overlaps = (a: Box, b: Box): boolean => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const sel = window.__canvastDebug.selectionBox();
    const floating = [...document.querySelectorAll<HTMLElement>(".vchip-pop, .colour-pop, .pop-menu, .props-near")].filter(shown);
    for (const f of floating) {
      const r = f.getBoundingClientRect();
      const what = f.className.split(" ")[0];
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`${what}: runs out of the window`);
      if (sel && overlaps(r, sel)) out.push(`${what}: covers the selected things`);
    }
    const pop = document.querySelector<HTMLElement>(".vchip-pop");
    const chip = document.querySelector<HTMLElement>('.vchip[aria-expanded="true"]');
    if (pop && shown(pop)) {
      if (chip && overlaps(pop.getBoundingClientRect(), chip.getBoundingClientRect())) out.push("the popover covers its own chip");
      const bar = chip?.closest<HTMLElement>(".props-near, .props-chips");
      if (bar && overlaps(pop.getBoundingClientRect(), bar.getBoundingClientRect())) out.push("the popover covers the chips it came from");
      const cs = getComputedStyle(pop);
      for (const side of ["paddingTop", "paddingLeft"] as const) if (!isToken(parseFloat(cs[side]))) out.push(`the popover's ${side} (${cs[side]}) is not a spacing token`);
      if (pop.scrollWidth > pop.clientWidth + 1) out.push("the popover cuts its rows off sideways");
      const form = pop.querySelector<HTMLElement>(".toolbar.is-form .tb-options-row");
      if (form) {
        const gap = parseFloat(getComputedStyle(form).rowGap);
        if (!isToken(gap)) out.push(`the form's rows are ${gap} px apart, not a spacing token`);
        const controls = [...form.querySelectorAll<HTMLElement>("input:not([type=file]), select, button")].filter(shown).filter((c) => !c.closest("[role=radiogroup], .seg") && !c.matches(".width"));
        const fonts = new Set<string>();
        let widest = 0;
        for (const c of controls) {
          const row = c.closest<HTMLElement>("label, button") ?? c;
          const words = [...row.querySelectorAll<HTMLElement>(".pf-name, .swatch-name")].filter(shown);
          const own = [...row.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
          if (!words.length && !own) out.push(`“${name(c)}” has no name on its row`);
          for (const w of words) fonts.add(`${getComputedStyle(w).fontSize} ${getComputedStyle(w).fontWeight}`);
          if (own) fonts.add(`${getComputedStyle(row).fontSize} ${getComputedStyle(row).fontWeight}`);
          widest = Math.max(widest, row.scrollWidth);
        }
        for (const g of [...form.querySelectorAll<HTMLElement>("[role=radiogroup], .seg")].filter(shown)) {
          if (!g.dataset["name"]) out.push(`the choices “${name(g)}” have no name`);
          widest = Math.max(widest, g.scrollWidth);
        }
        if (fonts.size > 1) out.push(`the names of the form are in ${fonts.size} different fonts or sizes: ${[...fonts].join(", ")}`);
        // (a value is never cut: its words fit in its field, a number's arrows aside)
        const pen = document.createElement("canvas").getContext("2d")!;
        for (const f of [...form.querySelectorAll<HTMLInputElement>("input[type=number], input[type=text]")].filter(shown)) {
          const cs = getComputedStyle(f);
          pen.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          // (from the outer width: browsers count a number's arrows in its inner width differently)
          const room = f.offsetWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth) - (f.type === "number" ? 18 : 0);
          if (pen.measureText(f.value).width > room + 0.5) out.push(`the value “${f.value}” of “${name(f)}” is cut`);
        }
        const room = pop.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        if (widest && room - widest > 24) out.push(`the popover is ${Math.round(room - widest)} px wider than its widest row`);
      }
    }
    const sizes = new Set([...document.querySelectorAll<HTMLElement>(".props-near .vchip-sw, .props-chips .vchip-sw")].filter(shown).map((s) => `${Math.round(s.getBoundingClientRect().width)}x${Math.round(s.getBoundingClientRect().height)}`));
    if (sizes.size > 1) out.push(`the colours of the chips are of ${sizes.size} sizes: ${[...sizes].join(", ")}`);
    const picker = document.querySelector<HTMLElement>(".colour-pop");
    if (picker && shown(picker) && picker.scrollHeight > picker.clientHeight + 1 && picker.scrollHeight < innerHeight - 16) out.push("the colour picker scrolls though the window is tall enough for it");
    return out;
  });
}

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
