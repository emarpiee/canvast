// README pictures of "Privacy and hidden items" and the canvas context menu: work that must not be seen (a commission under NDA, say)
// hidden from the Library while sharing the screen, hidden mode to work on it, a padlock where it is placed, the passwords (manifest.ts).
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { test, expect, artFiles, OUT, type Scene } from "./scene";

/** A small collection with three drawings to hide; the Library open. */
async function setup(s: Scene): Promise<{ card: (f: string) => ReturnType<Scene["p"]["locator"]>; h: (f: string) => string }> {
  const hs = await s.art("degas", "delacroix", "bonheur", "hokusai-under", "hokusai-seaside", "waterloo");
  const files = artFiles("degas", "delacroix", "bonheur", "hokusai-under", "hokusai-seaside", "waterloo");
  const h = (f: string): string => hs[files.indexOf(f)]!;
  await s.p.getByTestId("view-assets").click();
  return { card: (f: string) => s.p.locator(`[data-testid="asset-card"][data-hash="${h(f)}"]`), h };
}
async function hide(s: Scene, card: ReturnType<Scene["p"]["locator"]>): Promise<void> {
  await card.click();
  await s.p.getByTestId("asset-hide").click();
  await s.settle();
}

test("context-menu", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 178 });
  const [h] = await s.art("hokusai-under");
  await s.canvas("Refs");
  const [id] = await s.place([h!]);
  await s.fit([id!], 0.55, [0.4, 0.5]);
  const b = (await s.box([id!]))!;
  await s.select([id!]);
  await s.p.mouse.click((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, { button: "right" });
  await expect(s.p.locator(".pop-menu")).toBeVisible();
  await s.shot("context-menu", await s.around({ objects: [id!], els: [".pop-menu"], pad: 24 }));
});

test("library-hide", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 20 });
  const { card } = await setup(s);
  await card(artFiles("degas-dancer_onstage")[0]!).click();
  await s.p.getByTestId("asset-hide").hover();
  await s.shot("library-hide");
});

test("hidden-list", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 300 });
  const { card } = await setup(s);
  for (const f of artFiles("degas")) await hide(s, card(f));
  await s.p.getByTestId("assets-search").fill("hidden:");
  await expect(s.p.getByTestId("asset-card").first()).toBeVisible();
  await s.blur();
  await s.settle();
  await s.shot("hidden-list");
});

test("padlock", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 300 });
  const { h, card } = await setup(s);
  await s.p.getByTestId("view-canvas").click();
  await s.canvas("Commission");
  const ids = await s.placeRow([h(artFiles("degas-dancer_onstage")[0]!), h(artFiles("hokusai-under")[0]!)]);
  await s.p.getByTestId("view-assets").click();
  await hide(s, card(artFiles("degas-dancer_onstage")[0]!));
  await s.p.getByTestId("view-canvas").click();
  await expect.poll(() => s.p.evaluate((x) => window.__canvastDebug.pictureLocked(x), h(artFiles("degas-dancer_onstage")[0]!))).toBe(true);
  await s.fit(ids, 0.6);
  await s.shot("padlock", await s.around({ objects: ids, pad: 40 }));
});

test("export-hidden", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 210 });
  const { card } = await setup(s);
  await hide(s, card(artFiles("degas-dancer_onstage")[0]!));
  await s.p.getByTestId("view-canvas").click();
  await s.p.getByTestId("save-status").click();
  await s.p.getByTestId("set-export-full").click();
  await s.p.getByTestId("choose-dialog").waitFor();
  await s.shot("export-hidden", await s.around({ els: ['[data-testid="choose-dialog"]'], pad: 40 }));
});

async function passwords(s: Scene): Promise<void> {
  await s.p.getByTestId("view-settings").click();
  await s.p.getByRole("tab", { name: /Privacy/ }).click();
  for (const kind of ["workspace", "hidden"]) {
    await s.p.getByTestId(`${kind}-pw-set`).click();
    for (let i = 0; i < 2; i++) {
      await s.p.getByTestId("prompt-input").fill("correct horse");
      await s.p.getByTestId("prompt-ok").click();
    }
    await expect(s.p.locator(`[data-pw-card="${kind}"] [data-pw-state]`)).toContainText("password was set");
  }
}

test("privacy", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 178 });
  await passwords(s);
  await s.settle();
  await s.shot("privacy");
});

test("lock-screen", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 178 });
  await passwords(s);
  await s.p.reload();
  await s.p.getByTestId("lock-screen").waitFor();
  await s.p.waitForTimeout(400); // (nothing is loaded behind it, so there is no frame to wait for)
  mkdirSync(OUT, { recursive: true });
  await s.p.screenshot({ path: resolve(OUT, "lock-screen.png") });
});
