// README pictures of "Comics and storyboards": a page laid out from four prints, lettered as comics are (white balloons with a black
// outline, capitals in a comic hand, tails to the speaker, caption boxes), the balloon kinds and the cover's type (manifest.ts).
import { chooseInMenu } from "../e2e/harness";
import { test, expect, type Scene, type Box } from "./scene";

type Kind = "" | "speech" | "thought" | "shout" | "caption" | "soft";
interface Balloon { box: [number, number, number, number]; words: string; kind?: Kind; tip?: [number, number]; fill?: string; size?: number; font?: string }

/** One balloon: drawn, given its kind and its tail, its words written, then painted as comics are (a white body with a black
 * outline) and its words set in a comic hand. The camera is put back after writing (writing brings the view to the balloon). Its id. */
async function balloon(s: Scene, b: Balloon): Promise<string> {
  const p = s.p;
  const cam = await p.evaluate(() => window.__canvastDebug.camera());
  const before = new Set(await s.ids());
  await s.tool("balloon");
  const [x0, y0, x1, y1] = b.box;
  await s.app.drag({ x: x0, y: y0 }, { x: x1, y: y1 }, 4);
  const id = (await s.objects()).find((o) => !before.has(o.id) && o.shape === "balloon")!.id;
  await s.tool("select");
  await s.select([id]);
  if (b.kind) {
    await (await s.control("[data-bln='preset']")).selectOption(b.kind); // (the balloon's Body chip)
    await p.keyboard.press("Escape"); // (its options closed: the words are typed next)
  }
  // its words first (a double-click in the body, where it was drawn), then its tail to the speaker
  await p.mouse.dblclick((x0 + x1) / 2, (y0 + y1) / 2);
  await p.waitForFunction(() => document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable);
  await p.keyboard.type(b.words);
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  await s.blur();
  await p.evaluate((c) => window.__canvastDebug.setCamera(c), cam);
  await s.settle();
  if (b.tip) {
    await s.select([id]);
    const tip = (await p.evaluate(() => window.__canvastDebug.balloonDots())).find((d) => d.part === "tip");
    if (tip) await s.app.drag({ x: tip.x, y: tip.y }, { x: b.tip[0], y: b.tip[1] }, 5);
  }
  await s.paint(id, "fill", b.fill ?? "#ffffff");
  await s.paint(id, "stroke", "#111111");
  const words = (await p.evaluate(() => window.__canvastDebug.objects() as unknown as Array<{ id: string; kind: string; inShape?: { shape: string } }>)).find((o) => o.kind === "text" && o.inShape?.shape === id);
  if (words) {
    await s.select([words.id]);
    await s.font(b.font ?? "comic neue");
    const sz = await s.control("[data-text-size]");
    await sz.fill(String(b.size ?? 20));
    await sz.press("Enter");
    await (await s.control("[data-text-colour]")).click();
    await s.hex("#111111");
    // (never words past the shape: when they do not fit at that size, the balloon's own Fit text to shape makes them as big as fits)
    await s.select([id]);
    const fit = await s.control('[data-bl="fit"]');
    if (/does not fit/.test((await fit.getAttribute("title")) ?? "")) await fit.click();
    await p.keyboard.press("Escape");
  }
  await s.select([]);
  await s.settle();
  return id;
}
const inside = (b: Box, x: number, y: number): [number, number] => [b.minX + (b.maxX - b.minX) * x, b.minY + (b.maxY - b.minY) * y];

/** A comic page: the four prints as panels on a page sheet with auto layout, two columns. The page's id and the panels'. */
async function page(s: Scene): Promise<{ page: string; panels: string[] }> {
  // (placed in story order: the grid "in stacking order" keeps that order)
  const art = await s.art("hokusai-seaside", "leprince", "verhaecht", "hokusai-under");
  await s.canvas("Page 1");
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
  await s.look({ theme: "dark", hue: 210 });
  await s.fonts();
  const { page: pg, panels } = await page(s);
  // (writing in a balloon brings the view to it: the page is framed again before each)
  const on = async (i: number): Promise<Box> => { await s.fit([pg], 0.86); return (await s.box([panels[i]!]))!; };
  let b = await on(0);
  await balloon(s, { box: [...inside(b, 0.03, 0.04), ...inside(b, 0.5, 0.2)] as [number, number, number, number], words: "WINTER. THE VILLAGE WAITS FOR THE BOATS.", kind: "caption", fill: "#f3e3a6", size: 15 });
  b = await on(1);
  await balloon(s, { box: [...inside(b, 0.5, 0.05), ...inside(b, 0.96, 0.33)] as [number, number, number, number], words: "THE FORD IS HIGH THIS YEAR.", kind: "speech", tip: inside(b, 0.55, 0.62), size: 15 });
  b = await on(2);
  await balloon(s, { box: [...inside(b, 0.03, 0.04), ...inside(b, 0.5, 0.22)] as [number, number, number, number], words: "THREE DAYS OVER THE PASS.", kind: "caption", fill: "#f3e3a6", size: 15 });
  b = await on(3);
  await balloon(s, { box: [...inside(b, 0.5, 0.03), ...inside(b, 0.97, 0.45)] as [number, number, number, number], words: "HOLD ON!", kind: "shout", tip: inside(b, 0.42, 0.7), font: "bangers", size: 30 });
  await s.fit([pg], 0.66);
  await s.shot("comic", await s.around({ objects: [pg], pad: 20 }));
});

test("balloon-kinds", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 30, pattern: "dots" });
  await s.fonts();
  await s.canvas("Lettering");
  const made: string[] = [];
  made.push(await balloon(s, { box: [220, 260, 520, 420], words: "WE'LL BE HOME BY DARK.", kind: "speech", tip: [300, 520] }));
  made.push(await balloon(s, { box: [580, 250, 860, 420], words: "IF THE RIVER LETS US...", kind: "thought", tip: [640, 540] }));
  made.push(await balloon(s, { box: [910, 240, 1220, 440], words: "LOOK OUT!", kind: "shout", tip: [1000, 540], font: "bangers", size: 34 }));
  made.push(await balloon(s, { box: [300, 600, 700, 670], words: "LATER THAT NIGHT.", kind: "caption", fill: "#f3e3a6" }));
  await s.select([made[2]!]);
  await s.settle();
  await s.control("[data-bln='preset']"); // (the Body chip's options open: its Preset)
  await s.shot("balloon-kinds", await s.around({ objects: made, els: ["[data-bln='preset']", ...(await s.chipEls())], pad: 30 }));
});

test("balloons", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 30 });
  await s.fonts();
  const [h] = await s.art("leprince");
  await s.canvas("Panel");
  const [pic] = await s.place([h!]);
  await s.fit([pic!], 0.62, [0.4, 0.5]);
  const b = (await s.box([pic!]))!;
  const id = await balloon(s, { box: [...inside(b, 0.5, 0.05), ...inside(b, 0.95, 0.33)] as [number, number, number, number], words: "THE FORD IS HIGH THIS YEAR.", kind: "speech", tip: inside(b, 0.55, 0.62), size: 16 });
  await s.fit([pic!], 0.62, [0.4, 0.5]);
  await s.select([id]);
  await s.settle();
  await s.control("[data-bln='tail']"); // (the Tail chip's options open: where the tail points is the picture's point)
  await s.shot("balloons", await s.around({ objects: [pic!], els: ["[data-bln='tail']", ...(await s.chipEls())], pad: 24 }));
});

test("text", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 220 });
  await s.fonts();
  const [h] = await s.art("hokusai-under");
  await s.canvas("Cover");
  const [pic] = await s.place([h!]);
  await s.fit([pic!], 0.6, [0.5, 0.56]);
  const b = (await s.box([pic!]))!;
  const sub = await s.text(b.minX, b.minY - 46, "a story told in four prints", { size: 26, font: "cormorant garamond semibold italic", colour: "#e9dfc8" });
  // the title, left being edited: its formatting bar shows
  await s.tool("text");
  await s.font("bangers");
  const sz = s.p.getByRole("spinbutton", { name: "Text size (px at this zoom)" });
  await sz.fill("64");
  await sz.press("Enter");
  await s.p.getByRole("button", { name: "Text colour" }).click();
  await s.hex("#f4efe6");
  await s.p.mouse.click(b.minX, b.minY - 130);
  await s.p.waitForFunction(() => document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable);
  await s.p.keyboard.type("THE CROSSING");
  await s.p.keyboard.press("Control+a");
  await s.settle();
  // (no chip's options open: the formatting bar over the title is the picture)
  await s.shot("text", await s.around({ objects: [pic!, sub], els: [".text-format", ...(await s.chipEls())], pad: 30 }));
});
