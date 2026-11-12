// README pictures of PDFs and 3D models in the Library, and the question a backup's import asks: a study handout on reading a
// woodblock print, a turned vase for a lighting study, and the import choice (manifest.ts).
import { resolve } from "node:path";
import { test, expect, type Scene } from "./scene";

// (the 3D view needs WebGL: the software rasterizer on runners without a GPU)
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } });

/** A PDF of pages, each a title, paragraphs of set lines and a figure: as a study handout is laid out (Helvetica, A4). */
function pdf(pages: Array<{ title: string; text: string[][]; figure: string; colour: string }>): Buffer {
  const esc = (s: string): string => s.replace(/[()\\]/g, (c) => "\\" + c);
  const objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  pages.forEach((pg, i) => {
    let y = 770;
    const lines = [`BT /F2 24 Tf 60 ${y} Td (${esc(pg.title)}) Tj ET`];
    y -= 36;
    for (const para of pg.text) {
      for (const line of para) lines.push(`BT /F1 12 Tf 60 ${(y -= 17)} Td (${esc(line)}) Tj ET`);
      y -= 12;
    }
    lines.push(`${pg.colour} rg 60 ${y - 190} 475 170 re f 0 0 0 rg BT /F1 10 Tf 60 ${y - 208} Td (${esc(`Figure ${i + 1}. ${pg.figure}`)}) Tj ET`);
    lines.push(`BT /F1 10 Tf 290 40 Td (${i + 1}) Tj ET`);
    const text = lines.join("\n");
    objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objs[6 + i * 2] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  });
  let s = "%PDF-1.4\n";
  const at: number[] = [];
  for (let i = 1; i < objs.length; i++) { at[i] = s.length; s += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = s.length;
  s += `xref\n0 ${objs.length}\n0000000000 65535 f \n${at.slice(1).map((a) => `${String(a).padStart(10, "0")} 00000 n \n`).join("")}`;
  s += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, "latin1");
}
const HANDOUT = pdf([
  { title: "Reading a woodblock print", colour: "0.84 0.78 0.66", figure: "The key block carries the outlines; each colour has a block of its own.", text: [
    ["A Japanese woodblock print is made from several carved blocks.", "The key block holds the black outlines; every colour is printed", "from a block of its own, one after another, by hand."],
    ["Look for where the colours meet the lines: a slight shift", "shows two blocks that did not quite register."],
  ] },
  { title: "Prussian blue", colour: "0.12 0.23 0.37", figure: "A swatch close to the deep blue of the wave.", text: [
    ["The Great Wave is printed in a deep, lasting blue that was new", "to Japanese printmakers in the 1820s and 1830s: Prussian blue."],
    ["Mixing it, start darker than you think. Thinned, it turns", "cold and clear; at full strength it is almost black."],
  ] },
  { title: "Composition", colour: "0.70 0.74 0.78", figure: "Mount Fuji, small and low, framed by the trough of the wave.", text: [
    ["Mount Fuji is the smallest thing in the picture and sits low,", "framed by the trough of the wave. The eye goes to it last."],
    ["Copy it with the Pen in one stroke: the big curve of the wave", "first, then the boats as three simple masses."],
  ] },
]);

/** A turned vase as an ASCII STL: a profile spun round, the kind of simple object a still-life lighting study starts with. */
function vase(n = 72): Buffer {
  const profile: Array<[number, number]> = [[0.0, 0], [0.42, 0], [0.48, 0.08], [0.62, 0.35], [0.66, 0.6], [0.55, 0.9], [0.32, 1.15], [0.24, 1.35], [0.3, 1.5], [0.36, 1.55]];
  const ring = (k: number, j: number): [number, number, number] => { const a = (j / n) * Math.PI * 2; const [r, z] = profile[k]!; return [r * Math.cos(a), r * Math.sin(a), z]; };
  const f: string[] = [];
  const tri = (t: Array<[number, number, number]>): void => {
    const u = t[1]!.map((x, k) => x - t[0]![k]!), v = t[2]!.map((x, k) => x - t[0]![k]!);
    const nn = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const l = Math.hypot(...nn) || 1;
    f.push(`facet normal ${nn.map((x) => (x / l).toFixed(5)).join(" ")}\nouter loop\n${t.map((q) => `vertex ${q.map((x) => x.toFixed(5)).join(" ")}`).join("\n")}\nendloop\nendfacet`);
  };
  for (let k = 0; k < profile.length - 1; k++) for (let j = 0; j < n; j++) {
    const [a, b, c, d] = [ring(k, j), ring(k, j + 1), ring(k + 1, j + 1), ring(k + 1, j)];
    tri([a, b, c]); tri([a, c, d]);
  }
  return Buffer.from(`solid vase\n${f.join("\n")}\nendsolid vase\n`);
}

async function files(s: Scene): Promise<void> {
  await s.library([{ name: "reading_a_woodblock_print.pdf", mimeType: "application/pdf", buffer: HANDOUT }, { name: "vase_for_light_study.stl", mimeType: "application/octet-stream", buffer: vase() }]);
  await s.p.getByTestId("view-assets").click();
}

test("pdf-view", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 210 });
  await files(s);
  await s.p.locator('[data-testid="asset-card"][title="reading_a_woodblock_print.pdf"]').dblclick();
  await s.p.locator('[data-testid="pdf-view"] .pdf-page[data-page="1"][data-drawn]').waitFor();
  await s.settle(800);
  await s.shot("pdf-view");
});

test("model-view", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 30 });
  await files(s);
  await s.p.locator('[data-testid="asset-card"][title="vase_for_light_study.stl"]').dblclick();
  await s.p.locator('[data-testid="model-stage"][data-drawn]').waitFor({ timeout: 60_000 });
  const box = (await s.p.getByTestId("model-stage").boundingBox())!;
  await s.p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await s.p.mouse.down();
  await s.p.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 70, { steps: 8 }); // (turned a little: seen from above)
  await s.p.mouse.up();
  await s.settle(800);
  await s.shot("model-view");
});

/** The vase open in its 3D view, turned a little to be seen from above, in a line style; the Lines tab shown. */
async function vaseInLines(s: Scene, style: string): Promise<void> {
  await s.p.locator('[data-testid="asset-card"][title="vase_for_light_study.stl"]').dblclick();
  const stage = s.p.locator('[data-testid="model-stage"][data-drawn]');
  await stage.waitFor({ timeout: 60_000 });
  const box = (await stage.boundingBox())!;
  await s.p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await s.p.mouse.down();
  await s.p.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 70, { steps: 8 });
  await s.p.mouse.up();
  await s.p.getByTestId("view-styles").click();
  await s.p.getByRole("menuitem", { name: new RegExp(`^${style}`) }).click();
  await s.p.locator('[data-testid="model-stage"][data-inked="1"]').waitFor({ timeout: 60_000 });
}

test("model-lines", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 40 });
  await files(s);
  await vaseInLines(s, "Etching");
  await s.settle(800);
  await s.shot("model-lines");
});

test("model-line-styles", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 210 });
  await files(s);
  await vaseInLines(s, "Blueprint");
  await s.p.getByTestId("view-styles").click();
  const menu = s.p.getByRole("menu", { name: "Line styles" });
  await expect(menu).toBeVisible();
  await s.settle(400);
  await s.shot("model-line-styles", await s.around({ els: ['[data-testid="model-view"] .view-bar', '[role="menu"][aria-label="Line styles"]', '[data-testid="model-stage"]'], pad: 0 }));
});

test("model-narrow", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 178 });
  await files(s);
  await s.p.setViewportSize({ width: 390, height: 844 });
  await vaseInLines(s, "Ink");
  await s.p.getByTestId("view-more").click();
  await expect(s.p.getByRole("menu", { name: "More of this view" })).toBeVisible();
  await s.settle(400);
  await s.shot("model-narrow");
});

test("import-choice", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 178 });
  await s.p.getByTestId("save-status").click();
  await s.p.getByTestId("set-import-input").setInputFiles(resolve("showcase.canvast"));
  await expect(s.p.getByTestId("choose-dialog").filter({ hasText: "How to import" })).toBeVisible({ timeout: 60_000 });
  await s.shot("import-choice");
});
