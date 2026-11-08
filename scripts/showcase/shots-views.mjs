// The README's pictures of the PDF viewer, the 3D viewer and the "How to import" question, in a fresh profile (dark). A PDF and a model made here.
// Run from the repo root after `npm run build`: node scripts/showcase/shots-views.mjs <showcase.canvast> <outDir>
import { chromium } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [archive, out] = process.argv.slice(2);
const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cv-views-"));
const ctx = await chromium.launchPersistentContext(join(work, "profile"), { viewport: { width: 1440, height: 900 }, colorScheme: "dark", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = ctx.pages()[0] ?? (await ctx.newPage());
p.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
await p.goto("file://" + process.cwd() + "/dist/canvast.html#debug");
await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
await p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
const shot = async (name) => { await p.evaluate(() => { for (const b of document.querySelectorAll(".notice-close")) b.click(); }); await p.mouse.move(1430, 890); await p.waitForTimeout(800); await p.screenshot({ path: `${out}/${name}.png` }); console.log("shot", name); };

/** A short paper: a title, a heading and lines of text on each page, as Helvetica. */
function makePdf(pages) {
  const objs = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  pages.forEach((pg, i) => {
    let y = 760;
    const lines = [`BT /F2 26 Tf 60 ${y} Td (${pg.title}) Tj ET`];
    y -= 40;
    for (const para of pg.text) {
      for (const line of para) lines.push(`BT /F1 12 Tf 60 ${(y -= 17)} Td (${line}) Tj ET`);
      y -= 14;
    }
    lines.push(`0.85 0.45 0.2 rg 60 ${y - 170} 475 150 re f 0 0 0 rg BT /F1 10 Tf 60 ${y - 190} Td (Figure ${i + 1}. ${pg.title}) Tj ET`);
    lines.push(`BT /F1 10 Tf 290 40 Td (${i + 1}) Tj ET`);
    const text = lines.join("\n");
    objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objs[6 + i * 2] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  });
  let s = "%PDF-1.4\n";
  const at = [];
  for (let i = 1; i < objs.length; i++) { at[i] = s.length; s += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = s.length;
  s += `xref\n0 ${objs.length}\n0000000000 65535 f \n${at.slice(1).map((a) => `${String(a).padStart(10, "0")} 00000 n \n`).join("")}`;
  s += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, "latin1");
}
const para = ["Light falls off with the square of the distance, so a lamp moved", "twice as far gives a quarter of the light. Painters read it as", "the step between the lit side and the shadow side of a form."];
const PDF = makePdf(["Light and form", "Edges", "Colour temperature"].map((title) => ({ title, text: [para, para.slice(0, 2), para] })));

/** A torus as an ASCII STL. */
function makeTorus(R = 1, r = 0.38, n = 64, m = 32) {
  const at = (i, j) => { const u = (i / n) * 2 * Math.PI, v = (j / m) * 2 * Math.PI; return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)]; };
  const f = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const [a, b, c, d] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
    for (const t of [[a, b, c], [a, c, d]]) {
      const [u, v] = [t[1].map((x, k) => x - t[0][k]), t[2].map((x, k) => x - t[0][k])];
      const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...nn) || 1;
      f.push(`facet normal ${nn.map((x) => (x / l).toFixed(5)).join(" ")}\nouter loop\n${t.map((q) => `vertex ${q.map((x) => x.toFixed(5)).join(" ")}`).join("\n")}\nendloop\nendfacet`);
    }
  }
  return Buffer.from(`solid torus\n${f.join("\n")}\nendsolid torus\n`);
}

await p.getByTestId("view-assets").click();
await p.getByTestId("assets-import-input").setInputFiles([{ name: "light_and_form.pdf", mimeType: "application/pdf", buffer: PDF }, { name: "ring.stl", mimeType: "application/octet-stream", buffer: makeTorus() }]);
const card = (name) => p.locator(`[data-testid="asset-card"][title="${name}"]`);
await card("ring.stl").waitFor({ timeout: 30_000 });
await card("light_and_form.pdf").waitFor({ timeout: 30_000 });

// The PDF viewer: its pages, the page box and the details beside it
await card("light_and_form.pdf").dblclick();
await p.locator('[data-testid="pdf-view"] .pdf-page[data-page="1"][data-drawn]').waitFor({ timeout: 30_000 });
await shot("pdf-view");
await p.keyboard.press("Escape");

// The 3D viewer: the model lit, its settings beside it
await card("ring.stl").dblclick();
await p.locator('[data-testid="model-stage"][data-drawn]').waitFor({ timeout: 30_000 });
const box = await p.getByTestId("model-stage").boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await p.mouse.down();
await p.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 90, { steps: 8 }); // (turned a little: the ring at an angle)
await p.mouse.up();
await shot("model-view");
await p.keyboard.press("Escape");

// The question an import of a backup asks: add it, or update this workspace
await p.getByTestId("view-canvas").click();
await p.getByTestId("save-status").click();
await p.getByTestId("set-import-input").setInputFiles(resolve(archive));
await p.getByTestId("choose-dialog").filter({ hasText: "How to import" }).waitFor({ timeout: 60_000 });
await shot("import-choice");
await ctx.close();
