// README pictures of "The endless canvas", "Your workspace and data", "Exporting and sharing" and "The interface, settings and keys":
// the showcase for depth, a studio's boards for moving around, and each panel and dialog doing its job (manifest.ts).
import { resolve } from "node:path";
import { APP_URL, exportWith } from "../e2e/harness";
import { test, expect, type Scene } from "./scene";

/** The showcase (showcase.canvast, drawn by scripts/showcase/build.mjs) imported and its canvas open. */
async function showcase(s: Scene): Promise<void> {
  const p = s.p;
  await p.getByTestId("save-status").click();
  await p.getByTestId("set-import-input").setInputFiles(resolve("showcase.canvast"));
  await p.getByTestId("choose-ok").click();
  await p.getByTestId("confirm-ok").click();
  await expect(p.getByTestId("toast").filter({ hasText: /Imported/ })).toBeVisible({ timeout: 60_000 });
  await p.keyboard.press("Escape");
  await p.getByTestId("workspace-nav").click();
  await p.getByTestId("workspace-menu").getByText("Powers of two", { exact: true }).click();
  if (await p.getByTestId("workspace-menu").isVisible()) await p.keyboard.press("Escape");
  await s.blur();
}
async function bookmarks(s: Scene, open: boolean): Promise<void> {
  if ((await s.p.locator(".bookmarks-panel").isVisible()) !== open) await s.p.getByRole("button", { name: "Bookmarks panel", exact: true }).click();
}
async function go(s: Scene, name: string): Promise<void> {
  await bookmarks(s, true);
  await s.p.getByRole("button", { name: `Go to ${name}` }).click();
  await s.settle(900);
  await bookmarks(s, false);
}
/** A studio's boards: a picture book and its references, with canvases named as such work is. */
async function studio(s: Scene): Promise<void> {
  const p = s.p;
  const op = (...a: string[]): Promise<void> => p.evaluate((x) => window.__canvastDebug.workspaceOp(...(x as [never])), a);
  const tree = async () => (await p.evaluate(() => window.__canvastDebug.session().tree))!;
  // (each board's first canvas is renamed, the others added)
  const fill = async (boardId: string, names: string[]): Promise<void> => {
    for (const [i, name] of names.entries()) {
      if (i > 0) await op("newCanvas", boardId);
      const b = (await tree()).find((x) => x.id === boardId)!;
      await op("renameCanvas", b.canvases.at(-1)!.id, name);
    }
  };
  const first = (await tree())[0]!;
  await op("renameBoard", first.id, "Picture book");
  await fill(first.id, ["Cover", "Spread 1", "Spread 2"]);
  await op("newBoard");
  const refs = (await tree()).at(-1)!;
  await op("renameBoard", refs.id, "References");
  await fill(refs.id, ["Horses", "Landscapes"]);
}

test("hero", async ({ scene: s }) => {
  await showcase(s);
  await go(s, "1 · The Solar System");
  await s.shot("hero");
});

test("deep-zoom", async ({ scene: s }) => {
  await showcase(s);
  await go(s, "19 · One million levels down");
  await s.shot("deep-zoom");
});

test("zoom-out", async ({ scene: s }) => {
  await showcase(s);
  await go(s, "7 · The multiverse (1,000 levels up)");
  await s.shot("zoom-out");
});

test("tour", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 300 });
  await showcase(s);
  await bookmarks(s, true);
  await s.p.getByRole("button", { name: "Play the bookmarks as a tour" }).click();
  for (let i = 0; i < 12; i++) { await s.p.keyboard.press("ArrowRight"); await s.settle(150); }
  await s.shot("tour");
});

test("switcher", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 40 });
  await studio(s);
  await s.p.getByTestId("workspace-nav").click();
  await expect(s.p.getByTestId("workspace-menu")).toBeVisible();
  await s.shot("switcher", await s.around({ els: ['[data-testid="workspace-menu"]', '[data-testid="workspace-nav"]'], pad: 20 }));
});

test("bookmarks", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 40 });
  const art = await s.art("delacroix", "bonheur", "degheyn", "hokusai-under");
  await s.canvas("References");
  const ids = await s.placeRow(art, 400);
  for (const id of ids) {
    await s.fit([id], 0.6);
    await bookmarks(s, true);
    await s.p.getByRole("button", { name: "Add bookmark" }).click();
    await s.settle();
  }
  await s.settle();
  await s.shot("bookmarks");
});

test("canvas-search", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 160 });
  const art = await s.art("degas", "delacroix", "bonheur", "hokusai-under");
  await s.canvas("Studies");
  const ids = await s.placeRow(art);
  await s.select(ids.slice(0, 4));
  await s.p.getByRole("button", { name: "Tags panel", exact: true }).click();
  await s.p.getByLabel("Add a tag to the selection").fill("gesture");
  await s.p.keyboard.press("Enter");
  await s.p.getByRole("button", { name: "Tags panel", exact: true }).click();
  await s.select([]);
  await s.fit(ids, 0.8);
  await s.p.locator("#canvas").focus();
  await s.p.keyboard.press("Control+f");
  await s.p.keyboard.type("#gesture");
  await s.settle(600);
  await s.shot("canvas-search");
});

test("command-palette", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 178 });
  const art = await s.art("hokusai-under");
  await s.canvas("Refs");
  const [id] = await s.place(art);
  await s.fit([id!], 0.6);
  await s.select([id!]);
  await s.p.keyboard.press("Control+k");
  await s.p.keyboard.type("flip");
  await s.settle();
  await s.shot("command-palette");
});

test("settings", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 178 });
  await s.p.getByTestId("view-settings").click();
  await s.p.getByRole("tab", { name: "Appearance" }).click();
  await s.settle();
  await s.shot("settings");
});

test("shortcuts", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 260 });
  await s.p.getByTestId("view-settings").click();
  await s.p.getByRole("tab", { name: "Shortcuts" }).click();
  await s.settle();
  await s.shot("shortcuts");
});

test("info-bar", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 178 });
  const art = await s.art("hokusai-under", "vangogh");
  await s.canvas("Refs");
  await s.placeRow(art);
  await s.p.evaluate(() => window.__canvastDebug.setSetting("ui.info", "technical"));
  await s.settle(1200);
  await s.shot("info-bar", { x: 0, y: 900 - 70, width: 1440, height: 70 });
});

test("storage", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 210 });
  await s.p.getByTestId("save-status").click();
  await s.settle();
  await s.shot("storage");
});

test("advanced-export", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 210 });
  const hs = await s.art("hokusai");
  await s.p.getByTestId("save-status").click();
  await s.p.getByTestId("set-export-advanced").click();
  await expect(s.p.getByTestId("advanced-export")).toBeVisible();
  for (const h of hs.slice(0, 3)) await s.p.locator(`[data-ax-item="${h}"]`).check();
  await s.settle();
  await s.shot("advanced-export", await s.around({ els: ['[data-testid="advanced-export"]'], pad: 30 }));
});

test("delete-all", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 20 });
  await s.p.getByTestId("save-status").click();
  await s.p.getByTestId("reset-all").click();
  await s.settle();
  await s.shot("delete-all");
});

test("take-over", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 178 });
  const art = await s.art("hokusai-under", "hokusai-seaside");
  await s.canvas("Refs");
  await s.placeRow(art);
  await s.fit();
  const second = await s.p.context().newPage();
  await second.goto(APP_URL);
  await second.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await second.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
  await expect.poll(() => second.evaluate(() => window.__canvastDebug.session().readOnly)).toBe(true);
  await second.waitForTimeout(800);
  await second.mouse.move(720, 894);
  await second.screenshot({ path: resolve(process.env["CANVAST_SHOTS_DIR"] ?? "shots", "take-over.png") });
});

test("export", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 220 });
  const art = await s.art("hokusai-seaside", "leprince", "verhaecht", "hokusai-under");
  await s.canvas("Page 1");
  const ids = await s.place(art);
  await s.fit(ids, 0.6);
  await s.select(ids);
  await s.p.keyboard.press("Shift+A");
  await expect.poll(async () => (await s.objects()).some((o) => o.container)).toBe(true);
  const pg = (await s.objects()).find((o) => o.container)!.id;
  await s.select([pg]);
  await s.p.locator('[data-layout-flow="grid"]').click();
  await s.p.locator("[data-layout-columns]").fill("2");
  await s.p.locator("[data-layout-columns]").press("Enter");
  await s.select([pg]);
  await exportWith(s.p, "exportpic");
  await s.settle(1000);
  await s.shot("export");
});

test("export-each", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 220 });
  const art = await s.art("hokusai-seaside", "leprince", "verhaecht", "hokusai-under");
  await s.canvas("Panels");
  const ids = await s.placeRow(art);
  await s.select(ids);
  await exportWith(s.p, "exportpic");
  // (it may open as one picture of all four, with a button for each on its own)
  await s.settle(600);
  if (await s.p.getByTestId("export-each").isVisible()) await s.p.getByTestId("export-each").click();
  await s.p.locator("[data-mini]").nth(1).waitFor();
  // (one print left out, the files named by a pattern, and a 2× copy of each for screens that need it)
  await s.p.locator('[data-mini="3"] [data-tick]').uncheck();
  await s.p.locator('[data-ex="name"]').fill("{n}-{name}");
  await s.p.locator('[data-variant="2x"]').click();
  await s.settle(1000);
  await s.shot("export-each");
});
