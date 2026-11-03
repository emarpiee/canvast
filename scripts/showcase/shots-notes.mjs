// README screenshots of notes: a note in the library's notes editor, and its card on a canvas with the Note panel open beside it.
// Imports showcase.canvast into a fresh profile (dark, the default theme colour) and photographs the app.
// Run from the repo root after `npm run build`:
//   node scripts/showcase/shots-notes.mjs <showcase.canvast> <outDir>
import { chromium } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [archive, out] = process.argv.slice(2);
const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cv-shots-"));
const ctx = await chromium.launchPersistentContext(join(work, "profile"), { viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const p = ctx.pages()[0] ?? (await ctx.newPage());
p.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
await p.goto("file://" + process.cwd() + "/dist/canvast.html#debug");
await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
await p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
const H = (fn, arg) => p.evaluate(fn, arg);
const frame = () => H(() => window.__canvastDebug.nextFrame());
const settle = async (ms = 800) => { await frame(); await p.waitForTimeout(ms); await frame(); };
const shot = async (name) => {
  await H(() => { for (const b of document.querySelectorAll(".notice-close")) b.click(); });
  await settle();
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
};

await p.getByTestId("save-status").click();
await p.getByTestId("set-import-input").setInputFiles(resolve(archive));
await p.getByTestId("confirm-ok").click();
await p.getByTestId("toast").filter({ hasText: /Imported/ }).waitFor();
await p.keyboard.press("Escape");

const NOTE = `---
tags: [planning, space]
status: draft
---
# Solar System tour

The showcase opens on the **Sun** and dives down to a leaf, then a million zoom levels further.

## Stops
- [x] The Sun and its planets
- [x] [[Earth]], then the island and its tree
- [ ] The cells, DNA and the proton
- [ ] Other universes, 1,000 levels up

> Every stop is a bookmark: press **1** to **9** to fly there.

| Stop | Zoom levels |
| --- | --- |
| Earth | 30 |
| A leaf | 60 |
| A heart | 1,000,000 |

#showcase
`;
await p.getByTestId("view-assets").click();
await p.getByTestId("assets-import-input").setInputFiles({ name: "Solar System tour.md", mimeType: "text/markdown", buffer: Buffer.from(NOTE) });
const noteCard = p.locator('[data-testid="asset-card"]', { hasText: "Solar System tour" }).first();
await noteCard.waitFor();
await noteCard.dblclick();
await p.locator(".viewer-note .sun-editor-editable h1").first().waitFor();
await shot("notes-editor");

// On the canvas: its card placed, and the Note panel beside it
await p.getByTestId("asset-place").click();
await p.getByText("Place without tags").click(); // (the note's tags stay the library's)
await p.locator("dialog[open]").getByRole("button", { name: "Place", exact: true }).click();
await settle();
const id = await H(() => window.__canvastDebug.objects().at(-1).id);
const box = await p.locator("canvas").first().boundingBox();
// The card to the right half (a drag with the Hand), so the panel on the left leaves it in view
await p.keyboard.press("-"); // (a smaller card: it fits beside the panel)
await settle();
await p.keyboard.press("h");
await p.mouse.move(box.x + 700, box.y + 820);
await p.mouse.down();
await p.mouse.move(box.x + 1110, box.y + 820, { steps: 8 });
await p.mouse.up();
await p.keyboard.press("v");
await settle();
const b = (await H((i) => window.__canvastDebug.objectScreen(i), id)).box;
await p.mouse.dblclick(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
await p.getByTestId("note-panel").locator(".sun-editor-editable h1").first().waitFor();
await H(() => document.activeElement?.blur());
await p.keyboard.press("Escape"); // (the card unselected: no Actions bar over the panel)
await p.mouse.move(box.x + 1100, box.y + 780);
await shot("notes-panel");
await ctx.close();
