// What every README picture shares (ADR 0187 pattern: shots are written like the end-to-end specs). A shot is a Playwright test on the
// harness's `app` fixture: a fresh page of the built app, input that must land where it says, waits on the app's own state (never on
// time alone), and a trace when it fails. The scene helpers below build real work (public-domain art, fonts, SVG, text) and take the
// picture of just what the README section is about. Every shot is declared in manifest.ts; `npm run check:shots` matches it to the README.
import { readFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test as base, expect, type App } from "../e2e/harness";
import { SHOTS } from "./manifest";

export { expect };

/** The artworks (scripts/showcase/art): all public domain, The Met Open Access; art.json says where each comes from. */
export const ART = JSON.parse(readFileSync(resolve("scripts/showcase/art/art.json"), "utf8")) as Array<{ file: string; artist: string; title: string; date: string }>;
const ART_DIR = resolve("scripts/showcase/art");
const FONT_DIR = resolve("scripts/showcase/fonts");
/** Where the pictures go (PNG; the workflow makes them WebP). */
export const OUT = resolve(process.env["CANVAST_SHOTS_DIR"] ?? "shots");

export interface Box { minX: number; minY: number; maxX: number; maxY: number }
export interface Clip { x: number; y: number; width: number; height: number }
type Obj = { id: string; kind: string; name?: string; container?: boolean; shape?: string };

/** The art files whose name starts with one of these (an artist, or artist-title), in that order. */
export function artFiles(...starts: string[]): string[] {
  return starts.flatMap((s) => ART.filter((a) => a.file.startsWith(s)).map((a) => a.file));
}

export class Scene {
  readonly W = 1440;
  readonly H = 900;
  constructor(readonly app: App) {}
  get p(): Page {
    return this.app.page;
  }
  frame = (): Promise<void> => this.app.frame();
  async settle(ms = 250): Promise<void> {
    await this.frame();
    if (ms) await this.p.waitForTimeout(ms);
    await this.frame();
  }
  objects = (): Promise<Obj[]> => this.p.evaluate(() => window.__canvastDebug.objects() as unknown as Obj[]);
  async ids(): Promise<string[]> {
    return (await this.objects()).map((o) => o.id);
  }
  async blur(): Promise<void> {
    await this.p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }
  select = (ids: string[]): Promise<void> => this.p.evaluate((x) => window.__canvastDebug.select(x), ids);
  /** The app's look for this picture: light or dark, its theme colour (a hue, 0-360), the canvas pattern and the density. */
  async look({ theme = "dark", hue = 178, pattern = "grid", density = "compact" }: { theme?: "light" | "dark"; hue?: number; pattern?: "grid" | "dots" | "scale" | "none"; density?: "comfortable" | "compact" | "dense" } = {}): Promise<void> {
    await this.p.evaluate(([t, h, pt, d]) => {
      const s = window.__canvastDebug.setSetting;
      s("ui.theme", t); s("ui.hue", h); s("ui.pattern", pt); s("ui.density", d); s("ui.names", "off");
    }, [theme, hue, pattern, density] as const);
    await this.settle();
  }

  /** A tool, chosen through the debug hook (keys go to whatever has the focus). */
  async tool(name: "select" | "pen" | "shape" | "balloon" | "text" | "sheet" | "node" | "path"): Promise<void> {
    await this.blur();
    await this.p.evaluate((n) => window.__canvastDebug.setTool(n as never), name);
    await this.settle(100);
  }
  /** Objects side by side in a row, a gap of `gap` px on the screen between them, in the order given. */
  async row(ids: string[], gap = 40): Promise<void> {
    await this.tool("select");
    let right: number | null = null;
    for (const id of ids) {
      const b = (await this.box([id]))!;
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      const want = right === null ? b.minX : right + gap;
      if (right !== null) {
        await this.select([id]);
        await this.app.drag({ x: cx, y: cy }, { x: cx + (want - b.minX), y: cy }, 6);
      }
      right = (await this.box([id]))!.maxX;
    }
    await this.select([]);
    await this.settle();
  }
  /** A new canvas in the first board, named, and open. */
  async canvas(name: string): Promise<void> {
    const p = this.p;
    const tree = await p.evaluate(() => window.__canvastDebug.session().tree);
    await p.evaluate((id) => window.__canvastDebug.workspaceOp("newCanvas", id), tree![0]!.id);
    const now = (await p.evaluate(() => window.__canvastDebug.session().tree))![0]!;
    const c = now.canvases[now.canvases.length - 1]!;
    await p.evaluate(([id, n]) => window.__canvastDebug.workspaceOp("renameCanvas", id!, n!), [c.id, name]);
    await p.getByTestId("workspace-nav").click();
    await p.getByTestId("workspace-menu").getByText(name, { exact: true }).click();
    if (await p.getByTestId("workspace-menu").isVisible()) await p.keyboard.press("Escape");
    await expect.poll(() => p.evaluate(() => window.__canvastDebug.session().current?.canvasId)).toBe(c.id);
    await this.blur();
    await this.settle();
  }

  /** Files into the library (the Library view, then back to the canvas); each one's hash by its file name. */
  async library(files: Array<string | { name: string; mimeType: string; buffer: Buffer }>): Promise<Record<string, string>> {
    const p = this.p;
    await p.getByTestId("view-assets").click();
    await p.getByTestId("assets-import-input").setInputFiles(files as Parameters<Page["setInputFiles"]>[1]);
    const names = files.map((f) => (typeof f === "string" ? f.split("/").pop()! : f.name));
    const found = async (): Promise<Record<string, string>> => {
      const entries = (await p.evaluate(() => window.__canvastDebug.catalogEntries())) as unknown as Array<{ name: string; hash: string }>;
      return Object.fromEntries(entries.filter((e) => names.includes(e.name)).map((e) => [e.name, e.hash]));
    };
    await expect.poll(async () => Object.keys(await found()).length, { timeout: 60_000 }).toBe(names.length);
    const hashes = await found();
    await p.getByTestId("view-canvas").click();
    await this.settle();
    return hashes;
  }
  /** Artworks into the library: their hashes, in the order asked. */
  async art(...starts: string[]): Promise<string[]> {
    const files = artFiles(...starts);
    const h = await this.library(files.map((f) => resolve(ART_DIR, f)));
    return files.map((f) => h[f]!);
  }
  /** The fonts of scripts/showcase/fonts into the library (OFL, licences beside them). */
  async fonts(): Promise<void> {
    await this.library(readdirSync(FONT_DIR).filter((f) => f.endsWith(".ttf")).map((f) => resolve(FONT_DIR, f)));
  }
  /** Library items placed on the open canvas (each in the middle of the view); their ids. */
  async place(hashes: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const h of hashes) out.push((await this.p.evaluate((x) => window.__canvastDebug.placeFromLibrary(x), h)) as string);
    await this.settle();
    return out;
  }

  /** Where these objects are on the screen, together (all objects when none are given). */
  async box(ids?: string[]): Promise<Box | null> {
    return this.p.evaluate((list) => {
      const d = window.__canvastDebug;
      const bs = (list ?? d.objects().map((o: { id: string }) => o.id)).map((id: string) => d.objectScreen(id)?.box).filter((b): b is NonNullable<typeof b> => !!b);
      if (!bs.length) return null;
      return { minX: Math.min(...bs.map((b) => b.minX)), minY: Math.min(...bs.map((b) => b.minY)), maxX: Math.max(...bs.map((b) => b.maxX)), maxY: Math.max(...bs.map((b) => b.maxY)) };
    }, ids ?? null);
  }
  /** The camera on these objects (all when none are given), filling `fill` of the view; the selection is left empty. */
  async fit(ids?: string[], fill = 0.72, at: [number, number] = [0.5, 0.5]): Promise<void> {
    await this.blur();
    for (let round = 0; round < 4; round++) {
      const b = await this.box(ids);
      if (!b) return;
      const want: [number, number] = [this.W * at[0], this.H * at[1]];
      await this.p.evaluate(([x, y, wx, wy]) => {
        const d = window.__canvastDebug;
        const here = d.screenToWorld(x!, y!), centre = d.screenToWorld(wx!, wy!);
        const cam = d.camera();
        // (move the camera so the box's centre lands on the wanted point: shift by the world distance between them)
        const sh = (a: string, b: string, c: string): string => { const n = (s: string): [bigint, number] => { const [m, e] = s.split("p"); return [BigInt(m!), Number(e)]; }; const [ma, ea] = n(a), [mb, eb] = n(b), [mc, ec] = n(c); const e = Math.min(ea, eb, ec); const v = (m: bigint, x: number): bigint => m << BigInt(x - e); return `${v(mc, ec) + v(ma, ea) - v(mb, eb)}p${e}`; };
        d.setCamera({ ...cam, cx: sh(here.x, centre.x, cam.cx), cy: sh(here.y, centre.y, cam.cy) });
      }, [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, want[0], want[1]]);
      await this.settle(100);
      const s = Math.min((this.W * fill) / Math.max(1, b.maxX - b.minX), (this.H * fill) / Math.max(1, b.maxY - b.minY));
      if (Math.abs(Math.log2(s)) < 0.04) break;
      await this.p.evaluate((l) => window.__canvastDebug.jump(l), Math.log2(s));
      await this.settle(150);
    }
    await this.select([]);
    await this.settle();
  }

  /** Paste SVG text at a point (it comes in as one group, half the view high); the ids it made. `loose`: ungrouped. */
  async svg(svg: string, at: [number, number] = [720, 450], loose = false): Promise<string[]> {
    const before = new Set(await this.ids());
    await this.p.mouse.move(at[0], at[1]);
    await this.p.evaluate((t) => { const dt = new DataTransfer(); dt.setData("text/plain", t); window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, svg);
    await expect.poll(async () => (await this.ids()).some((i) => !before.has(i))).toBe(true);
    if (loose) await this.command("Ungroup");
    await this.settle();
    return (await this.ids()).filter((i) => !before.has(i));
  }
  /** A command of the palette, by its name. */
  async command(name: string): Promise<void> {
    await this.blur();
    await this.p.keyboard.press("Control+k");
    await this.p.keyboard.type(name);
    await this.p.waitForTimeout(150);
    await this.p.keyboard.press("Enter");
    await this.settle();
  }
  /** A colour typed into the open colour popover. */
  async hex(value: string): Promise<void> {
    const field = this.p.locator(".colour-pop [data-hex]").filter({ visible: true }).first();
    await field.fill(value.replace("#", ""));
    await field.press("Enter");
    await this.p.keyboard.press("Escape");
  }
  /** The Text tool's font, by part of its name (a font in the library). */
  async font(part: string): Promise<void> {
    const sel = this.p.locator("select[data-text-font]").filter({ visible: true }).first();
    const norm = (x: string): string => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    const label = await sel.evaluate((s: HTMLSelectElement, w: string) => [...s.options].find((o) => o.text.toLowerCase().replace(/[^a-z0-9]/g, "").includes(w))?.text ?? null, norm(part));
    expect(label, `a font named like "${part}" in the library`).not.toBeNull();
    await sel.selectOption({ label: label! });
  }
  /** A text at a point, in a font, size and colour set on the Text tool first; its id. */
  async text(x: number, y: number, words: string, { size = 24, colour = "#f2efe8", font = "" } = {}): Promise<string> {
    const p = this.p;
    await this.tool("text");
    if (font) await this.font(font);
    const sz = p.getByRole("spinbutton", { name: "Text size (px at this zoom)" });
    await sz.fill(String(size));
    await sz.press("Enter");
    await p.getByRole("button", { name: "Text colour" }).click();
    await this.hex(colour);
    await p.mouse.click(x, y);
    await p.waitForFunction(() => document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable);
    await p.keyboard.type(words);
    await p.keyboard.press("Escape");
    await this.tool("select");
    await p.keyboard.press("Escape");
    await this.blur();
    await this.settle();
    return (await this.objects()).filter((o) => o.kind === "text").at(-1)!.id;
  }

  /** A part of the window: round these objects and these elements, with a margin. */
  async around({ objects = [] as string[], els = [] as string[], pad = 28 } = {}): Promise<Clip> {
    const bs: Box[] = [];
    if (objects.length) { const b = await this.box(objects); if (b) bs.push(b); }
    for (const s of els) {
      const b = await this.p.locator(s).filter({ visible: true }).first().boundingBox();
      expect(b, `${s} is on the screen`).not.toBeNull();
      bs.push({ minX: b!.x, minY: b!.y, maxX: b!.x + b!.width, maxY: b!.y + b!.height });
    }
    expect(bs.length, "something to take").toBeGreaterThan(0);
    const x0 = Math.max(0, Math.min(...bs.map((b) => b.minX)) - pad), y0 = Math.max(0, Math.min(...bs.map((b) => b.minY)) - pad);
    const x1 = Math.min(this.W, Math.max(...bs.map((b) => b.maxX)) + pad), y1 = Math.min(this.H, Math.max(...bs.map((b) => b.maxY)) + pad);
    return { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
  }
  /** The picture: declared in the manifest, no notices, the pointer out of the way, two quiet frames. */
  async shot(name: string, clip?: Clip): Promise<void> {
    expect(SHOTS[name], `"${name}" is declared in tests/shots/manifest.ts`).toBeDefined();
    const p = this.p;
    await p.evaluate(() => { for (const b of document.querySelectorAll<HTMLElement>(".notice-close")) b.click(); getSelection()?.removeAllRanges(); });
    if (!SHOTS[name]!.pointer) await p.mouse.move(this.W / 2, this.H - 6);
    await this.settle(400);
    mkdirSync(OUT, { recursive: true });
    await p.screenshot({ path: resolve(OUT, `${name}.png`), ...(clip ? { clip } : {}) });
  }
}

export const test = base.extend<{ scene: Scene }>({
  scene: async ({ app }, use) => {
    await app.page.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
    await use(new Scene(app));
  },
});
