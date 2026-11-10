// The README's pictures of notes: a study plan written in the notes editor with its properties, links to other notes and pictures of
// the library (public-domain artworks, scripts/showcase/art), what links to it, and its card on a canvas beside its references.
// Run from the repo root after `npm run build`: node scripts/showcase/shots-notes.mjs <unused> <outDir>
import { readFileSync } from "node:fs";
import { artOf, artPath, open } from "./lib.mjs";

const [, out] = process.argv.slice(2);
const s = await open(out);
const { p, H, settle, shot, step, off, blur, menu, importFiles, place, fit } = s;

const horse = artOf("delacroix")[0], fair = artOf("bonheur")[0], wave = artOf("hokusai-under")[0];
const PLAN = `---
tags: [study-plan, anatomy]
status: in progress
week: 3
---
# Horse anatomy: study plan

Three weeks of studies from the masters, one form at a time.

![${horse.replace(/\.jpg$/, "")}](${horse})

## This week
- [x] Copy the head and neck, after Delacroix
- [x] Ten-minute gestures, after [[Gesture practice]]
- [ ] The weight on the back legs
- [ ] One finished study in ink

> Draw the big masses first; the details follow from them.

| Day | Study | Minutes |
| --- | --- | --- |
| Monday | Head and neck | 45 |
| Wednesday | Legs in motion | 60 |
| Friday | The whole horse | 90 |

#reference
`;
const GESTURE = `---
tags: [practice]
---
# Gesture practice

Short poses, one line for the action, then the masses. See [[Horse anatomy: study plan]].

- 30 seconds × 10
- 2 minutes × 5
- 5 minutes × 2
`;
const COMPOSITION = `---
tags: [template]
---
# Study notes

**Subject:**
**After:**

## What I learned
-
`;
const hashes = await importFiles([
  ...[horse, fair, wave].map((f) => ({ name: f, mimeType: "image/jpeg", buffer: readFileSync(artPath(f)) })),
  { name: "Horse anatomy - study plan.md", mimeType: "text/markdown", buffer: Buffer.from(PLAN) },
  { name: "Gesture practice.md", mimeType: "text/markdown", buffer: Buffer.from(GESTURE) },
  { name: "Study notes.md", mimeType: "text/markdown", buffer: Buffer.from(COMPOSITION) },
]);
const note = (name) => p.locator(`[data-testid="asset-card"][data-hash="${hashes[name]}"]`);

// 1. The notes editor: the plan, its picture from the library, task list, quote and table; its properties and tags in the details
await step("notes-editor", async () => {
  await note("Horse anatomy - study plan.md").dblclick();
  await p.locator(".viewer-note .sun-editor-editable h1").first().waitFor({ timeout: 20_000 });
  await settle(1200);
  await off();
  await shot("notes-editor");
});

// 2. Links: the details of the gesture note, what it links to and what links to it
await step("notes-links", async () => {
  await p.keyboard.press("Escape");
  await settle(400);
  await note("Gesture practice.md").click();
  await p.getByTestId("asset-backlinks").waitFor({ timeout: 10_000 }).catch(() => undefined);
  await settle(800);
  await off();
  await shot("notes-links");
  await p.keyboard.press("Escape");
});

// 3. On a canvas: the plan's card beside its references, the Note panel open
await step("notes-panel", async () => {
  await p.getByTestId("view-canvas").click();
  await settle(500);
  await place([hashes[fair], hashes[horse]]);
  await p.getByTestId("view-assets").click();
  await note("Horse anatomy - study plan.md").click();
  await p.getByTestId("asset-place").click();
  await p.getByText("Place without tags").click().catch(() => undefined);
  await p.locator("dialog[open]").getByRole("button", { name: "Place", exact: true }).click().catch(() => undefined);
  await settle(800);
  await p.keyboard.press("Control+a");
  await menu("arrangemenu", "grid:name-asc");
  await fit();
  const id = (await H(() => window.__canvastDebug.objects())).find((o) => o.kind === "image" && /plan/i.test(o.name ?? ""))?.id ?? (await H(() => window.__canvastDebug.objects())).at(-1).id;
  const b = (await H((i) => window.__canvastDebug.objectScreen(i), id)).box;
  await p.mouse.dblclick(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  await p.getByTestId("note-panel").locator(".sun-editor-editable h1").first().waitFor({ timeout: 20_000 });
  await blur();
  await p.keyboard.press("Escape");
  await off();
  await shot("notes-panel");
});

await s.done();
