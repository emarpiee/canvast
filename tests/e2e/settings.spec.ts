import { APP_URL, expect, test } from "./harness";

/** The Settings view (ADR 0048): tabs, rows that write the shared store, scope and reset, theme, and what is remembered. */

test("settings view: tabs, a row reaches the tools, reset, theme and reload (ADR 0048)", async ({ app }) => {
  const p = app.page;
  const view = p.getByTestId("view-settings");
  const panel = p.locator("#settings-view");
  await expect(panel).toBeHidden();
  await view.click();
  await expect(panel).toBeVisible();
  expect(await p.evaluate(() => window.__canvastDebug.appView())).toBe("settings");
  // Canvas shortcuts do not act here (P would pick the pen), and the tabs move with the arrow keys.
  const tool = () => p.evaluate(() => window.__canvastDebug.tool());
  const before = await tool();
  await p.keyboard.press("p");
  expect(await tool()).toBe(before);
  await expect(panel.getByRole("tab", { name: "Drawing and selection" })).toHaveAttribute("aria-selected", "true");
  await p.keyboard.press("ArrowDown");
  await expect(panel.getByRole("tab", { name: "Navigation" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.locator("#set-panel-navigation")).toBeVisible();
  await expect(panel.locator("#set-panel-drawing")).toBeHidden();
  // A row writes the shared store and the tool: the marker is one translucent stroke.
  await panel.getByRole("tab", { name: "Drawing and selection" }).click();
  const pen = panel.getByLabel("Pen", { exact: true });
  await pen.selectOption("marker");
  const reset = panel.getByRole("button", { name: "Reset Pen to its default" });
  await expect(reset).toBeEnabled();
  expect(await p.evaluate(() => JSON.parse(localStorage.getItem("canvast.settings")!)["pen.kind"])).toBe("marker");
  await panel.getByRole("button", { name: "Back to canvas" }).click();
  expect(await p.evaluate(() => window.__canvastDebug.appView())).toBe("canvas");
  await p.keyboard.press("p");
  await app.drag({ x: 400, y: 300 }, { x: 700, y: 360 }, 6);
  const [stroke] = (await p.evaluate(() => window.__canvastDebug.objects())) as unknown as Array<{ opacity: number }>;
  expect(stroke!.opacity).toBeLessThan(1);
  // Reset goes back to the default pen (and a value the row refuses is not stored).
  await view.click();
  await reset.click();
  await expect(pen).toHaveValue("fine");
  await expect(reset).toBeDisabled();
  // Theme: dark and light are applied at once and kept across a reload.
  await panel.getByRole("tab", { name: "Appearance" }).click();
  await panel.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(p.locator("html")).toHaveAttribute("data-theme", "dark");
  await panel.getByRole("button", { name: "Back to canvas" }).click();
  await app.frame();
  const bg = async () => (await p.evaluate(() => window.__canvastDebug.pixelAt(6, 6))).join(",");
  const dark = await bg();
  await view.click();
  await panel.getByLabel("Theme", { exact: true }).selectOption("light");
  await panel.getByRole("button", { name: "Back to canvas" }).click();
  await app.frame();
  expect(await bg(), "the canvas background follows the theme").not.toBe(dark);
  await view.click();
  await panel.getByLabel("Theme", { exact: true }).selectOption("dark");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(p.locator("html")).toHaveAttribute("data-theme", "dark");
  // The Settings view itself is not remembered; the canvas opens.
  expect(await p.evaluate(() => window.__canvastDebug.appView())).toBe("canvas");
  // The Storage tab reports what the browser says.
  await p.getByTestId("view-settings").click();
  await p.locator("#settings-view").getByRole("tab", { name: "Storage" }).click();
  await expect(p.locator("#settings-view [data-used]")).toHaveText(/MB|GB|unknown/);
  expect(app.consoleErrors).toEqual([]);
});

test("shortcuts: tool keys can be changed and are refused when taken; the list opens with ? (ADR 0049)", async ({ app }) => {
  const p = app.page;
  const panel = p.locator("#settings-view");
  const tool = () => p.evaluate(() => window.__canvastDebug.tool());
  // "?" opens the list on the Shortcuts tab; the fixed shortcuts are there.
  await p.keyboard.press("?");
  await expect(panel).toBeVisible();
  await expect(panel.locator("#set-panel-shortcuts")).toBeVisible();
  await expect(panel.locator("#set-panel-shortcuts")).toContainText("Ctrl+Z");
  // Pen to K: K works on the canvas, P no longer does, the button says K. A letter that is taken is refused.
  await panel.getByRole("button", { name: "Change the key for Pen" }).click();
  await p.keyboard.press("k");
  await expect(panel.locator("[data-key-note]")).toContainText("Pen is now K");
  await panel.getByRole("button", { name: "Change the key for Lasso" }).click();
  await p.keyboard.press("k");
  await expect(panel.locator("[data-key-note]")).toContainText("already the key for Pen");
  // The keys that step between items (W A S D) are changed the same way, and share the conflict check with the tools.
  await expect(panel.getByRole("button", { name: "Change the key for Step up" })).toBeVisible();
  await panel.getByRole("button", { name: "Change the key for Step up" }).click();
  await p.keyboard.press("d");
  await expect(panel.locator("[data-key-note]")).toContainText("already the key for Step right");
  await panel.getByRole("button", { name: "Change the key for Step up" }).click();
  await p.keyboard.press("i");
  await expect(panel.locator("[data-key-note]")).toContainText("Step up is now I");
  await panel.getByRole("button", { name: "Reset the key for Step up to its default" }).click();
  await panel.getByRole("button", { name: "Change the key for Lasso" }).click();
  await p.keyboard.press("5");
  await expect(panel.locator("[data-key-note]")).toContainText("one plain letter");
  // Waiting for a letter never gets stuck: a click elsewhere, another tab or closing ends it, and the letter works wherever the focus is.
  const waiting = panel.getByText("press a letter");
  await panel.getByRole("button", { name: "Change the key for Lasso" }).click();
  await expect(waiting).toBeVisible();
  await panel.getByRole("tab").nth(1).click();
  await expect(waiting).toHaveCount(0);
  await panel.getByRole("tab", { name: "Shortcuts" }).click();
  await panel.getByRole("button", { name: "Change the key for Lasso" }).click();
  await p.mouse.click(5, 5); // the focus leaves the panel
  await expect(waiting).toHaveCount(0);
  await panel.getByRole("button", { name: "Change the key for Lasso" }).click();
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await p.keyboard.press("Escape");
  await expect(waiting).toHaveCount(0);
  await expect(panel).toBeVisible(); // Escape ended the waiting, it did not close the view
  await panel.getByRole("button", { name: "Back to canvas" }).click();
  await p.keyboard.press("?");
  await panel.getByRole("button", { name: "Change the key for Lasso" }).click();
  await panel.getByRole("button", { name: "Back to canvas" }).click();
  await p.keyboard.press("?");
  await expect(waiting).toHaveCount(0);
  await panel.getByRole("button", { name: "Back to canvas" }).click();
  await expect(p.getByRole("radio", { name: "Pen" })).toHaveAttribute("title", "Pen (K)");
  // The tool tooltips belong to the tool buttons only; the canvas (which also carries the current tool) has none.
  await expect(p.locator("#canvas")).not.toHaveAttribute("title", /.+/);
  await p.keyboard.press("v");
  expect(await tool()).toBe("select");
  await p.keyboard.press("p");
  expect(await tool(), "the old key no longer picks the pen").toBe("select");
  await p.keyboard.press("k");
  expect(await tool()).toBe("pen");
  // Kept after a reload; Reset puts P back.
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.keyboard.press("v");
  await p.keyboard.press("k");
  expect(await tool()).toBe("pen");
  await p.keyboard.press("?");
  await panel.getByRole("button", { name: "Reset the key for Pen to its default" }).click();
  await panel.getByRole("button", { name: "Back to canvas" }).click();
  await p.keyboard.press("v");
  await p.keyboard.press("p");
  expect(await tool()).toBe("pen");
  expect(app.consoleErrors).toEqual([]);
});

test("appearance: interface size, contrast and motion apply at once, persist, and the tools never sit under the view tabs (ADR 0050)", async ({ app }) => {
  const p = app.page;
  const panel = p.locator("#settings-view");
  const root = p.locator("html");
  const clear = async () => {
    const [nav, tools] = await Promise.all([p.locator("#nav").boundingBox(), p.locator("#toolbar > .toolbar[aria-label=\"Tool options\"]").boundingBox()]);
    return tools!.x >= nav!.x + nav!.width - 1 || tools!.y >= nav!.y + nav!.height - 1;
  };
  expect(await clear(), "100%: the tools are clear of the view tabs").toBe(true);
  await p.getByTestId("view-settings").click();
  await panel.getByRole("tab", { name: "Appearance" }).click();
  await panel.getByLabel("Interface size", { exact: true }).selectOption("150");
  await panel.getByLabel("Contrast", { exact: true }).selectOption("high");
  await panel.getByRole("tab", { name: "Performance" }).click();
  await panel.getByLabel("Animation", { exact: true }).selectOption("reduce");
  await panel.getByRole("tab", { name: "Appearance" }).click();
  // Compact is the default; comfortable loosens every floating element on one grid (the dock, the tabs and the rail share the control size).
  const dockHeight = async () => (await p.locator("#toolbar > .dock").boundingBox())!.height;
  const compact = await dockHeight();
  await expect(root).not.toHaveAttribute("data-density", /.*/);
  await panel.getByLabel("Density", { exact: true }).selectOption("comfortable");
  await expect(root).toHaveAttribute("data-density", "comfortable");
  expect(await dockHeight(), "comfortable: a larger dock").toBeGreaterThan(compact);
  await expect(root).toHaveAttribute("data-contrast", "high");
  await expect(root).toHaveAttribute("data-motion", "reduce");
  expect(await root.evaluate((e) => e.style.getPropertyValue("--ui-scale"))).toBe("1.5");
  // The whole view grows (the tab list is wider than at 100%).
  expect((await panel.locator(".set-tabs").boundingBox())!.width).toBeGreaterThan(250);
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(root).toHaveAttribute("data-contrast", "high");
  await expect(root).toHaveAttribute("data-density", "comfortable"); // kept over the reload
  expect(await root.evaluate((e) => e.style.getPropertyValue("--ui-scale"))).toBe("1.5");
  expect(await clear(), "150% and comfortable: the tools are clear of the view tabs").toBe(true);
  // Back to the defaults leaves no attribute behind.
  await p.getByTestId("view-settings").click();
  await panel.getByRole("tab", { name: "Appearance" }).click();
  for (const key of ["ui.textScale", "ui.contrast"]) await panel.getByRole("button", { name: new RegExp(`Reset ${{ "ui.textScale": "Interface size", "ui.contrast": "Contrast" }[key]} `) }).click();
  await panel.getByRole("tab", { name: "Performance" }).click();
  await panel.getByRole("button", { name: /Reset Animation /i }).first().click();
  await expect(root).not.toHaveAttribute("data-motion", /.*/);
  // Subtle and the speed set the durations: the tokens, not each rule.
  await panel.getByLabel("Animation", { exact: true }).selectOption("subtle");
  await panel.getByLabel("Animation speed", { exact: true }).selectOption("slow");
  await expect(root).toHaveAttribute("data-motion", "subtle");
  expect(await root.evaluate((e) => e.style.getPropertyValue("--anim-speed"))).toBe("0.96");
  await panel.getByRole("button", { name: /Reset Animation /i }).first().click();
  await panel.getByRole("button", { name: /Reset Animation speed/ }).click();
  await panel.getByRole("tab", { name: "Appearance" }).click();
  expect(await clear(), "comfortable and 100%: the tools are clear of the view tabs").toBe(true);
  await panel.getByRole("button", { name: /Reset Density/ }).click();
  await expect(root).not.toHaveAttribute("data-density", /.*/);
  await expect(root).not.toHaveAttribute("data-contrast", /.*/);
  await expect(root).not.toHaveAttribute("data-motion", /.*/);
  expect(app.consoleErrors).toEqual([]);
});

test("view tabs: arrow keys move between Assets and Settings, the Canvas is the board pill; Assets is remembered over a reload, Settings is not (ADR 0048, 0079)", async ({ app }) => {
  const p = app.page;
  const view = () => p.evaluate(() => window.__canvastDebug.appView());
  await expect(p.getByTestId("view-canvas")).toHaveAttribute("aria-current", "page");
  await p.getByTestId("view-assets").click();
  expect(await view()).toBe("assets");
  await expect(p.getByTestId("view-canvas")).not.toHaveAttribute("aria-current", "page");
  await p.getByTestId("view-assets").focus(); // the opened view took the focus; the arrow keys work on the tab list
  await p.keyboard.press("ArrowRight");
  expect(await view()).toBe("settings");
  await expect(p.getByTestId("view-settings")).toHaveAttribute("aria-selected", "true");
  await p.keyboard.press("ArrowRight"); // wraps to the first tab
  expect(await view()).toBe("assets");
  await p.keyboard.press("ArrowLeft"); // and back round
  expect(await view()).toBe("settings");
  await p.getByTestId("view-canvas").click(); // the board pill is the way back to the canvas
  expect(await view()).toBe("canvas");
  await p.getByTestId("view-settings").click();
  await p.locator("#settings-view").getByRole("tab", { name: "Collaboration" }).click();
  await expect(p.locator("#set-panel-collaboration")).toContainText("Collaboration is off");
  await p.getByTestId("view-assets").click();
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  expect(await view(), "Assets is reopened").toBe("assets");
  await p.getByTestId("view-settings").click();
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  expect(await view(), "Settings is not reopened (the view before it is)").not.toBe("settings");
  expect(app.consoleErrors).toEqual([]);
});

test("theme colour: the hue and colourfulness dials recolour the interface but never change its contrast (ADR 0052)", async ({ app }) => {
  const p = app.page;
  const panel = p.locator("#settings-view");
  await p.getByTestId("view-settings").click();
  await panel.getByRole("tab", { name: "Appearance" }).click();
  /** Contrast of the selected view tab (its text on its fill) and the brightness of the canvas background, read from the real colours. */
  const measure = () =>
    p.evaluate(() => {
      const rgb = (css: string): [number, number, number] => {
        const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
        c.fillStyle = "#000";
        c.fillStyle = css;
        c.fillRect(0, 0, 1, 1);
        const d = c.getImageData(0, 0, 1, 1).data;
        return [d[0]!, d[1]!, d[2]!];
      };
      const lum = ([r, g, b]: [number, number, number]) => {
        const f = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const tab = getComputedStyle(document.querySelector('.view-switch [aria-selected="true"]')!);
      const a = lum(rgb(tab.backgroundColor));
      const b = lum(rgb(tab.color));
      const bg = rgb(getComputedStyle(document.body).backgroundColor);
      return { contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), bgLum: lum(bg), bg };
    });
  await panel.getByLabel("Colourfulness", { exact: true }).fill("150");
  const seen: Array<{ hue: number; contrast: number; bgLum: number; bg: number[] }> = [];
  for (const hue of [20, 90, 190, 265, 330]) {
    await panel.getByLabel("Theme colour", { exact: true }).fill(String(hue));
    expect(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--hue").trim())).toBe(String(hue));
    seen.push({ hue, ...(await measure()) });
  }
  for (const m of seen) expect(m.contrast, `accent text contrast at hue ${m.hue}`).toBeGreaterThanOrEqual(4.5);
  const lums = seen.map((m) => m.bgLum);
  expect(Math.max(...lums) - Math.min(...lums), "the surface keeps its brightness whatever the hue").toBeLessThan(0.02);
  expect(new Set(seen.map((m) => m.bg.join(","))).size, "but its colour does change").toBeGreaterThan(1);
  // A preset sets the hue; kept after a reload; Reset puts the default back.
  await panel.getByRole("button", { name: "Ultramarine" }).click();
  await expect(panel.getByLabel("Theme colour", { exact: true })).toHaveValue("265");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  expect(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--hue").trim())).toBe("265");
  await p.getByTestId("view-settings").click();
  await panel.getByRole("tab", { name: "Appearance" }).click();
  await panel.getByRole("button", { name: /Reset Theme colour/ }).click();
  expect(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--hue").trim())).toBe("178");
  expect(app.consoleErrors).toEqual([]);
});

test("Settings > Develop switches the developer tools on and off for every session; there is one HTML file (ADR 0067)", async ({ app }) => {
  const p = app.page;
  const plain = APP_URL.replace("#debug", "");
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Develop" }).click();
  const toggle = p.getByRole("checkbox", { name: "Developer tools" });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(p.getByText("Reload to apply the change.")).toBeVisible();
  // Without #debug on the address the tools are on now: the panel is there and the hook is installed.
  await p.goto(plain);
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(p.getByTestId("debug-panel")).toBeVisible();
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Develop" }).click();
  await p.getByRole("checkbox", { name: "Developer tools" }).uncheck();
  await p.goto(plain);
  await p.waitForFunction(() => document.documentElement.dataset["version"] !== undefined);
  expect(await p.evaluate(() => typeof window.__canvastDebug)).toBe("undefined");
  await expect(p.getByTestId("debug-panel")).toBeHidden();
  expect(app.consoleErrors).toEqual([]);
});

test("Zen mode fades the floating bars out, each shows while the pointer is over it, the Z key and the button toggle it, and it is remembered (ADR 0075)", async ({ app }) => {
  const p = app.page;
  const rail = p.locator("#toolbar > .rail");
  const readout = p.locator(".hud-readout");
  const zen = p.getByRole("button", { name: "Zen mode" });
  await expect(rail).toHaveCSS("opacity", "1");
  await zen.click();
  await expect(zen).toHaveAttribute("aria-pressed", "true");
  await p.mouse.move(600, 300); // away from every bar
  await expect(rail).toHaveCSS("opacity", "0");
  await expect(readout).toHaveCSS("opacity", "0");
  await rail.hover();
  await expect(rail).toHaveCSS("opacity", "1");
  await p.mouse.move(600, 300);
  await expect(rail).toHaveCSS("opacity", "0");
  // Reload: still on. The Z key turns it off, on the canvas.
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.mouse.move(600, 300);
  await expect(rail).toHaveCSS("opacity", "0");
  await p.locator("#canvas").focus();
  await p.keyboard.press("z");
  await expect(rail).toHaveCSS("opacity", "1");
  await expect(p.getByRole("button", { name: "Zen mode" })).toHaveAttribute("aria-pressed", "false");
  expect(app.consoleErrors).toEqual([]);
});

test("settings search: every word must match, all tabs show with only their matches and a count each, Escape clears, and a miss says so (ADR 0094)", async ({ app }) => {
  const p = app.page;
  const panel = p.locator("#settings-view");
  await p.getByTestId("view-settings").click();
  const search = p.getByTestId("settings-search");
  await search.fill("tag screenshot");
  await expect(panel.getByRole("tab", { name: /Screenshot/ }).locator(".set-hits")).toHaveText(/^[1-9]/);
  await expect(panel.getByRole("tab", { name: /Appearance/ }).locator(".set-hits")).toBeHidden();
  await expect(panel.locator('[data-row="shot.tagShot"]')).toBeVisible();
  await expect(panel.locator('[data-row="shot.format"]')).toBeHidden();
  await expect(panel.locator('[data-row="pen.kind"]')).toBeHidden();
  await search.fill("zzzz");
  await expect(p.getByTestId("settings-none")).toBeVisible();
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(panel).toBeVisible(); // the first Escape only clears the search
  await expect(panel.locator('[data-row="pen.kind"]')).toBeVisible();
  expect(app.consoleErrors).toEqual([]);
});
