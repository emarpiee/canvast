import type { Page } from "@playwright/test";
import { expect, test } from "./harness";
import { blockyFixture } from "./png";

/**
 * Contrast measured on the real thing, in both themes: every text at 4.5:1 (3:1 when large) and every icon at 3:1 against what is really behind it, overlays
 * and translucent panels included. Disabled controls and what lies on a picture are left out.
 */
async function lowContrast(p: Page, scope: string): Promise<string[]> {
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
      if (got < need - 0.01) out.add(`${icon ? "icon" : "text"} ${got.toFixed(2)} < ${need}: ${el.closest("[class]")?.className.toString().slice(0, 50)} “${(el.textContent ?? "").trim().slice(0, 24)}”`);
    }
    return [...out];
  }, scope);
}

for (const theme of ["light", "dark"] as const) {
  test(`what is shown has enough contrast: ${theme} theme`, async ({ app }) => {
    const p = app.page;
    await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    const found: string[] = [];
    const look = async (where: string, scope = "body"): Promise<void> => {
      await p.waitForTimeout(350); // (what fades has finished)
      for (const line of await lowContrast(p, scope)) found.push(`${where}: ${line}`);
    };
    await look("canvas");
    await p.getByTestId("view-assets").click();
    await p.getByTestId("assets-import-input").setInputFiles({ name: "b.png", mimeType: "image/png", buffer: blockyFixture() });
    await expect(p.getByTestId("asset-card")).toHaveCount(1);
    await p.getByTestId("folder-new").click();
    await p.getByTestId("folder-name-input").fill("Art");
    await p.getByTestId("folder-name-input").press("Enter");
    const art = p.getByTestId("folder-tree").getByRole("button", { name: /^Art/ });
    await art.click();
    await art.hover(); // (the selected row, with its pin and More on it)
    await look("library, a selected folder under the pointer");
    await p.getByTestId("assets-side").getByRole("button", { name: /^All items/ }).click();
    await p.getByTestId("asset-card").first().click();
    await art.hover();
    await look("library, an item selected, a folder under the pointer");
    await p.keyboard.press("o");
    await expect(p.getByTestId("tree-chooser")).toBeVisible();
    await look("Organize", '[data-testid="tree-chooser"]');
    await p.getByTestId("choice-cancel").click();
    await p.keyboard.press("Escape");
    await p.getByTestId("view-settings").click();
    await look("Settings");
    expect(found).toEqual([]);
  });
}
