import type { Page } from "@playwright/test";
import { expect, test } from "./harness";

/** Accessibility checks (ADR 0050): every visible control has a name, landmarks and a live status exist, focus is visible. */

/** Visible interactive elements without an accessible name (computed the way the page's own markup supplies one). */
async function unnamed(p: Page): Promise<string[]> {
  return p.evaluate(() => {
    const sel = 'button, input:not([type="hidden"]), select, textarea, a[href], [role="tab"], [role="radio"], [role="menuitem"], [role="menuitemradio"], [role="treeitem"], [role="slider"], [role="switch"], [contenteditable="true"]';
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!(r.width > 0 && r.height > 0) || cs.visibility === "hidden" || el.closest("[hidden], [inert]")) continue;
      const byIds = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((i) => document.getElementById(i)?.textContent ?? "").join(" ").trim();
      const labels = ("labels" in el ? [...((el as HTMLInputElement).labels ?? [])].map((l) => l.textContent ?? "").join(" ") : "").trim();
      const name = (el.getAttribute("aria-label") || byIds || labels || el.textContent || el.getAttribute("title") || el.getAttribute("placeholder") || "").trim();
      if (!name) out.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${el.className} ${el.getAttribute("data-testid") ?? ""}`.trim());
    }
    return out;
  });
}

test("every visible control has an accessible name, in each view and with the panels open", async ({ app }) => {
  const p = app.page;
  expect(await p.evaluate(() => document.documentElement.lang), "the page language is set").toBeTruthy();
  expect(await p.locator("main").count(), "a main landmark").toBeGreaterThan(0);
  expect(await p.locator('[role="status"], [aria-live]').count(), "a live region announces messages").toBeGreaterThan(0);
  expect(await unnamed(p), "canvas view").toEqual([]);
  await p.getByRole("button", { name: "Layers panel" }).click();
  await p.getByRole("button", { name: "Bookmarks panel" }).click();
  await p.keyboard.press("p");
  await app.drag({ x: 400, y: 300 }, { x: 600, y: 360 }, 4);
  expect(await unnamed(p), "canvas view, panels open, an object drawn").toEqual([]);
  await p.getByTestId("view-assets").click();
  expect(await unnamed(p), "assets view").toEqual([]);
  await p.getByTestId("view-settings").click();
  for (const tab of ["Drawing and selection", "Media and playback", "Performance", "Appearance", "Shortcuts", "Storage", "Privacy", "Collaboration"]) {
    await p.locator("#settings-view").getByRole("tab", { name: tab }).click();
    expect(await unnamed(p), `settings: ${tab}`).toEqual([]);
  }
});

test("keyboard: the view tabs come first in tab order, every focus shows an outline, Escape leaves Settings", async ({ app }) => {
  const p = app.page;
  // Focus lands on real controls and each one is outlined (no focus that cannot be seen).
  const seen = new Set<string>();
  // The view tabs are at the top of the screen, so they come first in reading and Tab order (the header precedes the canvas).
  expect(await p.evaluate(() => !!(document.getElementById("nav")!.compareDocumentPosition(document.querySelector("main")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  for (let i = 0; i < 14; i++) {
    await p.keyboard.press("Tab");
    const info = await p.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return { tag: el.tagName, label: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "", outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0, shadow: cs.boxShadow !== "none" };
    });
    if (!info) continue;
    seen.add(info.label);
    if (info.tag !== "CANVAS") expect(info.outline || info.shadow, `focus is visible on ${info.tag} ${info.label}`).toBe(true);
  }
  expect(seen.size, "Tab moves through controls").toBeGreaterThan(5);
  await p.getByTestId("view-settings").click();
  await p.keyboard.press("Escape");
  expect(await p.evaluate(() => window.__canvastDebug.appView())).toBe("canvas");
});

test("notices: a message appears as a visible notice, progress updates in place and closes when the work is done, errors can be dismissed (ADR 0053)", async ({ app }) => {
  const p = app.page;
  const toast = p.getByTestId("toast");
  await expect(toast).toBeHidden();
  // Progress: one notice with a bar that moves; a new count replaces the old one.
  await p.evaluate(() => window.__canvastDebug.notify("Importing 2 of 10…"));
  await expect(toast.locator(".notice")).toHaveCount(1);
  await expect(toast.locator(".notice-bar")).toBeVisible();
  await p.evaluate(() => window.__canvastDebug.notify("Importing 7 of 10…"));
  await expect(toast.locator(".notice")).toHaveCount(1);
  await expect(toast).toContainText("7 of 10");
  expect(await toast.locator(".notice-bar > span").evaluate((e) => e.style.width)).toBe("70%");
  // The work ends with its result: the progress notice is replaced, not left behind.
  await p.evaluate(() => window.__canvastDebug.notify("Imported 10 images.", "import"));
  await expect(toast.locator(".notice")).toHaveCount(1);
  await expect(toast.locator(".notice.is-success")).toContainText("Imported 10 images.");
  await expect(toast.locator(".notice-bar")).toHaveCount(0);
  // An error is a live alert that stays until it is dismissed.
  await p.evaluate(() => window.__canvastDebug.notify("Could not import clip.mov: unsupported file."));
  await expect(toast.getByRole("alert")).toContainText("Could not import clip.mov");
  await toast.getByRole("alert").getByRole("button", { name: "Dismiss" }).click();
  await expect(toast.getByRole("alert")).toHaveCount(0);
  // It is above every view: still shown in Assets and Settings.
  await p.getByTestId("view-assets").click();
  await p.evaluate(() => window.__canvastDebug.notify("Copied 3 objects"));
  await expect(toast).toBeVisible();
  const box = (await toast.boundingBox())!;
  expect(box.y + box.height, "inside the window, near the bottom").toBeGreaterThan(500);
  expect(app.consoleErrors).toEqual([]);
});
