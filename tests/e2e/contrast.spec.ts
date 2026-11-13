import { expect, lowContrast, test } from "./harness";
import { blockyFixture } from "./png";

/**
 * Contrast measured on the real thing, in both themes: every text at 4.5:1 (3:1 when large) and every icon at 3:1 against what is really behind it, overlays
 * and translucent panels included. Disabled controls and what lies on a picture are left out.
 */
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

test("code in a note: every colour keeps 4.5:1 on a code block, and inline code on the page, in both themes", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles({ name: "code.md", mimeType: "text/markdown", buffer: Buffer.from("```python\ndef f(): pass\n```\n\nSome `code` here\n") });
  await p.locator('[data-testid="asset-card"][title="code.md"]').dblclick();
  await expect(p.locator(".sun-editor-editable pre").first()).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    await p.evaluate((t) => window.__canvastDebug.setSetting("ui.theme", t), theme);
    await p.waitForTimeout(100);
    // (what a highlight paints cannot be read from the page: each colour is tried in a line of the block itself)
    await p.evaluate(() => {
      const pre = document.querySelector(".sun-editor-editable pre")!;
      pre.querySelectorAll("[data-probe]").forEach((n) => n.remove());
      for (const g of ["keyword", "string", "comment", "number", "function", "tag"]) {
        const s = document.createElement("span");
        s.dataset["probe"] = g;
        s.style.color = `var(--code-${g})`;
        s.textContent = ` ${g}`;
        pre.append(s);
      }
    });
    expect(await lowContrast(p, ".sun-editor-editable pre"), theme).toEqual([]);
    expect(await lowContrast(p, ".sun-editor-editable p"), theme).toEqual([]);
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`a button under the pointer, pressed or not, keeps its icon and words readable: ${theme} theme`, async ({ app }) => {
    const p = app.page;
    await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    // (no fade between states: each button is measured as it is under the pointer)
    await p.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    // a shape selected: the Actions bar and the shape's bar are there, with their pressed buttons
    await p.keyboard.press("u");
    await app.drag({ x: 500, y: 300 }, { x: 650, y: 420 }, 4);
    await p.keyboard.press("v");
    await p.mouse.click(575, 360);
    const marked = await p.evaluate(() => {
      const out: Array<{ n: number; on: boolean }> = [];
      for (const b of document.querySelectorAll<HTMLButtonElement>(":is(.rail, .dock, .toolbar, .ctx-bar, .hud-controls, .view-switch, .view-settings, .seg) button")) {
        const r = b.getBoundingClientRect();
        if (!r.width || !r.height || b.disabled || b.closest("[hidden]") || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
        b.setAttribute("data-hover-audit", String(out.length));
        out.push({ n: out.length, on: ["aria-pressed", "aria-checked", "aria-selected"].some((a) => b.getAttribute(a) === "true") });
      }
      return out;
    });
    expect(marked.filter((m) => m.on).length, "pressed or selected buttons to look at").toBeGreaterThan(1);
    const found: string[] = [];
    for (const m of marked) {
      const b = p.locator(`[data-hover-audit="${m.n}"]`);
      if (!(await b.isVisible())) continue; // (a bar that went away when another was hovered)
      await b.hover();
      for (const line of await lowContrast(p, `[data-hover-audit="${m.n}"]`)) found.push(`${m.on ? "pressed" : "plain"} button ${m.n}: ${line}`);
    }
    expect(found).toEqual([]);
  });
}
