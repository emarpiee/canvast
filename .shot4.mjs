import { chromium } from "playwright";
const b = await chromium.launch();
for (const w of [1100, 800]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 700 }, deviceScaleFactor: 1, colorScheme: "dark" });
  const p = await ctx.newPage();
  await p.goto("file://" + process.cwd() + "/dist/canvast.html");
  await p.waitForTimeout(1200);
  await p.keyboard.press("c"); await p.mouse.move(300, 250); await p.mouse.down(); await p.mouse.move(600, 450, { steps: 5 }); await p.mouse.up();
  await p.keyboard.press("t"); await p.mouse.click(350, 330); await p.keyboard.type("hello"); await p.keyboard.press("Escape");
  await p.keyboard.press("v"); await p.mouse.click(360, 338);
  await p.waitForTimeout(400);
  await p.screenshot({ path: process.argv[2] + `/bar-${w}.png`, clip: { x: 0, y: 0, width: w, height: 190 } });
  await ctx.close();
}
await b.close();
