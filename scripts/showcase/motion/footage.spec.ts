// Footage for the one-minute motion piece (comp.html): each test is one clip of the app in use, recorded frame by frame as JPEGs (2160 × 1350,
// the 1440 × 900 window at 1.5×) with meta.json beside them: per frame the pointer (CSS px; the comp draws the cursor) and whatever the
// comp needs to line its graphics up with the app (object boxes). Scenes are built the way the README shots build theirs.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { boolWith, chooseInMenu, maskWith, setPenColour } from "../../../tests/e2e/harness";
import { test, expect, ART, artFiles, type Scene, type Box } from "../../../tests/shots/scene";

const OUT = resolve(process.env["MOTION_OUT"] ?? "docs/media/footage");
type Pt = [number, number];

/** The clip's look in full colour: the app's default theme is the grey Stone (colourfulness 20%), these clips show their theme colours. */
async function look(s: Scene, o: Parameters<Scene["look"]>[0]): Promise<void> {
  await s.look(o);
  await s.p.evaluate(() => window.__canvastDebug.setSetting("ui.vivid", 100));
  await s.settle();
}

class Rec {
  n = 0;
  frames: Array<Record<string, unknown>> = [];
  ptr: Pt | null = null;
  down = false;
  readonly dir: string;
  constructor(readonly s: Scene, readonly name: string) {
    this.dir = resolve(OUT, name);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
  }
  async quiet(): Promise<void> {
    await this.s.p.evaluate(() => { for (const b of document.querySelectorAll<HTMLElement>(".notice-close")) b.click(); });
    await this.s.settle(300);
  }
  async snap(extra: Record<string, unknown> = {}, wait = 0): Promise<void> {
    await this.s.frame();
    if (wait) await this.s.p.waitForTimeout(wait);
    await this.s.frame();
    await this.s.p.screenshot({ path: `${this.dir}/f${String(this.n++).padStart(4, "0")}.jpg`, type: "jpeg", quality: 90 });
    this.frames.push({ ptr: this.ptr, down: this.down, ...extra });
  }
  async hold(k: number): Promise<void> {
    for (let i = 0; i < k; i++) await this.snap();
  }
  async move(x: number, y: number): Promise<void> {
    await this.s.p.mouse.move(x, y);
    this.ptr = [x, y];
  }
  /** A drag in `steps`, one frame every `every` steps. */
  async drag(a: Pt, b: Pt, steps = 12, every = 1): Promise<void> {
    await this.move(a[0], a[1]);
    await this.s.p.mouse.down();
    this.down = true;
    await this.snap();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t * t * (3 - 2 * t);
      await this.move(a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e);
      if (i % every === 0 || i === steps) await this.snap();
    }
    await this.s.p.mouse.up();
    this.down = false;
    await this.snap();
  }
  /** A freehand line through these points, one frame every `every` points. */
  async line(pts: Pt[], every = 2): Promise<void> {
    await this.move(...pts[0]!);
    await this.s.p.mouse.down();
    this.down = true;
    for (const [i, [x, y]] of pts.slice(1).entries()) {
      await this.s.p.mouse.move(x, y, { steps: 2 });
      this.ptr = [x, y];
      if (i % every === 0) await this.snap();
    }
    await this.s.p.mouse.up();
    this.down = false;
    await this.snap();
  }
  /** Words typed into what has the focus, one frame every `every` characters. */
  async type(words: string, every = 1): Promise<void> {
    for (let i = 0; i < words.length; i++) {
      await this.s.p.keyboard.type(words[i]!);
      if ((i + 1) % every === 0 || i === words.length - 1) await this.snap({ key: (i % every) + 1 });
    }
  }
  async at(sel: string): Promise<Pt> {
    const b = (await this.s.p.locator(sel).filter({ visible: true }).first().boundingBox())!;
    this.ptr = [b.x + b.width / 2, b.y + b.height / 2];
    return this.ptr;
  }
  /** A control of the Properties bar: where it shows, else its chip pressed on camera first (the chips stand by the selection, ADR 0198). Its middle. */
  async ctl(sel: string): Promise<Pt> {
    const p = this.s.p;
    if (!(await p.locator(sel).filter({ visible: true }).count())) {
      const section = await p.locator(sel).first().evaluate((el) => (el.closest("[data-section]") as HTMLElement | null)?.dataset["section"] ?? null);
      const chip = `.props-near:not([hidden]) [data-vchip="${section}"], .props-chips:not([hidden]) [data-vchip="${section}"]`;
      await this.at(chip);
      await this.hold(2);
      await p.locator(chip).first().click();
      this.down = true; await this.snap(); this.down = false;
      await this.hold(2);
    }
    return this.at(sel);
  }
  save(extra: Record<string, unknown> = {}): void {
    writeFileSync(`${this.dir}/meta.json`, JSON.stringify({ count: this.n, frames: this.frames, ...extra }));
  }
}

const curve = (pts: Pt[], n = 10): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[Math.max(0, i - 1)]!, pts[i]!, pts[i + 1]!, pts[Math.min(pts.length - 1, i + 2)]!];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts.at(-1)!);
  return out;
};
const inside = (b: Box, x: number, y: number): Pt => [b.minX + (b.maxX - b.minX) * x, b.minY + (b.maxY - b.minY) * y];

/** The Text tool set up (font, size, colour) and a click where the text goes: the next keys write it. */
async function startText(s: Scene, x: number, y: number, { size = 24, colour = "#f2efe8", font = "" } = {}): Promise<void> {
  const p = s.p;
  await s.tool("text");
  if (font) await s.font(font);
  const sz = p.getByRole("spinbutton", { name: "Text size (px at this zoom)" });
  await sz.fill(String(size));
  await sz.press("Enter");
  await p.getByRole("button", { name: "Text colour" }).click();
  await s.hex(colour);
  await p.mouse.click(x, y);
  await p.waitForFunction(() => document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable);
}
async function endText(s: Scene): Promise<void> {
  await s.p.keyboard.press("Escape");
  await s.tool("select");
  await s.p.keyboard.press("Escape");
  await s.blur();
  await s.settle();
}

// ---------- 1. a reference board: three masters land, then a title and a note under each are written ----------
test("refs", async ({ scene: s }) => {
  await s.fonts();
  const art = await s.art("delacroix", "bonheur", "degheyn");
  await s.canvas("Horses");
  const ids = await s.placeRow(art);
  await s.fit(ids, 0.6, [0.5, 0.53]);
  const boxes = await Promise.all(ids.map(async (id) => (await s.box([id]))!));
  for (const id of ids) await s.p.evaluate((i) => window.__canvastDebug.setOpacity(i, 0.002), id);
  await s.select([]);
  const r = new Rec(s, "refs");
  await r.quiet();
  await r.move(1300, 860);
  await r.hold(2);
  for (const id of ids) for (let k = 1; k <= 4; k++) { await s.p.evaluate(([i, o]) => window.__canvastDebug.setOpacity(i as string, o as number), [id, k / 4]); await r.snap(k === 4 ? { land: 1 } : {}); }
  await r.hold(2);
  const all = (await s.box(ids))!;
  await startText(s, all.minX, all.minY - 64, { size: 40, font: "cormorant garamond semibold", colour: "#efe6d2" });
  r.ptr = [all.minX, all.minY - 50];
  await r.type("Horses: three masters", 1);
  await endText(s);
  await r.snap();
  const notes = ["Delacroix: one horse, mass in wash", "Bonheur: a herd in motion", "de Gheyn: saddle and rider, two views"];
  for (const [i, b] of boxes.entries()) {
    await startText(s, b.minX, b.maxY + 18, { size: 22, font: "caveat", colour: "#e8c27a" });
    r.ptr = [b.minX, b.maxY + 30];
    await r.type(notes[i]!, 3);
    await endText(s);
  }
  r.ptr = null;
  await r.hold(3);
  r.save({ boxes, files: artFiles("delacroix", "bonheur", "degheyn") });
});

// ---------- 2. a value study: a copy turned grey, contrast raised, flipped ----------
test("values", async ({ scene: s }) => {
  await s.fonts();
  const [h] = await s.art("vangogh");
  await s.canvas("Value study");
  const ids = await s.placeRow([h!, h!]);
  await s.fit(ids, 0.56, [0.42, 0.5]);
  const [a, b] = [(await s.box([ids[0]!]))!, (await s.box([ids[1]!]))!];
  await s.text(a.minX, a.maxY + 16, "colour", { size: 26, font: "caveat", colour: "#e8c27a" });
  await s.text(b.minX, b.maxY + 16, "values: light and dark masses", { size: 26, font: "caveat", colour: "#e8c27a" });
  await s.select([ids[1]!]);
  await s.p.getByRole("button", { name: "Adjust panel", exact: true }).click();
  const r = new Rec(s, "values");
  await r.quiet();
  r.ptr = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  await r.hold(2);
  const set = async (k: string, v: number): Promise<void> => {
    const n = s.p.locator(`[data-adj-num="${k}"]`).first();
    await r.at(`[data-adj-num="${k}"]`);
    await n.fill(String(Math.round(v)));
    await n.press("Enter");
    await r.snap();
  };
  for (let i = 1; i <= 10; i++) await set("saturation", -100 * (i / 10) ** 0.8);
  for (let i = 1; i <= 6; i++) await set("contrast", 45 * i / 6);
  await s.blur();
  await r.ctl('[data-flip="x"]');
  await r.hold(2);
  await s.p.locator('[data-flip="x"]').filter({ visible: true }).first().click();
  r.down = true; await r.snap(); r.down = false;
  await r.hold(4);
  r.save({ boxes: [a, b] });
});

// ---------- 3. gesture lines over three dancers ----------
test("draw", async ({ scene: s }) => {
  await look(s, { theme: "dark", hue: 20 });
  const art = await s.art("degas-dancer_with", "degas-dancer_onstage", "degas-dancer_adjusting");
  await s.canvas("Gesture");
  const ids = await s.place(art);
  await s.select(ids);
  await s.p.locator('[data-ctx="arrangemenu"]').click();
  await s.p.locator('.pop-menu [data-id="grid:name-asc"]').click();
  await s.p.keyboard.press("Escape");
  await s.fit(ids, 0.72, [0.5, 0.55]);
  await s.tool("pen");
  await setPenColour(s.p, "#ff5a3c");
  const r = new Rec(s, "draw");
  await r.quiet();
  await r.move(300, 820);
  await r.hold(2);
  const boxes: Box[] = [];
  for (const id of ids) {
    const b = (await s.box([id]))!;
    boxes.push(b);
    const at = (x: number, y: number): Pt => inside(b, x, y);
    await r.line(curve([at(0.5, 0.1), at(0.42, 0.35), at(0.53, 0.6), at(0.47, 0.93)], 8), 2);
  }
  await r.hold(3);
  r.save({ boxes });
});

// ---------- 4. vector tools, before and after (comp flashes between them) ----------
const CREST_PARTS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
<circle cx="170" cy="170" r="120" fill="#1d4e89"/><rect x="40" y="200" width="330" height="90" fill="#1d4e89"/>
<circle cx="205" cy="150" r="80" fill="#f4efe6"/><circle cx="262" cy="70" r="24" fill="#f4efe6"/><circle cx="283" cy="104" r="17" fill="#f4efe6"/><circle cx="292" cy="133" r="12" fill="#f4efe6"/></svg>`;

test("boolean", async ({ scene: s }) => {
  await look(s, { theme: "dark", hue: 220 });
  await s.canvas("Logo");
  const parts = await s.svg(CREST_PARTS, [720, 450], true);
  await s.fit(parts, 0.62);
  await s.select(parts);
  const r = new Rec(s, "boolean");
  await r.quiet();
  await r.snap();
  await boolWith(s.p, "op:subtract");
  await s.select(await s.ids());
  await r.snap();
  r.save();
});

test("pattern", async ({ scene: s }) => {
  await s.canvas("Endpapers");
  await s.tool("sheet");
  const r = new Rec(s, "pattern");
  await r.quiet();
  await r.drag([420, 190], [1020, 700], 10, 2);
  const sheet = (await s.objects()).find((o) => o.container)!.id;
  await s.select([sheet]);
  await s.p.getByRole("button", { name: "Pattern panel", exact: true }).click();
  await s.p.locator("[data-pg-pick]").click();
  await s.p.locator('.pg-tile[data-gen="scales"]').click();
  await r.at('[data-testid="pattern-make"]');
  await r.snap();
  await s.p.getByTestId("pattern-make").click();
  await expect.poll(async () => (await s.objects()).length).toBeGreaterThan(1);
  await s.settle(600);
  await r.hold(2);
  r.save();
});

test("guides", async ({ scene: s }) => {
  const [h] = await s.art("hokusai-under");
  await s.canvas("Composition");
  const [pic] = await s.place([h!]);
  await s.fit([pic!], 0.66, [0.42, 0.5]);
  const b = (await s.box([pic!]))!;
  await s.tool("sheet");
  await s.app.drag({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }, 6);
  const sheet = (await s.objects()).find((o) => o.container)!.id;
  await s.select([sheet]);
  await s.p.getByRole("button", { name: "Pattern panel", exact: true }).click();
  await s.p.locator('[data-pg-tabs] [role="tab"]', { hasText: "Guides" }).click();
  await s.p.locator("[data-pg-pick]").click();
  await s.p.locator('.pg-tile[data-gen="golden-spiral"]').click();
  const r = new Rec(s, "guides");
  await r.quiet();
  await r.at('[data-testid="pattern-make"]');
  await r.snap();
  await s.p.getByTestId("pattern-make").click();
  await s.settle(800);
  await r.hold(2);
  r.save({ box: b });
});

// ---------- 5. a comic page: three balloons already lettered, the fourth drawn, written and pointed live ----------
type Kind = "" | "speech" | "thought" | "shout" | "caption";
interface Balloon { box: [number, number, number, number]; words: string; kind?: Kind; tip?: Pt; fill?: string; size?: number; font?: string }
async function balloon(s: Scene, b: Balloon, r?: Rec): Promise<string> {
  const p = s.p;
  const cam = await p.evaluate(() => window.__canvastDebug.camera());
  const before = new Set(await s.ids());
  await s.tool("balloon");
  const [x0, y0, x1, y1] = b.box;
  if (r) await r.drag([x0, y0], [x1, y1], 10, 2);
  else await s.app.drag({ x: x0, y: y0 }, { x: x1, y: y1 }, 4);
  const id = (await s.objects()).find((o) => !before.has(o.id) && o.shape === "balloon")!.id;
  await s.tool("select");
  await s.select([id]);
  if (b.kind) {
    // (the balloon's Body chip: its options open, on camera when recording)
    if (r) await r.ctl("[data-bln='preset']");
    await (await s.control("[data-bln='preset']")).selectOption(b.kind);
    if (r) await r.snap();
    await p.keyboard.press("Escape"); // (its options closed: the words are typed next)
  }
  await p.mouse.dblclick((x0 + x1) / 2, (y0 + y1) / 2);
  await p.waitForFunction(() => document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable);
  if (r) { r.ptr = [(x0 + x1) / 2, (y0 + y1) / 2]; await r.type(b.words, 1); } else await p.keyboard.type(b.words);
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  await s.blur();
  await p.evaluate((c) => window.__canvastDebug.setCamera(c), cam);
  await s.settle();
  if (b.tip) {
    await s.select([id]);
    const tip = (await p.evaluate(() => window.__canvastDebug.balloonDots())).find((d) => d.part === "tip");
    if (tip) { if (r) await r.drag([tip.x, tip.y], b.tip, 8, 2); else await s.app.drag({ x: tip.x, y: tip.y }, { x: b.tip[0], y: b.tip[1] }, 5); }
  }
  await s.paint(id, "fill", b.fill ?? "#ffffff");
  await s.paint(id, "stroke", "#111111");
  const words = (await p.evaluate(() => window.__canvastDebug.objects() as unknown as Array<{ id: string; kind: string; inShape?: { shape: string } }>)).find((o) => o.kind === "text" && o.inShape?.shape === id);
  if (words) {
    await s.select([words.id]);
    await s.font(b.font ?? "comic neue");
    const sz = p.getByRole("spinbutton", { name: "Text size (px at this zoom)" });
    await sz.fill(String(b.size ?? 20));
    await sz.press("Enter");
    await p.getByRole("button", { name: "Text colour" }).click();
    await s.hex("#111111");
  }
  await s.select([]);
  await s.settle();
  if (r) await r.snap();
  return id;
}

async function comicPage(s: Scene): Promise<{ page: string; panels: string[] }> {
  const art = await s.art("hokusai-seaside", "leprince", "verhaecht", "hokusai-under");
  const panels = await s.placeRow(art, 30);
  await s.select(panels);
  await chooseInMenu(s.p, "arrangemenu", "grid:stack");
  await chooseInMenu(s.p, "sheetmenu", "puton");
  await expect.poll(async () => (await s.objects()).some((o) => o.container)).toBe(true);
  const pg = (await s.objects()).find((o) => o.container)!.id;
  await s.paint(pg, "fill", "#fbf8f1");
  await s.select([]);
  return { page: pg, panels };
}

test("comic", async ({ scene: s }) => {
  await look(s, { theme: "dark", hue: 210 });
  await s.fonts();
  await s.canvas("Page 1");
  const { page: pg, panels } = await comicPage(s);
  const on = async (i: number): Promise<Box> => { await s.fit([pg], 0.88); return (await s.box([panels[i]!]))!; };
  let b = await on(0);
  await balloon(s, { box: [...inside(b, 0.03, 0.04), ...inside(b, 0.5, 0.2)] as Balloon["box"], words: "WINTER. THE VILLAGE WAITS FOR THE BOATS.", kind: "caption", fill: "#f3e3a6", size: 15 });
  b = await on(1);
  await balloon(s, { box: [...inside(b, 0.5, 0.05), ...inside(b, 0.96, 0.33)] as Balloon["box"], words: "THE FORD IS HIGH THIS YEAR.", kind: "speech", tip: inside(b, 0.55, 0.62), size: 15 });
  b = await on(2);
  await balloon(s, { box: [...inside(b, 0.03, 0.04), ...inside(b, 0.45, 0.18)] as Balloon["box"], words: "THREE DAYS OVER THE PASS.", kind: "caption", fill: "#f3e3a6", size: 15 });
  b = await on(3);
  const r = new Rec(s, "comic");
  await r.quiet();
  await r.move(1200, 800);
  await r.hold(2);
  await balloon(s, { box: [...inside(b, 0.55, 0.04), ...inside(b, 0.95, 0.36)] as Balloon["box"], words: "HOLD ON!", kind: "shout", tip: inside(b, 0.42, 0.7), font: "bangers", size: 30 }, r);
  r.ptr = null;
  await s.fit([pg], 0.88);
  await r.hold(3);
  r.save({ page: await s.box([pg]), panel: await s.box([panels[3]!]) });
});

// ---------- 6. the Library: the collection in folders, searched as it is typed, then a card's info ----------
const FOLDERS: Array<[string, string, string[]]> = [
  ["f-prints", "Japanese prints", ["hokusai"]],
  ["f-horses", "Horses", ["delacroix", "bonheur", "degheyn"]],
  ["f-dance", "Dancers", ["degas"]],
  ["f-land", "Landscapes", ["waterloo", "verhaecht", "leprince", "vangogh"]],
  ["f-plants", "Botanical", ["delany", "anonymous-botanical"]],
];
test("library", async ({ scene: s }) => {
  const p = s.p;
  const hashes = await s.library(ART.map((a) => resolve("scripts/showcase/art", a.file)));
  const op = (...a: string[]): Promise<void> => p.evaluate((x) => window.__canvastDebug.libraryOp(...(x as [never])), a);
  for (const [id, name, starts] of FOLDERS) {
    await op("createFolder", id, name, "");
    for (const f of artFiles(...starts)) await op("file", hashes[f]!, id);
  }
  await p.getByTestId("view-assets").click();
  await s.settle(800);
  const r = new Rec(s, "library");
  await r.quiet();
  await r.move(900, 600);
  await r.hold(3);
  const q = p.getByTestId("assets-search");
  await r.at('[data-testid="assets-search"]');
  await q.click();
  r.down = true; await r.snap(); r.down = false;
  await r.type("horse", 1);
  await q.press("Enter");
  await s.settle(400);
  await r.hold(2);
  const card = p.locator(`[data-testid="asset-card"][data-hash="${hashes[artFiles("bonheur")[0]!]}"]`);
  await r.at(`[data-testid="asset-card"][data-hash="${hashes[artFiles("bonheur")[0]!]}"]`);
  await card.click();
  r.down = true; await r.snap({}, 200); r.down = false;
  await r.hold(3);
  r.save();
});

// ---------- 7. notes: a study note with properties, an embedded print and a [[link]] ----------
const WAVE = artFiles("hokusai-under")[0]!;
const VILLAGE = artFiles("hokusai-seaside")[0]!;
const md = (name: string, text: string) => ({ name, mimeType: "text/markdown", buffer: Buffer.from(text) });
const STUDY = md("The Great Wave - study notes.md", `---
artist: Katsushika Hokusai
date: ca. 1830–32
medium: Woodblock print
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

> Compare the snow and sea of [[Seaside Village in Winter - notes]].
`);
const VILLAGE_NOTE = md("Seaside Village in Winter - notes.md", `---
artist: Katsushika Hokusai
date: 1814
---
# Seaside Village in Winter

An earlier Hokusai, from his *Album of Realistic Pictures* (1814): a quiet shore under snow.
`);
test("notes", async ({ scene: s }) => {
  const jpg = (f: string) => ({ name: f, mimeType: "image/jpeg", buffer: readFileSync(resolve("scripts/showcase/art", f)) });
  const h = await s.library([jpg(WAVE), jpg(VILLAGE), STUDY, VILLAGE_NOTE]);
  await s.canvas("Wave study");
  const ids = await s.placeRow([h[WAVE]!, h[STUDY.name]!]);
  await s.fit(ids, 0.62, [0.36, 0.5]);
  const b = (await s.box([ids[1]!]))!;
  await s.tool("select");
  const r = new Rec(s, "notes");
  await r.quiet();
  await r.move(1250, 820);
  await r.hold(2);
  const c: Pt = [Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2)];
  for (let i = 1; i <= 6; i++) { await r.move(1250 + (c[0] - 1250) * i / 6, 820 + (c[1] - 820) * i / 6); await r.snap(); }
  await s.p.mouse.dblclick(c[0], c[1]);
  await s.p.getByTestId("note-panel").locator(".sun-editor-editable h1").first().waitFor();
  r.down = true; await r.snap({}, 400); r.down = false;
  await r.hold(4);
  r.save();
});

// ---------- 8. the whole project on one canvas, and a print hidden 24 levels down: recorded zooming out from it ----------
test("endless", async ({ scene: s }) => {
  test.setTimeout(900_000);
  await s.fonts();
  const p = s.p;
  const horses = await s.art("delacroix", "bonheur", "degheyn");
  const dancers = await s.art("degas-dancer_with", "degas-dancer_onstage", "degas-dancer_adjusting");
  const [bird] = await s.art("hokusai-mystical");
  const [plants1, plants2] = await s.art("delany", "anonymous-botanical");
  await s.canvas("The project");
  const cam0 = await p.evaluate(() => window.__canvastDebug.camera());
  const from = async (dx: number, dy: number): Promise<void> => { await p.evaluate((c) => window.__canvastDebug.setCamera(c), cam0); await s.pan(dx, dy); };
  // four corners round an empty middle: horses, dancers with gesture lines, a comic page, botanical studies
  await from(-1500, -900);
  const hIds = await s.placeRow(horses);
  await s.fit(hIds, 0.6);
  const hb = (await s.box(hIds))!;
  await s.text(hb.minX, hb.minY - 64, "Horses: three masters", { size: 40, font: "cormorant garamond semibold", colour: "#efe6d2" });
  await from(1500, -900);
  const dIds = await s.placeRow(dancers);
  await s.fit(dIds, 0.7);
  await s.tool("pen");
  await setPenColour(p, "#ff5a3c");
  for (const id of dIds) {
    const b = (await s.box([id]))!;
    const pts = curve([inside(b, 0.5, 0.1), inside(b, 0.42, 0.35), inside(b, 0.53, 0.6), inside(b, 0.47, 0.93)]);
    await p.mouse.move(...pts[0]!); await p.mouse.down();
    for (const pt of pts.slice(1)) await p.mouse.move(...pt, { steps: 2 });
    await p.mouse.up();
  }
  await s.tool("select");
  await from(-1500, 900);
  await comicPage(s);
  await from(1500, 900);
  const pIds = await s.placeRow([plants1!, plants2!]);
  await s.fit(pIds, 0.6);
  const pb = (await s.box(pIds))!;
  await s.text(pb.minX, pb.maxY + 20, "leaf shapes: cut paper vs. pencil", { size: 26, font: "caveat", colour: "#e8c27a" });
  // the overview, then 24 levels down into its empty middle, where the bird is placed
  await s.fit(undefined, 0.84);
  const overview = await p.evaluate(() => window.__canvastDebug.camera());
  const centre = await p.evaluate(() => window.__canvastDebug.screenToWorld(720, 450));
  const DEEP = 24;
  await p.evaluate(([c, x, y]) => window.__canvastDebug.setCamera({ ...(c as object), cx: x, cy: y } as never), [overview, centre.x, centre.y] as const);
  // a picture every 6 levels, each in the middle of the one above it: the dive passes through them
  const [horse, dancer] = await s.art("degheyn", "degas-dancer_adjusting");
  const nested = [plants1!, horse!, dancer!];
  for (const [k, h] of nested.entries()) {
    for (let i = 0; i < 6; i += 3) { await p.evaluate(() => window.__canvastDebug.jump(3)); await s.settle(60); }
    const [n] = await s.place([h]);
    await s.fit([n!], 0.5);
    await s.select([]);
    const c = await p.evaluate(() => window.__canvastDebug.screenToWorld(720, 450));
    await p.evaluate(([x, y]) => window.__canvastDebug.setCamera({ ...window.__canvastDebug.camera(), cx: x, cy: y } as never), [c.x, c.y] as const);
    void k;
  }
  for (let i = 0; i < 6; i += 3) { await p.evaluate(() => window.__canvastDebug.jump(3)); await s.settle(60); }
  const [bId] = await s.place([bird!]);
  await s.fit([bId!], 0.62, [0.5, 0.47]);
  const bb = (await s.box([bId!]))!;
  await s.text(bb.minX, bb.maxY + 18, "Hokusai, Mystical Bird: 24 levels below the board", { size: 24, font: "caveat", colour: "#e8c27a" });
  await s.select([]);
  // camera on the bird's centre: every zoom step keeps it in the middle
  const r = new Rec(s, "endless");
  await r.quiet();
  await p.mouse.move(1440, 899);
  const depth = async (): Promise<number> => p.evaluate(() => { const c = window.__canvastDebug.camera() as unknown as { zi: string | number; zf: string | number }; return Number(c.zi) + Number(c.zf); });
  const z0 = await depth();
  const zEnd = Number((overview as unknown as { zi: number }).zi) + Number((overview as unknown as { zf: number }).zf) - 3;
  await r.snap({ z: 0 });
  const STEP = 0.2;
  while ((await depth()) > zEnd + 1e-6) {
    await p.evaluate((d) => window.__canvastDebug.jump(-d), Math.min(STEP, (await depth()) - zEnd));
    await r.snap({ z: (await depth()) - z0 }, 40);
  }
  r.save({ deep: z0 - zEnd - 3, overviewAt: -(z0 - zEnd - 3), step: STEP });
});

// ======================= clips added for the 60 s cut =======================

// ---------- crop: the right edge pulled in, live ----------
test("crop", async ({ scene: s }) => {
  await look(s, { theme: "light", hue: 25 });
  const [h] = await s.art("bonheur");
  await s.canvas("Crop");
  const [id] = await s.place([h!]);
  await s.fit([id!], 0.62);
  await s.select([id!]);
  await (await s.control("[data-crop]")).click();
  const b = (await s.box([id!]))!;
  const r = new Rec(s, "crop");
  await r.quiet();
  await r.move(b.maxX + 80, (b.minY + b.maxY) / 2 + 60);
  await r.hold(1);
  await r.drag([b.maxX - 2, (b.minY + b.maxY) / 2], [b.minX + (b.maxX - b.minX) * 0.5, (b.minY + b.maxY) / 2], 14, 1);
  await s.p.keyboard.press("Enter");
  await r.hold(2);
  r.save();
});

// ---------- auto layout: a pile of six becomes a grid ----------
test("autolayout", async ({ scene: s }) => {
  await look(s, { theme: "dark", hue: 210 });
  const art = await s.art("delacroix", "bonheur", "degheyn", "degas-dancer_with", "degas-dancer_onstage", "degas-dancer_adjusting", "hokusai-under", "vangogh");
  await s.canvas("Studies");
  const ids = await s.place(art);
  await s.fit(ids, 0.42);
  await s.select(ids);
  const r = new Rec(s, "autolayout");
  await r.quiet();
  await r.hold(2);
  await s.p.keyboard.press("Shift+A");
  await expect.poll(async () => (await s.objects()).some((o) => o.container)).toBe(true);
  const sheet = (await s.objects()).find((o) => o.container)!.id;
  await s.select([sheet]);
  await r.snap({ key: 1 });
  const field = async (sel: string, v: string): Promise<void> => {
    await r.ctl(sel);
    const f = s.p.locator(sel).filter({ visible: true }).first();
    await f.fill(v);
    await f.press("Enter");
    await r.snap({ key: 1 });
  };
  const flow = async (f: string): Promise<void> => {
    await r.ctl(`[data-layout-flow="${f}"]`);
    await s.p.locator(`[data-layout-flow="${f}"]`).filter({ visible: true }).first().click();
    r.down = true; await r.snap({ pop: 1 }); r.down = false;
    await r.hold(2);
  };
  await flow("grid");
  for (const [sel, v] of [['[data-layout-gap="0"]', "32"], ['[data-layout-gap="1"]', "32"], ['[data-layout-pad="h"]', "40"], ['[data-layout-pad="v"]', "40"]] as const) await field(sel, v);
  await flow("masonry");
  await field("[data-layout-columns]", "4");
  await flow("justified");
  r.ptr = null;
  await s.fit([sheet], 0.7, [0.45, 0.52]);
  await s.select([sheet]);
  await r.hold(2);
  r.save();
});

// ---------- adjustment shapes: a shape with no fill pixelates and blurs what is under it ----------
test("adjust", async ({ scene: s }) => {
  await look(s, { theme: "dark", hue: 300 });
  const [art] = await s.art("hokusai-under");
  await s.canvas("Adjust");
  const ids = await s.place([art!]);
  await s.fit(ids, 0.66);
  const b = (await s.p.locator("canvas").first().boundingBox())!;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await s.select([]);
  const r = new Rec(s, "adjust");
  await r.quiet();
  await r.hold(1);
  await s.p.keyboard.press("u");
  await s.p.click('[data-shape-kind="ellipse"]');
  await (await s.control('[data-paint="fill"]')).click();
  await s.p.locator('.colour-pop [data-mode="none"]').click();
  await s.p.keyboard.press("Escape");
  await s.p.keyboard.press("Escape"); // (the picker and the chip's options closed before the shape is drawn)
  await r.drag([cx - 260, cy - 170], [cx + 120, cy + 150], 14, 1);
  await s.p.keyboard.press("v");
  const btn = s.p.getByRole("button", { name: /^Adjust the picture/ });
  await r.at('[aria-label^="Adjust the picture"]');
  await btn.click();
  r.down = true; await r.snap({ pop: 1 }); r.down = false;
  await r.at('[data-testid="adjust-backdrop"]');
  await s.p.getByTestId("adjust-backdrop").check();
  await r.snap({ key: 1 });
  for (const [k, v] of [["pixelate", "35"], ["pixelate", "70"], ["exposure", "40"]] as const) {
    const n = s.p.locator(`.adjust-pop [data-adj-num="${k}"]`);
    await r.at(`.adjust-pop [data-adj-num="${k}"]`);
    await n.fill(v);
    await n.blur();
    await r.snap({ key: 1 });
  }
  r.ptr = null;
  await s.p.keyboard.press("Escape");
  await s.select([]);
  await r.hold(2);
  r.save();
});

// ---------- shapes: a value thumbnail blocked in, shape by shape ----------
test("shapes", async ({ scene: s }) => {
  await look(s, { theme: "light", hue: 210, pattern: "dots" });
  await s.canvas("Thumbnail");
  const r = new Rec(s, "shapes");
  await r.quiet();
  await r.hold(1);
  const parts: Array<[string, Pt, Pt, string]> = [["rect", [470, 230], [970, 590], "#d9dde3"], ["ellipse", [790, 300], [860, 370], "#f6f3ec"], ["polygon", [470, 360], [800, 590], "#9aa3ae"], ["polygon", [640, 410], [990, 590], "#5d6672"], ["rect", [470, 520], [970, 590], "#2a3038"]];
  for (const [kind, a, b, fill] of parts) {
    const before = new Set(await s.ids());
    await s.tool("shape");
    await s.p.locator(`[data-shape-kind="${kind}"]`).click();
    await r.drag(a, b, 6, 2);
    const id = (await s.ids()).find((i) => !before.has(i))!;
    await s.paint(id, "fill", fill);
    await r.snap({ pop: 1 });
  }
  r.ptr = null;
  await s.select([]);
  await r.hold(2);
  r.save();
});

// ---------- a mask: an oval drawn over a botanical print, then used as its mask ----------
test("mask", async ({ scene: s }) => {
  await look(s, { theme: "light", hue: 95 });
  const [h] = await s.art("delany");
  await s.canvas("Botanical print");
  const [pic] = await s.place([h!]);
  await s.fit([pic!], 0.66);
  const b = (await s.box([pic!]))!;
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, rx = (b.maxX - b.minX) * 0.4, ry = (b.maxY - b.minY) * 0.44;
  const r = new Rec(s, "mask");
  await r.quiet();
  await s.tool("shape");
  await s.p.locator('[data-shape-kind="ellipse"]').click();
  await r.drag([cx - rx, cy - ry], [cx + rx, cy + ry], 8, 2);
  const oval = (await s.ids()).find((i) => i !== pic)!;
  await s.paint(oval, "fill", "#ffffff");
  await s.tool("select");
  const ids = await s.ids();
  await s.select(ids);
  await r.snap();
  await maskWith(s.p, "clipmask");
  await s.select([]);
  r.ptr = null;
  await r.snap({ pop: 1 });
  await r.hold(2);
  r.save();
});

// ---------- a gradient: a sky turned from flat to linear ----------
test("gradient", async ({ scene: s }) => {
  await look(s, { theme: "dark", hue: 30 });
  await s.canvas("Sky");
  const before = new Set(await s.ids());
  await s.tool("shape");
  await s.p.locator('[data-shape-kind="rect"]').click();
  await s.app.drag({ x: 420, y: 250 }, { x: 900, y: 600 }, 4);
  const id = (await s.ids()).find((i) => !before.has(i))!;
  await s.paint(id, "fill", "#f2a65a");
  await s.select([id]);
  const r = new Rec(s, "gradient");
  await r.quiet();
  await r.ctl('[data-paint="fill"]');
  await r.snap();
  await s.p.locator('[data-paint="fill"]').filter({ visible: true }).first().click();
  r.down = true; await r.snap(); r.down = false;
  await r.at('.colour-pop [data-mode="linear"]');
  await s.p.locator('.colour-pop [data-mode="linear"]').click();
  r.down = true; await r.snap({ pop: 1 }); r.down = false;
  await r.hold(2);
  r.save();
});

// ---------- the colour picker: a swatch matched to the wave, colour by colour ----------
test("picker", async ({ scene: s }) => {
  await look(s, { theme: "light", hue: 220 });
  const [h] = await s.art("hokusai-under");
  await s.canvas("Matching");
  const [pic] = await s.place([h!]);
  await s.fit([pic!], 0.5, [0.35, 0.5]);
  const b = (await s.box([pic!]))!;
  const before = new Set(await s.ids());
  await s.tool("shape");
  await s.p.locator('[data-shape-kind="rect"]').click();
  await s.app.drag({ x: b.maxX + 30, y: b.minY }, { x: b.maxX + 150, y: b.minY + 120 }, 4);
  const sw = (await s.ids()).find((i) => !before.has(i))!;
  await s.paint(sw, "fill", "#e8e1cf");
  await s.select([sw]);
  await (await s.control('[data-paint="fill"]')).click();
  const r = new Rec(s, "picker");
  await r.quiet();
  await r.hold(1);
  const field = s.p.locator(".colour-pop [data-hex]").filter({ visible: true }).first();
  for (const c of ["d8cfb8", "9fb1c4", "5d7fa3", "2f5379", "1f3a5f", "142844"]) {
    await r.at(".colour-pop [data-hex]");
    await field.fill(c);
    await field.press("Enter");
    await r.snap({ key: 1 }, 60);
  }
  await r.hold(2);
  r.save();
});

// ---------- a title in Bangers, typed over a cover ----------
test("title", async ({ scene: s }) => {
  await look(s, { theme: "dark", hue: 220 });
  await s.fonts();
  const [h] = await s.art("hokusai-under");
  await s.canvas("Cover");
  const [pic] = await s.place([h!]);
  await s.fit([pic!], 0.6, [0.5, 0.58]);
  const b = (await s.box([pic!]))!;
  await s.text(b.minX, b.minY - 46, "a story told in four prints", { size: 26, font: "cormorant garamond semibold italic", colour: "#e9dfc8" });
  await startText(s, b.minX, b.minY - 140, { size: 72, font: "bangers", colour: "#f4efe6" });
  const r = new Rec(s, "title");
  await r.quiet();
  r.ptr = [b.minX, b.minY - 120];
  await r.hold(1);
  await r.type("THE CROSSING", 1);
  await endText(s);
  r.ptr = null;
  await r.hold(3);
  r.save();
});

// ---------- the Library's viewer: a print opened, then seen in grey ----------
test("viewer", async ({ scene: s }) => {
  const p = s.p;
  const hashes = await s.library(ART.map((a) => resolve("scripts/showcase/art", a.file)));
  await p.getByTestId("view-assets").click();
  await s.settle(600);
  const sel = `[data-testid="asset-card"][data-hash="${hashes[artFiles("hokusai-under")[0]!]}"]`;
  const r = new Rec(s, "viewer");
  await r.quiet();
  await r.move(1000, 700);
  await r.hold(1);
  await r.at(sel);
  await r.snap();
  await p.locator(sel).dblclick();
  r.down = true; await r.snap({}, 700); r.down = false;
  await r.hold(1);
  await r.at('[data-testid="viewer-grey"]');
  await r.snap();
  await p.getByTestId("viewer-grey").click();
  r.down = true; await r.snap({ pop: 1 }, 700); r.down = false;
  await r.hold(2);
  r.save();
});

// ---------- PDFs and 3D models in the Library ----------
function pdf(pages: Array<{ title: string; text: string[][]; figure: string; colour: string }>): Buffer {
  const esc = (t: string): string => t.replace(/[()\\]/g, (c) => "\\" + c);
  const objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  pages.forEach((pg, i) => {
    let y = 770;
    const lines = [`BT /F2 24 Tf 60 ${y} Td (${esc(pg.title)}) Tj ET`];
    y -= 36;
    for (const para of pg.text) { for (const line of para) lines.push(`BT /F1 12 Tf 60 ${(y -= 17)} Td (${esc(line)}) Tj ET`); y -= 12; }
    lines.push(`${pg.colour} rg 60 ${y - 190} 475 170 re f 0 0 0 rg BT /F1 10 Tf 60 ${y - 208} Td (${esc(`Figure ${i + 1}. ${pg.figure}`)}) Tj ET`);
    const text = lines.join("\n");
    objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objs[6 + i * 2] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  for (let i = 1; i < objs.length; i++) { at[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${at.slice(1).map((a) => `${String(a).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
const HANDOUT = pdf([
  { title: "Reading a woodblock print", colour: "0.84 0.78 0.66", figure: "The key block carries the outlines; each colour has a block of its own.", text: [["A Japanese woodblock print is made from several carved blocks.", "The key block holds the black outlines; every colour is printed", "from a block of its own, one after another, by hand."], ["Look for where the colours meet the lines: a slight shift", "shows two blocks that did not quite register."]] },
  { title: "Prussian blue", colour: "0.12 0.23 0.37", figure: "A swatch close to the deep blue of the wave.", text: [["The Great Wave is printed in a deep, lasting blue that was new", "to Japanese printmakers in the 1820s and 1830s: Prussian blue."], ["Mixing it, start darker than you think. Thinned, it turns", "cold and clear; at full strength it is almost black."]] },
  { title: "Composition", colour: "0.70 0.74 0.78", figure: "Mount Fuji, small and low, framed by the trough of the wave.", text: [["Mount Fuji is the smallest thing in the picture and sits low,", "framed by the trough of the wave. The eye goes to it last."], ["Copy it with the Pen in one stroke: the big curve of the wave", "first, then the boats as three simple masses."]] },
]);
function vase(n = 72): Buffer {
  const profile: Array<[number, number]> = [[0.0, 0], [0.42, 0], [0.48, 0.08], [0.62, 0.35], [0.66, 0.6], [0.55, 0.9], [0.32, 1.15], [0.24, 1.35], [0.3, 1.5], [0.36, 1.55]];
  const ring = (k: number, j: number): [number, number, number] => { const a = (j / n) * Math.PI * 2; const [rr, z] = profile[k]!; return [rr * Math.cos(a), rr * Math.sin(a), z]; };
  const f: string[] = [];
  const tri = (t: Array<[number, number, number]>): void => {
    const u = t[1]!.map((x, k) => x - t[0]![k]!), v = t[2]!.map((x, k) => x - t[0]![k]!);
    const nn = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const l = Math.hypot(...nn) || 1;
    f.push(`facet normal ${nn.map((x) => (x / l).toFixed(5)).join(" ")}\nouter loop\n${t.map((q) => `vertex ${q.map((x) => x.toFixed(5)).join(" ")}`).join("\n")}\nendloop\nendfacet`);
  };
  for (let k = 0; k < profile.length - 1; k++) for (let j = 0; j < n; j++) { const [a, b, c, d] = [ring(k, j), ring(k, j + 1), ring(k + 1, j + 1), ring(k + 1, j)]; tri([a, b, c]); tri([a, c, d]); }
  return Buffer.from(`solid vase\n${f.join("\n")}\nendsolid vase\n`);
}
async function viewFiles(s: Scene): Promise<void> {
  await s.library([{ name: "reading_a_woodblock_print.pdf", mimeType: "application/pdf", buffer: HANDOUT }, { name: "vase_for_light_study.stl", mimeType: "application/octet-stream", buffer: vase() }]);
  await s.p.getByTestId("view-assets").click();
}
test("pdf", async ({ scene: s }) => {
  await viewFiles(s);
  await s.p.locator('[data-testid="asset-card"][title="reading_a_woodblock_print.pdf"]').dblclick();
  await s.p.locator('[data-testid="pdf-view"] .pdf-page[data-page="1"][data-drawn]').waitFor();
  await s.settle(800);
  const r = new Rec(s, "pdf");
  await r.quiet();
  await r.move(720, 500);
  await r.hold(2);
  for (let i = 0; i < 14; i++) { await s.p.mouse.wheel(0, 70); await r.snap({}, 60); }
  await r.hold(1);
  r.save();
});
test("model", async ({ scene: s }) => {
  await look(s, { theme: "dark", hue: 30 });
  await viewFiles(s);
  await s.p.locator('[data-testid="asset-card"][title="vase_for_light_study.stl"]').dblclick();
  await s.p.locator('[data-testid="model-stage"][data-drawn]').waitFor({ timeout: 60_000 });
  await s.settle(600);
  const box = (await s.p.getByTestId("model-stage").boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const r = new Rec(s, "model");
  await r.quiet();
  await r.drag([cx - 160, cy], [cx + 220, cy + 60], 22, 1);
  await r.hold(1);
  await r.at('[data-testid="view-styles"]');
  await s.p.getByTestId("view-styles").click();
  r.down = true; await r.snap({ pop: 1 }); r.down = false;
  await s.p.getByRole("menuitem", { name: /^Etching/ }).click();
  await s.p.locator('[data-testid="model-stage"][data-inked="1"]').waitFor({ timeout: 60_000 });
  r.ptr = null;
  await r.snap({ key: 1 });
  await r.hold(2);
  r.save();
});

// ---------- export: a page of four prints, the Export dialog ----------
test("export", async ({ scene: s }) => {
  await look(s, { theme: "dark", hue: 220 });
  const art = await s.art("hokusai-seaside", "leprince", "verhaecht", "hokusai-under");
  await s.canvas("Page 1");
  const ids = await s.place(art);
  await s.fit(ids, 0.6);
  await s.select(ids);
  await s.p.keyboard.press("Shift+A");
  await expect.poll(async () => (await s.objects()).some((o) => o.container)).toBe(true);
  const pg = (await s.objects()).find((o) => o.container)!.id;
  await s.select([pg]);
  await (await s.control('[data-layout-flow="grid"]')).click();
  const cols = await s.control("[data-layout-columns]");
  await cols.fill("2");
  await cols.press("Enter");
  await s.p.keyboard.press("Escape");
  await s.fit([pg], 0.6);
  await s.select([pg]);
  const r = new Rec(s, "export");
  await r.quiet();
  await r.at('[data-ctx="exportmenu"]');
  await r.hold(1);
  await s.p.locator('[data-ctx="exportmenu"]').click();
  r.down = true; await r.snap(); r.down = false;
  await r.at('.pop-menu [data-id="exportpic"]');
  await r.snap();
  await s.p.locator('.pop-menu [data-id="exportpic"]').click();
  r.down = true; await r.snap({ pop: 1 }, 1000); r.down = false;
  r.ptr = null;
  await r.hold(2);
  r.save();
});

// ---------- privacy: drawings hidden from the Library one by one, then the workspace locked and opened with its password ----------
test("hide", async ({ scene: s }) => {
  await look(s, { theme: "dark", hue: 300 });
  const hs = await s.art("degas", "delacroix", "bonheur", "hokusai-under", "hokusai-seaside", "waterloo");
  const files = artFiles("degas", "delacroix", "bonheur", "hokusai-under", "hokusai-seaside", "waterloo");
  await s.p.getByTestId("view-assets").click();
  await s.settle(600);
  const r = new Rec(s, "hide");
  await r.quiet();
  await r.move(1100, 700);
  await r.hold(1);
  for (const f of artFiles("degas")) {
    const card = s.p.locator(`[data-testid="asset-card"][data-hash="${hs[files.indexOf(f)]}"]`);
    await r.at(`[data-testid="asset-card"][data-hash="${hs[files.indexOf(f)]}"]`);
    await card.click();
    await r.snap();
    await r.at('[data-testid="asset-hide"]');
    await s.p.getByTestId("asset-hide").click();
    r.down = true; await r.snap({ pop: 1 }, 250); r.down = false;
  }
  await r.hold(2);
  r.save();
});
test("lock", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 70 }); // (the default theme, Stone)
  await s.p.getByTestId("view-settings").click();
  await s.p.getByRole("tab", { name: /Privacy/ }).click();
  await s.p.getByTestId("workspace-pw-set").click();
  for (let i = 0; i < 2; i++) { await s.p.getByTestId("prompt-input").fill("correct horse"); await s.p.getByTestId("prompt-ok").click(); }
  await expect(s.p.locator('[data-pw-card="workspace"] [data-pw-state]')).toContainText("password was set");
  await s.p.reload();
  await s.p.getByTestId("lock-screen").waitFor();
  await s.p.waitForTimeout(500);
  const r = new Rec(s, "lock");
  r.snap = async (extra = {}) => { await s.p.waitForTimeout(40); await s.p.screenshot({ path: `${r.dir}/f${String(r.n++).padStart(4, "0")}.jpg`, type: "jpeg", quality: 90 }); r.frames.push({ ptr: r.ptr, down: r.down, ...extra }); };
  await r.hold(2);
  await s.p.getByTestId("lock-input").click();
  await r.type("correct horse", 1);
  await s.p.keyboard.press("Enter");
  await s.p.getByTestId("lock-screen").waitFor({ state: "hidden" });
  await s.p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await s.p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
  await s.p.waitForTimeout(600);
  await r.snap({ pop: 1 });
  await r.hold(2);
  r.save();
});

// ---------- make it yours: the same board through the theme colours, dark and light ----------
test("themes", async ({ scene: s }) => {
  await s.fonts();
  const art = await s.art("delacroix", "bonheur", "degheyn");
  await s.canvas("Horses");
  const ids = await s.placeRow(art);
  await s.fit(ids, 0.6, [0.5, 0.53]);
  const all = (await s.box(ids))!;
  await s.text(all.minX, all.minY - 64, "Horses: three masters", { size: 40, font: "cormorant garamond semibold", colour: "#c9b27a" });
  await s.select([ids[1]!]);
  const r = new Rec(s, "themes");
  await r.quiet();
  const set = (k: string, v: unknown): Promise<void> => s.p.evaluate(([a, b]) => window.__canvastDebug.setSetting(a as string, b), [k, v] as const);
  for (let i = 0; i < 24; i++) {
    if (i === 12) await set("ui.theme", "light");
    if (i === 2) await set("ui.vivid", 100); // (Stone, the default, first; then the hues in full colour)
    await set("ui.hue", Math.round((70 + i * 15) % 360));
    await set("ui.pattern", ["grid", "dots", "scale", "grid"][Math.floor(i / 6)]!);
    await r.snap(i % 6 === 0 ? { pop: 1 } : {});
  }
  r.save();
});
