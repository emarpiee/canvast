// README pictures of "Drawing and vector editing": each test is one picture of one feature, in the way an artist uses it (manifest.ts).
import { boolWith, maskWith, pathWith, setPenColour } from "../e2e/harness";
import { test, expect, type Scene } from "./scene";

async function line(s: Scene, pts: Array<[number, number]>): Promise<void> {
  await s.p.mouse.move(pts[0]![0], pts[0]![1]);
  await s.p.mouse.down();
  for (const [x, y] of pts.slice(1)) await s.p.mouse.move(x, y, { steps: 3 });
  await s.p.mouse.up();
}
/** A smooth curve through these points (Catmull-Rom), as many points as a hand would give. */
const curve = (pts: Array<[number, number]>, n = 10): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
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
/** A shape drawn with the Shape tool from one corner to the other, then painted; its id. */
async function shape(s: Scene, kind: string, from: [number, number], to: [number, number], fill: string): Promise<string> {
  const before = new Set(await s.ids());
  await s.tool("shape");
  await s.p.locator(`[data-shape-kind="${kind}"]`).click();
  await s.app.drag({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, 4);
  const id = (await s.ids()).find((i) => !before.has(i))!;
  await s.paint(id, "fill", fill);
  return id;
}

test("pen", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 20 });
  const art = await s.art("degas-dancer_with", "degas-dancer_onstage", "degas-dancer_adjusting");
  await s.canvas("Gesture");
  const ids = await s.place(art);
  await s.select(ids);
  await s.p.locator('[data-ctx="arrangemenu"]').click();
  await s.p.locator('.pop-menu [data-id="grid:name-asc"]').click();
  await s.p.keyboard.press("Escape");
  await s.fit(ids, 0.7, [0.5, 0.55]);
  await s.tool("pen");
  await setPenColour(s.p, "#ff5a3c");
  // a line of action over each dancer: from the head down through the weight to the foot that carries it
  for (const id of ids) {
    const b = (await s.box([id]))!;
    const at = (x: number, y: number): [number, number] => [b.minX + (b.maxX - b.minX) * x, b.minY + (b.maxY - b.minY) * y];
    await line(s, curve([at(0.5, 0.12), at(0.42, 0.35), at(0.52, 0.6), at(0.47, 0.92)]));
  }
  await s.settle();
  await s.shot("pen", await s.around({ objects: ids, els: ["[data-pen-kind]"], pad: 24 }));
});

test("shape-kinds", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 210, pattern: "dots" });
  await s.canvas("Thumbnail");
  // a value thumbnail of a landscape blocked in with shapes: sky, a low sun, far hills, near hills, a dark foreground
  const ids = [
    await shape(s, "rect", [470, 230], [970, 590], "#d9dde3"),
    await shape(s, "ellipse", [790, 300], [860, 370], "#f6f3ec"),
    await shape(s, "polygon", [470, 360], [800, 590], "#9aa3ae"),
    await shape(s, "polygon", [640, 410], [990, 590], "#5d6672"),
    await shape(s, "rect", [470, 520], [970, 590], "#2a3038"),
  ];
  await s.tool("shape");
  await s.shot("shape-kinds", await s.around({ objects: ids, els: ['[data-shape-kind="rect"]', '[data-shape-kind="star"]'], pad: 30 }));
});

// A wave crest built as an icon is: circles joined, then circles cut out of it for the curl and the claws.
const CREST_PARTS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
<circle cx="170" cy="170" r="120" fill="#1d4e89"/><rect x="40" y="200" width="330" height="90" fill="#1d4e89"/>
<circle cx="205" cy="150" r="80" fill="#f4efe6"/><circle cx="262" cy="70" r="24" fill="#f4efe6"/><circle cx="283" cy="104" r="17" fill="#f4efe6"/><circle cx="292" cy="133" r="12" fill="#f4efe6"/></svg>`;

test("shapes", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 220 });
  await s.canvas("Logo");
  const loose = await s.svg(CREST_PARTS, [470, 450], true);
  const parts = await s.svg(CREST_PARTS, [1010, 450], true);
  // the right copy: the blue body joined, then the cream circles cut out of it
  await s.select(parts);
  await boolWith(s.p, "op:subtract");
  await s.settle();
  const made = (await s.ids()).filter((i) => !loose.includes(i));
  await s.fit([...loose, ...made], 0.7);
  await s.select(made);
  await s.p.locator('[data-ctx="boolmenu"]').click();
  await expect(s.p.locator(".pop-menu")).toBeVisible();
  await s.shot("shapes", await s.around({ objects: [...loose, ...made], els: [".pop-menu"], pad: 30 }));
});

test("nodes", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 220 });
  await s.canvas("Logo");
  const parts = await s.svg(CREST_PARTS, [720, 450], true);
  await s.select(parts);
  await boolWith(s.p, "op:subtract");
  await s.select(await s.ids());
  await boolWith(s.p, "flatten");
  await s.fit(undefined, 0.6);
  await s.select(await s.ids());
  await s.tool("node");
  const b = (await s.box())!;
  await s.app.drag({ x: b.maxX - (b.maxX - b.minX) * 0.45, y: b.minY - 20 }, { x: b.maxX + 20, y: b.minY + (b.maxY - b.minY) * 0.5 }, 6); // (the claws' nodes picked)
  await s.settle();
  await s.shot("nodes", await s.around({ objects: await s.ids(), pad: 50 }));
});

test("mask", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 95 });
  await s.fonts();
  const [h] = await s.art("delany");
  await s.canvas("Botanical print");
  const [pic] = await s.place([h!]);
  await s.fit([pic!], 0.6);
  const b = (await s.box([pic!]))!;
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, rx = (b.maxX - b.minX) * 0.4, ry = (b.maxY - b.minY) * 0.44;
  await shape(s, "ellipse", [cx - rx, cy - ry], [cx + rx, cy + ry], "#ffffff");
  await s.select(await s.ids());
  await maskWith(s.p, "clipmask");
  await s.select([]);
  const label = await s.text(cx - rx, cy + ry + 26, "Mary Delany, Botanical Study, ca. 1772–82", { size: 24, font: "cormorant garamond semibold italic", colour: "#3b3428" });
  await s.select((await s.ids()).filter((i) => i !== label));
  await s.p.locator('[data-ctx="maskmenu"]').click();
  await s.shot("mask", await s.around({ objects: await s.ids(), els: [".pop-menu"], pad: 30 }));
});

test("fill-gradient", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 30 });
  await s.canvas("Sky");
  const id = await shape(s, "rect", [420, 250], [900, 600], "#f2a65a");
  await s.select([id!]);
  await s.p.locator('[data-paint="fill"]').filter({ visible: true }).first().click();
  await s.p.locator('.colour-pop [data-mode="linear"]').click();
  await s.settle();
  await s.shot("fill-gradient", await s.around({ objects: [id!], els: [".colour-pop"], pad: 30 }));
});

test("pattern", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 220 });
  await s.canvas("Endpapers");
  await s.tool("sheet");
  await s.app.drag({ x: 380, y: 200 }, { x: 900, y: 640 }, 6);
  const sheet = (await s.objects()).find((o) => o.container)!.id;
  await s.select([sheet]);
  await s.p.getByRole("button", { name: "Pattern panel", exact: true }).click();
  await s.p.locator("[data-pg-pick]").click();
  await s.p.locator('.pg-tile[data-gen="scales"]').click();
  await s.p.getByTestId("pattern-make").click();
  await expect.poll(async () => (await s.objects()).length).toBeGreaterThan(1);
  await s.settle(600);
  await s.shot("pattern", await s.around({ objects: [sheet], els: ['[data-pg-pick]'], pad: 30 }));
});

test("guides", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 200 });
  const [h] = await s.art("hokusai-under");
  await s.canvas("Composition");
  const [pic] = await s.place([h!]);
  await s.fit([pic!], 0.62, [0.42, 0.5]);
  const b = (await s.box([pic!]))!;
  await s.tool("sheet");
  await s.app.drag({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }, 6);
  const sheet = (await s.objects()).find((o) => o.container)!.id;
  await s.select([sheet]);
  await s.p.getByRole("button", { name: "Pattern panel", exact: true }).click();
  await s.p.locator('[data-pg-tabs] [role="tab"]', { hasText: "Guides" }).click();
  await s.p.locator("[data-pg-pick]").click();
  await s.p.locator('.pg-tile[data-gen="golden-spiral"]').click();
  await s.p.getByTestId("pattern-make").click();
  await s.settle(800);
  await s.shot("guides", await s.around({ objects: [pic!], els: ['[data-pg-pick]'], pad: 24 }));
});

test("palette", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 220 });
  const [h] = await s.art("hokusai-under");
  await s.canvas("Palette");
  const [pic] = await s.place([h!]);
  await s.fit([pic!], 0.5, [0.6, 0.5]);
  await s.select([pic!]);
  await s.p.getByRole("button", { name: "Styles panel", exact: true }).click();
  await s.p.locator("[data-kind-pick]").first().click();
  await s.p.locator('[data-id="kind:palette"]').click();
  await s.p.locator('[data-new-from="picture"]').click();
  await expect(s.p.locator(".style-palette")).toHaveCount(1);
  await s.p.locator(".style-palette .style-card").first().click();
  await s.settle();
  await s.shot("palette", await s.around({ objects: [pic!], els: [".styles-panel, [data-panel='styles']"], pad: 24 }));
});

test("colour-picker", async ({ scene: s }) => {
  await s.look({ theme: "light", hue: 220 });
  const [h] = await s.art("hokusai-under");
  await s.canvas("Matching");
  const [pic] = await s.place([h!]);
  await s.fit([pic!], 0.5, [0.35, 0.5]);
  const b = (await s.box([pic!]))!;
  const sw = await shape(s, "rect", [b.maxX + 30, b.minY], [b.maxX + 150, b.minY + 120], "#1f3a5f");
  await s.select([sw]);
  await s.p.locator('[data-paint="fill"]').filter({ visible: true }).first().click();
  await s.settle();
  await s.shot("colour-picker", await s.around({ objects: [pic!, sw], els: [".colour-pop"], pad: 24 }));
});

test("path-tools", async ({ scene: s }) => {
  await s.look({ theme: "dark", hue: 280 });
  await s.fonts();
  await s.canvas("Cover");
  // (a vector curve to set the words on: a path, not a pen stroke)
  const [path] = await s.svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><path d="M10 170 C 160 20, 440 20, 590 150" fill="none" stroke="#8fb3ff" stroke-width="3"/></svg>`, [720, 420], true);
  const t = await s.text(470, 600, "Under the wave off Kanagawa", { size: 34, font: "cormorant garamond semibold", colour: "#f2efe8" });
  await s.select([path!, t]);
  await pathWith(s.p, "onpath");
  await s.select([t]);
  await s.p.locator('[data-ctx="pathmenu"]').click();
  await s.shot("path-tools", await s.around({ objects: await s.ids(), els: [".pop-menu"], pad: 30 }));
});
