import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";
import { APP_URL, expect, openActions, rowAction, test } from "./harness";
import { makePng } from "./png";

/**
 * Phase 1 storage foundation: Workspace → Boards → Canvas, per-object
 * incremental commits, v1 migration, multi-tab safety and save states.
 */

const BLANK = pathToFileURL(resolve("tests/e2e/fixtures/blank.html")).href;

type Sess = Awaited<ReturnType<Window["__canvastDebug"]["session"]>>;
const sess = (p: Page): Promise<Sess> => p.evaluate(() => window.__canvastDebug.session());
const objectIds = (p: Page): Promise<string[]> => p.evaluate(() => window.__canvastDebug.objects().map((o) => o.id).sort());

async function openApp(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(APP_URL);
  await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await page.evaluate(() => window.__canvastDebug.nextFrame());
  return page;
}

async function draw(p: Page, pts: Array<[number, number]>): Promise<void> {
  await p.keyboard.press("p");
  await p.mouse.move(pts[0]![0], pts[0]![1]);
  await p.mouse.down();
  for (const [x, y] of pts.slice(1)) await p.mouse.move(x, y, { steps: 4 });
  await p.mouse.up();
  await p.evaluate(() => window.__canvastDebug.nextFrame());
}

async function saved(p: Page): Promise<void> {
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.saveStatus()), { timeout: 5000 }).toBe("verified");
}

async function openMenu(p: Page): Promise<void> {
  if (await p.getByTestId("workspace-menu").isHidden()) await p.getByTestId("workspace-nav").click();
}

test("a fresh start creates a workspace, and saves write only the changed objects", async ({ app }) => {
  const p = app.page;
  const s0 = await sess(p);
  expect(s0.startup).toBe("created");
  expect(s0.tree).toHaveLength(1);
  expect(s0.tree![0]!.canvases).toHaveLength(1);
  await expect(p.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 1");

  for (let i = 0; i < 3; i++) await draw(p, [[300 + i * 150, 300], [380 + i * 150, 360]]);
  await expect(p.getByTestId("save-status")).not.toHaveText("Saved"); // queued or saving first
  await saved(p);
  await expect(p.getByTestId("save-status")).toHaveText("Saved");
  const canvasId = s0.current!.canvasId;
  expect(await p.evaluate((c) => window.__canvastDebug.storedObjectIds(c), canvasId)).toEqual(await objectIds(p));

  // Moving one object writes exactly one record, in exactly one commit.
  // (Edits made within the 150 ms debounce share a commit, so the revision
  // counts commits, not edits.)
  const r0 = (await sess(p)).revision;
  await p.keyboard.press("v");
  await p.mouse.click(340, 330); // (only a picked object moves)
  await app.drag({ x: 340, y: 330 }, { x: 360, y: 450 });
  await saved(p);
  let s = await sess(p);
  expect(s.lastCommit).toEqual({ puts: 1, deletes: 0, revision: r0 + 1 });
  // Deleting one object deletes exactly one record.
  await p.keyboard.press("Delete");
  await saved(p);
  s = await sess(p);
  expect(s.lastCommit).toMatchObject({ puts: 0, deletes: 1 });
  expect(await p.evaluate((c) => window.__canvastDebug.storedObjectIds(c), canvasId)).toEqual(await objectIds(p));
  expect(s.revision).toBe(r0 + 2);
});

test("boards and canvases: create, rename, switch; each canvas keeps its own objects and camera across reloads", async ({ app }) => {
  const p = app.page;
  await draw(p, [[300, 300], [400, 350]]);
  const canvas1Objects = await objectIds(p);
  await saved(p);

  // New canvas in Board 1.
  await openMenu(p);
  await p.getByRole("button", { name: /^\+ New canvas/ }).click();
  await expect(p.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 2");
  expect(await objectIds(p)).toEqual([]);
  await draw(p, [[600, 400], [700, 450]]);
  const canvas2Objects = await objectIds(p);
  await p.getByTestId("zoom-readout").click();
  await p.getByTestId("zoom-input").fill("5");
  await p.getByTestId("zoom-input").press("Enter");
  await saved(p);

  // Back to Canvas 1: its own objects and its own (home) camera.
  await openMenu(p);
  await p.getByRole("menuitemradio", { name: /Canvas 1/ }).click();
  await expect(p.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 1");
  expect(await objectIds(p)).toEqual(canvas1Objects);
  expect((await app.camera()).zi).toBe(0);

  // Canvas 2 again: objects and camera restored.
  await openMenu(p);
  await p.getByRole("menuitemradio", { name: /Canvas 2/ }).click();
  await expect(p.getByTestId("workspace-nav")).toHaveText("Board 1 › Canvas 2");
  expect(await objectIds(p)).toEqual(canvas2Objects);
  expect((await app.camera()).zi).toBe(5);

  // Rename the canvas, then add Board 2.
  await openMenu(p);
  await rowAction(p, "canvas", "Canvas 2", "Rename");
  await p.getByLabel("New canvas name").fill("Sketches");
  await p.getByLabel("New canvas name").press("Enter");
  await expect(p.getByTestId("workspace-nav")).toHaveText("Board 1 › Sketches");
  await p.getByRole("button", { name: /^\+ New board/ }).click();
  await expect(p.getByTestId("workspace-nav")).toHaveText("Board 2 › Canvas 1");
  await draw(p, [[500, 500], [520, 560]]);
  const board2Objects = await objectIds(p);
  await saved(p);
  await p.evaluate(() => window.__canvastDebug.flushSave());

  // Reload: the last active canvas comes back, and every canvas kept its content.
  await p.reload();
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await expect(p.getByTestId("workspace-nav")).toHaveText("Board 2 › Canvas 1");
  expect(await objectIds(p)).toEqual(board2Objects);
  const tree = (await sess(p)).tree!;
  expect(tree.map((b) => b.name)).toEqual(["Board 1", "Board 2"]);
  expect(tree[0]!.canvases.map((c) => [c.name, c.objectCount])).toEqual([
    ["Canvas 1", 1],
    ["Sketches", 1],
  ]);
  await openMenu(p);
  await p.getByRole("menuitemradio", { name: /Sketches/ }).click();
  await expect(p.getByTestId("workspace-nav")).toHaveText("Board 1 › Sketches");
  expect(await objectIds(p)).toEqual(canvas2Objects);
  expect((await app.camera()).zi).toBe(5);
});

test("v1 snapshot data is migrated, verified, and the legacy store is left untouched", async ({ page }) => {
  const stroke = (id: string, x: number) => ({
    id,
    kind: "stroke",
    ax: `${x}p0`,
    ay: "0p0",
    unit: 0,
    z: x,
    opacity: 1,
    attachmentTargetId: null,
    points: [0, 0, 40, 10, 80, -5],
    width: 3,
    color: "#2563eb",
  });
  const legacy = {
    schema: 1,
    app: "canvast",
    savedAt: 1,
    revision: 7,
    objects: [stroke("a".repeat(32), 100), stroke("b".repeat(32), 200), { ...stroke("c".repeat(32), 300), width: -1 }],
  };
  const camera = { cx: "75p1", cy: "0p0", zi: 1, zf: 0.5, pz: 1 }; // canonical dyadic form (150 = 75·2^1)
  // Seed a genuine schema-1 database from a page on the same file:// origin.
  await page.goto(BLANK);
  await page.evaluate(
    ([snap, cam]) =>
      new Promise<void>((resolveSeed, reject) => {
        const r = indexedDB.open("canvast", 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore("snapshots");
          r.result.createObjectStore("assets");
        };
        r.onsuccess = () => {
          const tx = r.result.transaction("snapshots", "readwrite");
          tx.objectStore("snapshots").put(snap, "main");
          tx.objectStore("snapshots").put(cam, "camera");
          tx.oncomplete = () => {
            r.result.close();
            resolveSeed();
          };
          tx.onerror = () => reject(tx.error);
        };
        r.onerror = () => reject(r.error);
      }),
    [legacy, camera] as const,
  );

  await page.goto(APP_URL);
  await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  const s = await sess(page);
  expect(s.startup).toBe("migrated");
  expect(s.migration).toMatchObject({ from: 1, to: 2, sourceObjects: 3, copied: 2, verified: true });
  expect((s.migration as { skipped: string[] }).skipped).toHaveLength(1);
  expect(await objectIds(page)).toEqual(["a".repeat(32), "b".repeat(32)]);
  expect(await page.evaluate(() => window.__canvastDebug.camera())).toEqual(camera);
  await expect(page.getByTestId("toast")).toContainText("Upgraded your canvas");

  // The legacy record is byte-for-byte what was seeded.
  const after = await page.evaluate(
    () =>
      new Promise<unknown>((resolveRead) => {
        const r = indexedDB.open("canvast");
        r.onsuccess = () => {
          const g = r.result.transaction("snapshots").objectStore("snapshots").get("main");
          g.onsuccess = () => {
            resolveRead(g.result);
            r.result.close();
          };
        };
      }),
  );
  expect(after).toEqual(legacy);

  // A second start does not migrate again.
  await page.reload();
  await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  expect((await sess(page)).startup).toBe("existing");
  expect(await objectIds(page)).toEqual(["a".repeat(32), "b".repeat(32)]);
});

test("two tabs: the second is read-only, follows the writer, and can take over", async ({ app, context }) => {
  const p1 = app.page;
  const p2 = await openApp(context);
  const s1 = await sess(p1);
  const s2 = await sess(p2);
  expect(s1.readOnly).toBe(false);
  expect(s2.readOnly).toBe(true);
  await expect(p2.getByTestId("readonly-banner")).toBeVisible();
  await expect(p1.getByTestId("readonly-banner")).toBeHidden();

  // The read-only tab cannot edit.
  await draw(p2, [[300, 300], [400, 400]]);
  expect(await objectIds(p2)).toEqual([]);
  await expect(p2.getByTestId("toast")).toContainText("Read-only");

  // The writer's edits reach the read-only tab.
  await draw(p1, [[500, 300], [600, 350]]);
  await saved(p1);
  await expect.poll(() => objectIds(p2), { timeout: 5000 }).toEqual(await objectIds(p1));

  // Take over: roles swap.
  await p2.getByRole("button", { name: "Take over" }).click();
  await expect.poll(async () => (await sess(p2)).readOnly).toBe(false);
  await expect.poll(async () => (await sess(p1)).readOnly).toBe(true);
  await expect(p1.getByTestId("readonly-banner")).toBeVisible();
  await draw(p2, [[300, 500], [350, 560]]);
  await saved(p2);
  await expect.poll(() => objectIds(p1), { timeout: 5000 }).toEqual(await objectIds(p2));
  expect(await objectIds(p2)).toHaveLength(2);

  // Closing the writer promotes the remaining tab.
  await p2.close();
  await expect.poll(async () => (await sess(p1)).readOnly, { timeout: 10000 }).toBe(false);
  await expect(p1.getByTestId("readonly-banner")).toBeHidden();
});

test("a commit against a stale revision is rejected and reported, never overwriting newer data", async ({ app }) => {
  const p = app.page;
  await draw(p, [[300, 300], [400, 350]]);
  await saved(p);
  const { current } = await sess(p);
  // Another writer (simulated directly in storage) moves the canvas revision on.
  await p.evaluate(
    (canvasId) =>
      new Promise<void>((done) => {
        const r = indexedDB.open("canvast");
        r.onsuccess = () => {
          const tx = r.result.transaction("canvases", "readwrite");
          const st = tx.objectStore("canvases");
          const g = st.get(canvasId);
          g.onsuccess = () => st.put({ ...g.result, revision: g.result.revision + 10 });
          tx.oncomplete = () => {
            r.result.close();
            done();
          };
        };
      }),
    current!.canvasId,
  );
  const stored = await p.evaluate((c) => window.__canvastDebug.storedObjectIds(c), current!.canvasId);
  await draw(p, [[500, 500], [600, 520]]);
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.saveStatus()), { timeout: 5000 }).toBe("conflict");
  await expect(p.getByTestId("save-status")).toContainText("changed in another tab");
  expect(await p.evaluate((c) => window.__canvastDebug.storedObjectIds(c), current!.canvasId)).toEqual(stored);
});

test("pressing the save indicator opens Settings > Storage: space, library folder, saving and backup status", async ({ app }) => {
  const p = app.page;
  await draw(p, [[300, 300], [400, 350]]);
  await saved(p);
  await p.getByTestId("save-status").click();
  await expect(p.getByTestId("storage-save-state")).toHaveText("verified");
  await expect(p.getByTestId("storage-role")).toContainText("editing (writer)");
  await expect(p.getByTestId("set-last-backup")).toContainText("No backup made yet");
  await expect(p.locator("[data-storage]")).toContainText("Browser storage is not a backup");
  await expect(p.locator("[data-used]")).not.toHaveText("…");
  await expect(p.getByTestId("storage-folder")).toBeVisible();
});

test("two tabs without Web Locks: the localStorage heartbeat lease keeps one writer", async ({ browser }) => {
  const context = await browser.newContext();
  // Simulate a browser without the Web Locks API.
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "locks", { value: undefined, configurable: true }));
  const p1 = await openApp(context);
  const p2 = await openApp(context);
  expect((await sess(p1)).lease).toBe("local-heartbeat");
  expect((await sess(p1)).readOnly).toBe(false);
  expect((await sess(p2)).readOnly).toBe(true);
  await draw(p2, [[300, 300], [400, 400]]);
  expect(await objectIds(p2)).toEqual([]);

  await p2.getByRole("button", { name: "Take over" }).click();
  await expect.poll(async () => (await sess(p2)).readOnly).toBe(false);
  // The old writer notices on its next heartbeat (≤ 1 s).
  await expect.poll(async () => (await sess(p1)).readOnly, { timeout: 5000 }).toBe(true);

  // When the writer closes, the read-only tab is promoted once the lease expires (≤ 4 s + 1 s poll).
  await p2.close();
  await expect.poll(async () => (await sess(p1)).readOnly, { timeout: 10000 }).toBe(false);
  await context.close();
});

test("a full browser store refuses an import in plain words and loses nothing", async ({ app }) => {
  await app.page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...a: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "assets") throw new DOMException("full", "QuotaExceededError");
      return put.apply(this, a);
    };
  });
  const buffer = makePng(8, 8, () => [200, 30, 30, 255]);
  await app.page.getByTestId("import-input").setInputFiles({ name: "full.png", mimeType: "image/png", buffer });
  await expect(app.page.getByTestId("toast")).toContainText("storage is full");
  expect(await app.page.evaluate(() => window.__canvastDebug.objects().length)).toBe(0);
});

test("Start from scratch: a warning with what to do first, a word to type, then everything of canvast is gone and other pages' storage is not", async ({ app }) => {
  const p = app.page;
  await draw(p, [[300, 300], [400, 350]]);
  await saved(p);
  await p.evaluate(() => localStorage.setItem("other-page", "keep"));
  await p.getByTestId("save-status").click();
  await p.getByTestId("reset-all").click();
  const dlg = p.getByTestId("reset-dialog");
  await expect(dlg).toContainText("cannot be undone");
  await expect(dlg).toContainText("Last backup: never");
  await expect(dlg).toContainText("also keep your settings");
  await expect(dlg.locator('input[type="checkbox"]')).toHaveCount(0); // (nothing on the disk can be ticked for deletion)
  await expect(dlg.getByRole("button", { name: "Export a backup (.canvast)" })).toBeVisible();
  await expect(p.getByTestId("reset-ok")).toBeDisabled();
  const [dl] = await Promise.all([p.waitForEvent("download"), dlg.getByRole("button", { name: "Export a backup (.canvast)" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.canvast$/);
  await expect(dlg.locator('[data-done="full"]')).toHaveText("Done ✓");
  // Cancel keeps everything.
  await p.getByTestId("reset-cancel").click();
  expect((await objectIds(p)).length).toBe(1);
  // Typing the word enables the button; deleting reloads into a fresh start.
  await p.getByTestId("reset-all").click();
  await p.getByTestId("reset-word").fill("delete");
  await expect(p.getByTestId("reset-ok")).toBeDisabled(); // (the word is DELETE)
  await p.getByTestId("reset-word").fill("DELETE");
  await Promise.all([p.waitForEvent("load"), p.getByTestId("reset-ok").click()]);
  await p.waitForFunction(() => typeof window.__canvastDebug !== "undefined");
  await p.evaluate(() => window.__canvastDebug.nextFrame());
  expect((await objectIds(p)).length).toBe(0);
  expect(await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("canvast") && k !== "canvast-writer-lease"))).toEqual([]);
  expect(await p.evaluate(() => localStorage.getItem("other-page"))).toBe("keep");
  await expect(p.getByTestId("set-last-backup")).toBeHidden(); // (Settings is closed again)
});

test("a progress notice stays while work goes on (past the time a plain notice lasts), shows its bar and stage, and ends with its result", async ({ app }) => {
  const p = app.page;
  await p.evaluate(() => window.__canvastDebug.testProgress("begin", "Exporting the backup"));
  await p.evaluate(() => window.__canvastDebug.testProgress("update", 0.5, "reading the library (5 of 10)"));
  const notice = p.getByTestId("toast").locator(".notice.is-progress");
  await expect(notice).toContainText("Exporting the backup: reading the library (5 of 10) 50%");
  await expect(notice.locator(".notice-bar span")).toHaveCSS("width", /^\d/);
  await p.waitForTimeout(4800); // (a plain progress notice closed after 4 s)
  await expect(notice).toBeVisible();
  await p.evaluate(() => window.__canvastDebug.testProgress("update", null, "checking the archive"));
  await expect(notice.locator(".notice-bar.is-unknown")).toBeVisible(); // (work of unknown length moves without a number)
  await p.evaluate(() => window.__canvastDebug.testProgress("done", "Exported a.canvast"));
  await expect(notice).toHaveCount(0);
  await expect(p.getByTestId("toast").locator(".notice.is-success")).toContainText("Exported a.canvast");
});
