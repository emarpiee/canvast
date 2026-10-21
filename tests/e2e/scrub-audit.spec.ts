import { exportWith, expect, test } from "./harness";
import type { App } from "./harness";
import { makePng } from "./png";

/**
 * Audit: every number field of the app can be dragged to change it (the shared scrub, `colour-picker/scrub.ts`, or the toolbar's own). A number
 * field is `<input type="number">` or a text field with a numeric `inputmode`; it scrubs when it sits under a `data-scrub` label (the toolbar) or
 * under a `data-scrub-root` and has a label (the shared scrub marks it on the first pointer over). The surfaces below are opened one by one and
 * every field that shows is checked; what cannot scrub is listed with where it is.
 */
type Field = { where: string; label: string; kind: string };

/** The visible number fields that cannot be dragged. */
const checked: Record<string, number> = {};
const unscrubbed = (app: App, where: string): Promise<Field[]> =>
  app.page.evaluate((w) => {
    const out: Field[] = [];
    let n = 0;
    type Field = { where: string; label: string; kind: string };
    for (const el of document.querySelectorAll<HTMLInputElement>('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest("[hidden]") || el.disabled || el.readOnly) continue;
      n++;
      const scrubs = !!el.closest("[data-scrub]") || (!!el.closest("[data-scrub-root]") && (el.labels?.length ?? 0) > 0);
      if (scrubs) continue;
      const label = el.getAttribute("aria-label") || el.labels?.[0]?.textContent?.trim() || el.name || el.className;
      out.push({ where: w, label: label.slice(0, 50), kind: el.type === "number" ? "number" : `text ${el.inputMode}` });
    }
    return { out, n };
  }, where).then(({ out, n }) => ((checked[where] = n), out));

test("audit: every number field of the app scrubs (lists the ones that do not)", async ({ app }) => {
  const p = app.page;
  const found: Field[] = [];
  const scan = async (where: string): Promise<void> => void found.push(...(await unscrubbed(app, where)));
  // a shape, a picture and a text on the canvas, so every bar and panel has something to show
  await p.keyboard.press("u");
  await app.drag({ x: 480, y: 300 }, { x: 640, y: 400 }, 6);
  await p.keyboard.press("v");
  await scan("Properties bar: a shape");
  // every panel of the panels bar, open together
  for (const t of await p.locator(".layers-toggle").all()) await t.click({ timeout: 2000 }).catch(() => undefined);
  await app.frame();
  await scan("panels (Layers, Tags, Styles, Adjust, Pattern, Bookmarks)");
  await p.click("[data-pattern-panel]", { timeout: 2000 }).catch(() => undefined);
  await scan("Pattern panel");
  // a pattern on a new sheet: the bar of a picked sheet, with the pattern's own fields
  await p.getByTestId("pattern-make").click({ timeout: 2000 }).catch(() => undefined);
  await app.frame();
  await scan("Properties bar: a sheet, and the Pattern panel with a result");
  // a picture, a text and a pen stroke
  await p.getByTestId("import-input").setInputFiles({ name: "pic.png", mimeType: "image/png", buffer: makePng(120, 80, (x, y) => [x * 2, y * 3, 100, 255]) });
  await app.frame();
  await scan("Properties bar and Adjust panel: a picture");
  await p.keyboard.press("t");
  await p.mouse.click(300, 600);
  await p.keyboard.type("text");
  await p.keyboard.press("Escape");
  await app.frame();
  await scan("Properties bar: a text");
  await p.keyboard.press("p");
  await app.drag({ x: 700, y: 560 }, { x: 800, y: 620 }, 8);
  await app.frame();
  await scan("Properties bar: a pen stroke");
  // the colour picker of the fill
  await p.locator('[data-paint="fill"]').first().click({ timeout: 2000 }).catch(() => undefined);
  await scan("colour picker popover");
  await p.keyboard.press("Escape");
  // Export…
  await Promise.race([exportWith(p, "exportpic"), new Promise((r) => setTimeout(r, 5000))]).catch(() => undefined);
  await scan("Export dialog");
  await p.locator('[data-ex="close"]').click({ timeout: 2000 }).catch(() => undefined);
  // Settings: every tab
  await p.getByTestId("view-settings").click();
  for (const tab of await p.locator("#settings-view").getByRole("tab").all()) {
    await tab.click();
    await scan(`Settings: ${(await tab.innerText()).trim()}`);
  }
  const seen = new Set<string>();
  const unique = found.filter((f) => !seen.has(`${f.where}|${f.label}`) && seen.add(`${f.where}|${f.label}`));
  console.log(`SCRUB AUDIT, fields looked at: ${Object.entries(checked).map(([k, n]) => `${k}: ${n}`).join("; ")}`);
  console.log(`SCRUB AUDIT: ${unique.length} number field(s) cannot be dragged:\n${unique.map((f) => `  ${f.where} — ${f.label} (${f.kind})`).join("\n")}`);
  expect(unique).toEqual([]);
});
