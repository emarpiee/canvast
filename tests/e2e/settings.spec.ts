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

test("appearance: motion, density and corners apply at once, persist, and the tools never sit under the view tabs (ADR 0050)", async ({ app }) => {
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
  await panel.getByRole("tab", { name: "Performance" }).click();
  await panel.getByLabel("Animation", { exact: true }).selectOption("reduce");
  await panel.getByRole("tab", { name: "Appearance" }).click();
  // Compact is the default; comfortable loosens every floating element on one grid (the dock, the tabs and the rail share the control size).
  const dockHeight = async () => (await p.locator("#toolbar > .dock").boundingBox())!.height;
  const compact = await dockHeight();
  await expect(root).not.toHaveAttribute("data-density", /.*/);
  // Sharp corners: every radius token goes to zero (a button of the view, the dock, a round dot).
  const radii = () => p.evaluate(() => [".set-tabs button", "#toolbar > .dock", ".set-colour-dot"].map((q) => (document.querySelector(q) ? getComputedStyle(document.querySelector(q)!).borderRadius : "none")));
  expect((await radii())[0], "round by default").not.toBe("0px");
  await panel.getByLabel("Corners", { exact: true }).selectOption("sharp");
  await expect(root).toHaveAttribute("data-corners", "sharp");
  expect((await radii()).filter((r) => r !== "none" && r !== "0px"), "no radius left").toEqual([]);
  await panel.getByLabel("Corners", { exact: true }).selectOption("round");
  await expect(root).not.toHaveAttribute("data-corners", /.*/);
  await panel.getByLabel("Density", { exact: true }).selectOption("dense");
  await expect(root).toHaveAttribute("data-density", "dense");
  expect(await dockHeight(), "dense: a smaller dock").toBeLessThan(compact);
  await panel.getByLabel("Density", { exact: true }).selectOption("comfortable");
  await expect(root).toHaveAttribute("data-density", "comfortable");
  expect(await dockHeight(), "comfortable: a larger dock").toBeGreaterThan(compact);
  await expect(root).toHaveAttribute("data-motion", "reduce");
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(root).toHaveAttribute("data-density", "comfortable"); // kept over the reload
  expect(await clear(), "comfortable: the tools are clear of the view tabs").toBe(true);
  // Back to the defaults leaves no attribute behind.
  await p.getByTestId("view-settings").click();
  await panel.getByRole("tab", { name: "Appearance" }).click();
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
  expect(await clear(), "comfortable: the tools are clear of the view tabs").toBe(true);
  await panel.getByRole("button", { name: /Reset Density/ }).click();
  await expect(root).not.toHaveAttribute("data-density", /.*/);
  await expect(root).not.toHaveAttribute("data-motion", /.*/);
  expect(app.consoleErrors).toEqual([]);
});

test("views: the Assets tab, the Settings button at the end of the dock and the Canvas infinity button; Assets is remembered over a reload, Settings is not (ADR 0048, 0079)", async ({ app }) => {
  const p = app.page;
  const view = () => p.evaluate(() => window.__canvastDebug.appView());
  await expect(p.getByTestId("view-canvas")).toHaveAttribute("aria-current", "page");
  await p.getByTestId("view-assets").click();
  expect(await view()).toBe("assets");
  await expect(p.getByTestId("view-canvas")).not.toHaveAttribute("aria-current", "page");
  await p.getByTestId("view-settings").click();
  expect(await view()).toBe("settings");
  await expect(p.getByTestId("view-settings")).toHaveAttribute("aria-pressed", "true");
  await expect(p.getByTestId("view-assets")).toHaveAttribute("aria-selected", "false");
  await p.getByTestId("view-assets").click();
  expect(await view()).toBe("assets");
  await expect(p.getByTestId("view-settings")).toHaveAttribute("aria-pressed", "false");
  await p.getByTestId("view-settings").click();
  await p.getByTestId("view-canvas").click(); // the infinity button is the way back to the canvas
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
      const tab = getComputedStyle(document.querySelector('[data-view="settings"][aria-pressed="true"]')!);
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

test("Settings > Performance holds the quality held when adaptive quality is off and the memory for pictures; About lists what the browser can do, the errors of the session, the licences and saves a report (ADR 0135)", async ({ app }) => {
  const p = app.page;
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Performance" }).click();
  const level = () => p.evaluate(() => window.__canvastDebug.qualityLevel());
  expect(await level()).toBe(0);
  // (the test build pins the level; asking for another one while adaptive quality is on changes nothing)
  await p.getByRole("combobox", { name: "Memory for pictures" }).selectOption("128");
  expect((await p.evaluate(() => window.__canvastDebug.decodedStats())).budget).toBe(128 * 2 ** 20);
  await p.getByRole("combobox", { name: "Memory for pictures" }).selectOption("384");
  await p.getByRole("tab", { name: "About and diagnostics" }).click();
  await expect(p.getByTestId("about-version")).not.toHaveText("");
  await expect(p.getByTestId("about-capabilities")).toContainText("IndexedDB");
  await expect(p.getByTestId("about-errors")).toContainText("none");
  await p.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "Test failure", filename: "x.js", lineno: 7 })));
  await expect(p.getByTestId("about-errors")).toContainText("Test failure (x.js:7)");
  await p.getByText("Software this app is built from").click();
  await expect(p.getByTestId("about-licences")).toContainText("Lucide");
  const [file] = await Promise.all([p.waitForEvent("download"), p.getByTestId("about-report").click()]);
  expect(file.suggestedFilename()).toMatch(/^canvast-diagnostics-\d{4}-\d{2}-\d{2}\.txt$/);
  const text = await (await import("node:fs/promises")).readFile((await file.path())!, "utf8");
  expect(text).toContain("canvast diagnostic report");
  expect(text).toContain("Test failure");
  expect(text).toContain("holds no canvas content");
  await p.getByTestId("about-clear").click();
  await expect(p.getByTestId("about-errors")).toContainText("none");
  app.consoleErrors.length = 0; // (the error above was made on purpose)
  expect(app.consoleErrors).toEqual([]);
});

test("Adaptive theme colour: the hue follows the canvas background colour, and the hue set by hand comes back when it is off", async ({ app }) => {
  const p = app.page;
  const hue = () => p.evaluate(() => document.documentElement.style.getPropertyValue("--hue"));
  await p.evaluate(() => localStorage.setItem("canvast.settings", JSON.stringify({ "ui.hue": 40, "ui.background": "#2a6fdb", "ui.hueAdaptive": true })));
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  const adaptive = Number(await hue());
  expect(adaptive, "the hue of a blue background (OKLCH about 260), not the 40 set by hand").toBeGreaterThan(240);
  expect(adaptive).toBeLessThan(280);
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Appearance" }).click();
  await p.getByRole("button", { name: "Adaptive" }).click();
  expect(await hue()).toBe("40");
});

test("the Information button keeps one icon and says how much is shown with a number (0 to 3)", async ({ app }) => {
  const p = app.page;
  const button = p.locator('[data-action="info"]');
  const levels: string[] = [];
  for (let i = 0; i < 4; i++) {
    levels.push((await button.getAttribute("data-level"))!);
    await button.click();
  }
  expect([...levels].sort()).toEqual(["0", "1", "2", "3"]);
  expect(await button.getAttribute("data-level"), "back to where it started").toBe(levels[0]);
});

test("a custom canvas background is what the canvas draws, and the grid and the marks on it follow it", async ({ app }) => {
  const p = app.page;
  const grid = () => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--canvas-grid").trim());
  const plain = await grid();
  await p.evaluate(() => localStorage.setItem("canvast.settings", JSON.stringify({ "ui.background": "#d98c5f" })));
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(p.locator("html")).toHaveAttribute("data-custom-bg", "");
  expect(await p.evaluate(() => document.documentElement.style.getPropertyValue("--canvas-bg"))).toBe("#d98c5f");
  expect(await grid(), "the grid is made from the background").not.toBe(plain);
  const [r, g, b] = await p.evaluate(() => window.__canvastDebug.pixelAt(5, 5)); // (an empty corner away from the grid lines)
  expect(Math.abs(r! - 0xd9) + Math.abs(g! - 0x8c) + Math.abs(b! - 0x5f), "the canvas is the colour").toBeLessThan(40);
});
