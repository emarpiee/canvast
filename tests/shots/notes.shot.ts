// README pictures of "Notes": an artist's study notes on a print, with its facts as properties, the print embedded, a checklist of what
// to look at and a copy plan; a second note it links to; and the note as a card beside the print on a canvas (manifest.ts).
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, artFiles, type Scene } from "./scene";

const WAVE = artFiles("hokusai-under")[0]!;
const VILLAGE = artFiles("hokusai-seaside")[0]!;
const md = (name: string, text: string) => ({ name, mimeType: "text/markdown", buffer: Buffer.from(text) });
const STUDY = md("The Great Wave - study notes.md", `---
artist: Katsushika Hokusai
date: ca. 1830–32
medium: Woodblock print
series: Thirty-six Views of Mount Fuji
status: studying
tags: [study, composition]
---
# The Great Wave: study notes

From the series *Thirty-six Views of Mount Fuji*, a woodblock print of about 1830–32.

![[${WAVE}]]

## What to look at

- [x] The crest breaking into claws over the boats
- [ ] Mount Fuji, small and low, framed by the trough of the wave
- [ ] The three boats, their rowers bent low

## Copy plan

| Pass | Tool | Aim |
| --- | --- | --- |
| 1 | Pen | the one big curve of the wave |
| 2 | Shapes | the boats as simple masses |
| 3 | Adjust | a greyscale copy to read the values |

> Compare the snow and sea of [[Seaside Village in Winter - notes]].
`);
const VILLAGE_NOTE = md("Seaside Village in Winter - notes.md", `---
artist: Katsushika Hokusai
date: 1814
source: Hokusai's Album of Realistic Pictures
---
# Seaside Village in Winter

An earlier Hokusai, from his *Album of Realistic Pictures* (1814): a quiet shore under snow.
`);

async function notes(s: Scene): Promise<{ card: (n: string) => ReturnType<Scene["p"]["locator"]>; h: Record<string, string> }> {
  // (files and buffers cannot go in one input: the prints as buffers too)
  const jpg = (f: string) => ({ name: f, mimeType: "image/jpeg", buffer: readFileSync(resolve("scripts/showcase/art", f)) });
  const h = await s.library([jpg(WAVE), jpg(VILLAGE), STUDY, VILLAGE_NOTE]);
  await s.p.getByTestId("view-assets").click();
  return { card: (n: string) => s.p.locator(`[data-testid="asset-card"][data-hash="${h[n]}"]`), h };
}

test("notes-editor", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 210 });
  const { card } = await notes(s);
  await card(STUDY.name).dblclick();
  await s.p.locator(".viewer-note .sun-editor-editable h1").first().waitFor();
  await s.settle(800);
  await s.shot("notes-editor");
});

test("notes-links", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 210 });
  const { card } = await notes(s);
  await card(VILLAGE_NOTE.name).click();
  await expect(s.p.getByTestId("asset-backlinks")).toBeVisible();
  await s.p.getByTestId("asset-backlinks").scrollIntoViewIfNeeded();
  await s.settle();
  await s.shot("notes-links");
});

test("note-properties", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 40 });
  const { card } = await notes(s);
  await card(STUDY.name).click();
  await s.settle();
  await s.shot("note-properties", await s.around({ els: ['[data-testid="asset-inspector"]'], pad: 0 }));
});

test("notes-panel", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 200 });
  const { h } = await notes(s);
  await s.p.getByTestId("view-canvas").click();
  await s.canvas("Wave study");
  const ids = await s.placeRow([h[WAVE]!, h[STUDY.name]!]);
  await s.fit(ids, 0.6, [0.36, 0.5]);
  const b = (await s.box([ids[1]!]))!;
  await s.tool("select");
  await s.p.mouse.dblclick(Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2));
  await s.p.getByTestId("note-panel").locator(".sun-editor-editable h1").first().waitFor();
  await s.settle(600);
  await s.shot("notes-panel");
});

