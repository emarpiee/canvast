// README pictures of "Integration" (PhotoCraft) and of the bars it changed: a study opened in PhotoCraft from the canvas, the button that
// opens it, two pictures as layers of one document, the size of a layered project, the type of a new document's first save, its
// Settings page, the view buttons at the top left and the panels' buttons on the right edge.
import type { Page } from "@playwright/test";
import { test, expect } from "./scene";
import { makePsd } from "../e2e/png";

/** PhotoCraft's view shown and running (its loading message gone). */
async function running(p: Page): Promise<void> {
  await expect(p.getByTestId("photocraft-view")).toBeVisible();
  await expect.poll(() => p.evaluate(() => {
    const d = document.querySelector<HTMLIFrameElement>(".photocraft-frame")?.contentDocument;
    return !!d?.getElementById("photocraft_canvas") && !d.getElementById("photocraft_loading");
  }), { timeout: 120_000 }).toBe(true);
}

/** What PhotoCraft's page does to save: a download of a blob made in its frame (canvast takes it). */
const saveInPhotoCraft = (p: Page, name: string, bytes: Buffer, type: string): Promise<void> =>
  p.evaluate(([n, b, t]) => {
    const w = document.querySelector<HTMLIFrameElement>(".photocraft-frame")!.contentWindow! as Window & typeof globalThis;
    const a = w.document.createElement("a");
    a.href = w.URL.createObjectURL(new w.Blob([new w.Uint8Array(b as number[])], { type: t as string }));
    a.download = n as string;
    w.document.body.append(a);
    a.click();
    a.remove();
  }, [name, [...bytes], type] as const);

test("photocraft", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 30 });
  const [horse] = await s.art("delacroix");
  await s.canvas("Studies");
  const [id] = await s.place([horse!]);
  await s.fit([id!], 0.6);
  await s.p.evaluate((i) => window.__canvastDebug.select([i]), id!);
  await s.settle();
  await s.shot("photocraft-edit", await s.around({ objects: [id!], els: ['[data-ctx="photocraft"]'], pad: 20 }));
  await s.p.locator('[data-ctx="photocraft"]').click();
  await running(s.p);
  await s.settle(3000); // (the study opened in it, drawn)
  await s.shot("photocraft");
  await s.shot("view-buttons", await s.around({ els: ["#nav"], pad: 8 }));
});

test("photocraft-layers", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 300 });
  const art = await s.art("degas-dancer_adjusting", "degas-dancer_with");
  await s.canvas("Dancers");
  const ids = await s.placeRow(art);
  await s.fit(ids, 0.62);
  await s.p.evaluate((i) => window.__canvastDebug.select(i), ids);
  await s.settle();
  await s.p.locator('[data-ctx="photocraft"]').click();
  await expect(s.p.locator('[data-id="photocraft-layers"]')).toBeVisible();
  await s.shot("photocraft-layers", await s.around({ objects: ids, els: ['[data-id="photocraft-layers"]'], pad: 20 }));
  await s.p.locator('[data-id="photocraft-layers"]').click();
  await expect(s.p.getByTestId("photocraft-size")).toBeVisible();
  await s.shot("photocraft-size", await s.around({ els: ['[data-testid="photocraft-size"]'], pad: 24 }));
});

test("photocraft-save-type", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 178 });
  await s.p.getByTestId("view-photocraft").click();
  await running(s.p);
  // (a new document saved for the first time: its page writes it as PSD, and canvast asks the type, as its desktop app does)
  await saveInPhotoCraft(s.p, "Untitled-1.psd", makePsd(64, 48, [200, 120, 60]), "image/vnd.adobe.photoshop");
  await expect(s.p.getByTestId("choose-dialog")).toBeVisible();
  await s.shot("photocraft-save-type", await s.around({ els: ['[data-testid="choose-dialog"]'], pad: 24 }));
});

test("photocraft-settings", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 30 });
  await s.p.getByTestId("view-settings").click();
  await s.p.locator("#set-tab-photocraft").click();
  await s.settle();
  await s.shot("photocraft-settings");
});

test("panel-buttons", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 178 });
  const art = await s.art("hokusai-under", "hokusai-mystical", "hokusai-seaside");
  await s.canvas("Prints");
  const ids = await s.placeRow(art);
  await s.fit(ids, 0.5, [0.38, 0.5]);
  await s.p.getByRole("button", { name: "Layers panel" }).click();
  await expect(s.p.getByTestId("layers-panel")).toBeVisible();
  await s.settle();
  await s.shot("panel-buttons", await s.around({ els: ["#toolbar > .dock", '[data-testid="layers-panel"]', ".view-settings"], pad: 10 }));
});

test("art-pictures", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 30 });
  await s.p.getByTestId("view-settings").click();
  await s.p.getByRole("tab", { name: "Performance" }).click();
  await s.settle();
  await s.shot("art-pictures", await s.around({ els: ['[data-row="quality.artCards"]'], pad: 12 }));
});
