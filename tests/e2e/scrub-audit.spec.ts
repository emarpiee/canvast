import { exportWith, expect, fieldLooks, test } from "./harness";
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
  // (and every field's look: one field style for the whole app, ADR 0201)
  const looks: Array<{ where: string; label: string; look: string; reads: string | null }> = [];
  const scan = async (where: string): Promise<void> => {
    found.push(...(await unscrubbed(app, where)));
    looks.push(...(await fieldLooks(p)).map((f) => ({ where, ...f })));
  };
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
  // A PDF's and a 3D model's views (their settings, where this machine has 3D graphics).
  await p.keyboard.press("Escape");
  await p.getByTestId("view-assets").click();
  const tinyPdf = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n";
  await p.getByTestId("assets-import-input").setInputFiles({ name: "audit.pdf", mimeType: "application/pdf", buffer: Buffer.from(tinyPdf, "latin1") });
  await p.locator('[data-testid="asset-card"][title="audit.pdf"]').dblclick({ timeout: 15_000 });
  await expect(p.getByTestId("pdf-page")).toBeVisible();
  await scan("a PDF's view");
  await p.keyboard.press("Escape");
  if (await p.evaluate(() => !!document.createElement("canvas").getContext("webgl2"))) {
    await p.getByTestId("assets-import-input").setInputFiles({ name: "audit.stl", mimeType: "model/stl", buffer: Buffer.from("solid a\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid a\n") });
    await p.locator('[data-testid="asset-card"][title="audit.stl"]').dblclick({ timeout: 15_000 });
    await expect(p.getByTestId("model-side")).toBeVisible();
    await scan("a 3D model's view");
    await p.keyboard.press("Escape");
  }
  const unique = found.filter((f) => !seen.has(`${f.where}|${f.label}`) && seen.add(`${f.where}|${f.label}`));
  console.log(`SCRUB AUDIT, fields looked at: ${Object.entries(checked).map(([k, n]) => `${k}: ${n}`).join("; ")}`);
  console.log(`SCRUB AUDIT: ${unique.length} number field(s) cannot be dragged:\n${unique.map((f) => `  ${f.where} — ${f.label} (${f.kind})`).join("\n")}`);
  expect(unique).toEqual([]);
  // one field style: every field looks as most do (its height aside), a number reads at the right; the odd ones, with where they are
  const counts = new Map<string, number>();
  for (const f of looks) counts.set(f.look, (counts.get(f.look) ?? 0) + 1);
  const usual = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const odd = [...new Set([
    ...looks.filter((f) => f.look !== usual).map((f) => `${f.where} — ${f.label}: ${f.look}`),
    ...looks.filter((f) => f.reads !== null && f.reads !== "right").map((f) => `${f.where} — ${f.label}: a number read at the ${f.reads}`),
  ])];
  console.log(`FIELD STYLE: ${looks.length} fields; the usual look: ${usual}`);
  expect(odd, "fields with a look of their own").toEqual([]);
});
