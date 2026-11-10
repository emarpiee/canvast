// README pictures of the desktop app (Electron, from dist-desktop/ of `npm run build:desktop`): a project kept as a plain folder, the
// Trash of that folder, the window's own row with the frame off, and sharing the workspace with a tablet on the same network (manifest.ts).
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { artFiles, OUT } from "./scene";
import { SHOTS } from "./manifest";

const ART_DIR = resolve("scripts/showcase/art");
test.describe.configure({ mode: "serial" });

let app: ElectronApplication;
let p: Page;
let ws: string;
let root: string;

const settle = async (ms = 500): Promise<void> => {
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  await p.waitForTimeout(ms);
  await p.evaluate(() => window.__canvastDebug.nextFrame());
};
const shot = async (name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> => {
  expect(SHOTS[name], `"${name}" is declared in tests/shots/manifest.ts`).toBeDefined();
  await p.evaluate(() => { for (const b of document.querySelectorAll<HTMLElement>(".notice-close")) b.click(); });
  await settle(400);
  mkdirSync(OUT, { recursive: true });
  await p.screenshot({ path: resolve(OUT, `${name}.png`), ...(clip ? { clip } : {}) });
};

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "cv-desk-"));
  // (a short, neutral path: the menu shows it in full)
  ws = join(tmpdir(), "Picture book");
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(ws);
  // (the window frame off: its row is one of the pictures)
  mkdirSync(join(root, "data"), { recursive: true });
  writeFileSync(join(root, "data", "window.json"), JSON.stringify({ frame: "off" }));
  app = await electron.launch({ args: [resolve("dist-desktop"), `--workspace=${ws}`, `--user-data-dir=${join(root, "data")}`], env: { ...process.env, CANVAST_HIDDEN: "1", CANVAST_HASH: "#debug" } });
  p = await app.firstWindow();
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 60_000 });
  await p.emulateMedia({ colorScheme: "dark" });
  await p.addStyleTag({ content: ".hud-dev,.hud-debug{display:none!important}" });
  await p.evaluate(() => { const s = window.__canvastDebug.setSetting; s("ui.names", "off"); s("ui.hue", 30); s("snap.grid", false); });
  // the project's references, into the folder's library and onto its cover canvas
  await p.getByTestId("view-assets").click();
  await p.getByTestId("assets-import-input").setInputFiles(artFiles("hokusai-under", "hokusai-seaside", "leprince", "verhaecht").map((f) => resolve(ART_DIR, f)));
  await expect.poll(() => p.evaluate(async () => (await window.__canvastDebug.catalogEntries()).length), { timeout: 60_000 }).toBeGreaterThanOrEqual(4);
  const hashes = await p.evaluate(async () => ((await window.__canvastDebug.catalogEntries()) as unknown as Array<{ hash: string }>).map((e) => e.hash));
  await p.getByTestId("view-canvas").click();
  for (const h of hashes) await p.evaluate((x) => window.__canvastDebug.placeFromLibrary(x), h);
  await p.evaluate(() => window.__canvastDebug.select(window.__canvastDebug.objects().map((o: { id: string }) => o.id)));
  await p.locator('[data-ctx="arrangemenu"]').click();
  await p.locator('.pop-menu [data-id="grid:name-asc"]').click();
  await p.keyboard.press("Escape");
  await p.evaluate(() => window.__canvastDebug.select([]));
  await p.keyboard.press("Control+a");
  await p.locator('[data-action="fit-selection"]').click();
  await p.keyboard.press("Escape");
  // (the project's board and canvas named as such work is)
  const tree = (await p.evaluate(() => window.__canvastDebug.session().tree))!;
  await p.evaluate(([b, c]) => Promise.all([window.__canvastDebug.workspaceOp("renameBoard", b!, "Picture book"), window.__canvastDebug.workspaceOp("renameCanvas", c!, "References")]), [tree[0]!.id, tree[0]!.canvases[0]!.id]);
  await p.evaluate(() => window.__canvastDebug.flushStorage());
  await settle(800);
});

test.afterAll(async () => {
  await app?.close();
  rmSync(ws, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

test("desktop", async () => {
  await p.getByTestId("workspace-nav").click();
  await p.getByTestId("nav-switch-workspace").click();
  await p.mouse.move(1000, 700);
  await settle();
  await shot("desktop");
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
});

test("trash", async () => {
  // (files deleted earlier, kept in the folder's .trash as the app keeps them)
  mkdirSync(join(ws, ".trash", "library", "images"), { recursive: true });
  for (const f of artFiles("waterloo", "delany", "degheyn")) copyFileSync(resolve(ART_DIR, f), join(ws, ".trash", "library", "images", f));
  await p.getByTestId("view-assets").click();
  await p.locator('[data-scope="trash"]').click();
  await p.getByTestId("trash-card").first().click();
  await p.mouse.move(700, 880);
  await settle(800);
  await shot("trash");
  await p.getByTestId("view-canvas").click();
});

test("sharing", async () => {
  await p.mouse.move(700, 500);
  await p.getByTestId("view-settings").click();
  await p.getByRole("tab", { name: "Sharing" }).click();
  await settle();
  await shot("sharing");
});
