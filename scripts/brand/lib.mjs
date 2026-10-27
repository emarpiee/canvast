// Drives a copy of the app for the brand board, like a person would. The copy of dist/canvast.html and the browser profile live in the
// system's temp folder, so dist/ can be rebuilt while a build runs. The fonts are the showcase's Space Grotesk (scripts/showcase/fonts).
import { chromium } from "@playwright/test";
import { mkdtempSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "showcase", "fonts");
export const VW = 1920, VH = 1200;

export async function open() {
  const tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cv-brand-"));
  copyFileSync(resolve("dist/canvast.html"), join(tmp, "canvast.html"));
  const ctx = await chromium.launchPersistentContext(join(tmp, "profile"), { viewport: { width: VW, height: VH }, acceptDownloads: true });
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  p.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
  await p.goto("file://" + join(tmp, "canvast.html") + "#debug");
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
  const H = (fn, arg) => p.evaluate(fn, arg);
  const A = { p, ctx, H };
  A.frame = () => H(() => window.__canvastDebug.nextFrame());
  A.world = (x, y) => H(([a, b]) => window.__canvastDebug.screenToWorld(a, b), [x, y]);
  A.cam = (w, zi) => H(([w, z]) => window.__canvastDebug.setCamera({ cx: w.x, cy: w.y, zi: z, zf: 0, pz: z }), [w, zi]).then(A.frame);
  A.shot = async (path) => { if (!path) return; await A.frame(); await p.waitForTimeout(300); await p.screenshot({ path }); };
  /** A paste fills half the view's height (600 px here) with the SVG's longest side, centred under the pointer. */
  A.paste = async (svg) => {
    await H((t) => { const dt = new DataTransfer(); dt.setData("text/plain", t); window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, svg);
    await A.frame();
  };
  A.esc = async () => { await p.keyboard.press("Escape"); await p.evaluate(() => document.activeElement?.blur()); await A.frame(); };
  A.setHex = async (hex) => { const f = p.locator(".colour-pop [data-hex]"); await f.fill(hex.replace("#", "")); await f.press("Enter"); await p.keyboard.press("Escape"); };
  A.loadFonts = async (fonts) => {
    await p.getByTestId("view-assets").click();
    await p.getByTestId("assets-import-input").setInputFiles(fonts.map(([name, file]) => ({ name, mimeType: "font/ttf", buffer: readFileSync(join(FONT_DIR, file)) })));
    await p.getByTestId("asset-card").nth(fonts.length - 1).waitFor();
    await p.getByTestId("view-canvas").click();
    await A.frame();
  };
  let lastText = null;
  /** A new text at screen x, y (its left edge, and the middle of its capitals); font, size and colour are set on the Text tool first and carry to the new text. */
  A.text = async (x, y, str, size, hex, font) => {
    await p.keyboard.press("t");
    const key = `${font}|${size}|${hex}`;
    if (key !== lastText) {
      await p.locator("select[data-text-font]").selectOption({ label: font });
      const sz = p.getByRole("spinbutton", { name: "Text size (px at this zoom)" });
      await sz.fill(String(size));
      await sz.press("Enter");
      await p.getByRole("button", { name: "Text colour" }).click();
      await A.setHex(hex);
      lastText = key;
    }
    await p.mouse.click(x, y);
    await p.waitForFunction(() => document.activeElement?.isContentEditable === true, null, { timeout: 3000 });
    await p.keyboard.type(str);
    await p.keyboard.press("Escape");
    await p.keyboard.press("v");
    await A.esc();
  };
  A.objects = () => H(() => window.__canvastDebug.objects());
  return A;
}
