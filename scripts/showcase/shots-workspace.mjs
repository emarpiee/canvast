// The README's pictures of the workspace: the board and canvas menu (searched), Advanced export of chosen items, the Bookmarks panel, and
// the info bar with its technical readout. Boards and canvases of a made-up illustration project; public-domain artworks
// (scripts/showcase/art) in the library. Run from the repo root after `npm run build`:
//   node scripts/showcase/shots-workspace.mjs <unused> <outDir>
import { ART, artOf, artPath, open } from "./lib.mjs";

const [, out] = process.argv.slice(2);
const s = await open(out);
const { p, H, settle, shot, step, off, blur, place, fit, importFiles } = s;
const hashes = await importFiles(ART.map((a) => artPath(a.file)));
await p.getByTestId("view-canvas").click();
await settle();
const ws = (op, ...a) => H(([op, a]) => window.__canvastDebug.workspaceOp(op, ...a), [op, a]);
const tree = () => H(() => window.__canvastDebug.session().tree);

// A project of boards and canvases
await step("boards", async () => {
  const first = (await tree())[0];
  await ws("renameBoard", first.id, "Picture book");
  await ws("renameCanvas", first.canvases[0].id, "Cover");
  for (const c of ["Spread 1", "Spread 2", "Spread 3"]) {
    await ws("newCanvas", first.id);
    const b = (await tree())[0];
    await ws("renameCanvas", b.canvases[b.canvases.length - 1].id, c);
  }
  for (const [board, canvases] of [["Characters", ["The traveller", "The horse", "Turnarounds"]], ["Environments", ["Forest road", "Coast", "Mountains"]], ["References", ["Landscapes", "Prints", "Gesture"]]]) {
    await ws("newBoard");
    const t = await tree();
    const b = t[t.length - 1];
    await ws("renameBoard", b.id, board);
    await ws("renameCanvas", b.canvases[0].id, canvases[0]);
    for (const c of canvases.slice(1)) {
      await ws("newCanvas", b.id);
      const nb = (await tree()).find((x) => x.id === b.id);
      await ws("renameCanvas", nb.canvases[nb.canvases.length - 1].id, c);
    }
  }
});

// 1. The board and canvas menu, searched for "co": the canvases that match, with their boards
await step("switcher", async () => {
  await p.getByTestId("workspace-nav").click();
  await p.getByTestId("nav-find").fill("co");
  await p.getByTestId("workspace-menu").waitFor();
  await p.mouse.move(900, 600);
  await shot("switcher");
  await p.keyboard.press("Escape");
});

// 2. Bookmarks: places on a reference canvas, each with its picture
await step("bookmarks", async () => {
  await p.getByTestId("workspace-nav").click();
  await p.getByTestId("nav-find").fill("Landscapes");
  await p.getByTestId("workspace-menu").getByText("Landscapes", { exact: true }).click();
  if (await p.getByTestId("workspace-menu").isVisible()) await p.keyboard.press("Escape");
  await blur();
  const ids = await place(artOf("waterloo", "verhaecht", "leprince", "vangogh").map((f) => hashes[f]));
  await p.keyboard.press("Control+a");
  await s.menu("arrangemenu", "grid:name-asc");
  await fit();
  const panelBtn = p.getByRole("button", { name: "Bookmarks panel", exact: true });
  await panelBtn.click();
  for (const id of ids) {
    await H((x) => window.__canvastDebug.select(x), [id]);
    await p.keyboard.press("f");
    await settle(500);
    await p.getByRole("button", { name: "Add bookmark" }).click();
    await settle(400);
  }
  await p.keyboard.press("Escape");
  await fit();
  await off();
  await shot("bookmarks");
  await panelBtn.click();
});

// 3. The info bar, Technical: frame times, what is held in memory, how long the library took to open
await step("info-bar", async () => {
  await H(() => window.__canvastDebug.setSetting("ui.info", "technical"));
  await settle(1500);
  const v = await H(() => window.__canvastDebug.viewport());
  await shot("info-bar", { x: 0, y: v.height - 70, width: v.width, height: 70 });
  await H(() => window.__canvastDebug.setSetting("ui.info", "simple"));
});

// 4. Advanced export: a search, the items and folders ticked, and the size of what is chosen
await step("advanced-export", async () => {
  await p.getByTestId("save-status").click();
  await p.getByTestId("set-export-advanced").click();
  const dlg = p.getByTestId("advanced-export");
  for (const f of artOf("hokusai").slice(0, 3)) await dlg.locator(`[data-ax-item="${hashes[f]}"]`).check();
  await settle(300);
  await shot("advanced-export");
  await dlg.getByRole("button", { name: "Cancel" }).click();
});

await s.done();
