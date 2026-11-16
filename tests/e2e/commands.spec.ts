import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./harness";
import type { App } from "./harness";
import { KEY_COMMANDS } from "../../src/settings/keymap";

/**
 * The live audit of the command rule (ADR 0205): every action of the app is a command an outside caller can run by id. It runs on every
 * `Tests` run. What was there before the rule is counted in scripts/lib/commands-todo.json (`live`); a count over it fails (a new action
 * that is not a command), and the counts only go down. The source is checked by `npm run check:commands`.
 *
 *   rule      every command has a fixed id, a hint, a risk and `exec` (commandRuleProblems)
 *   keys      every key of Settings > Shortcuts runs a command of the same id (a hold, as Space to pan, is a gesture and is not)
 *   options   a command given options it does not take, or of the wrong kind, says so and changes nothing; it never throws
 *   callers   an outside caller cannot run what only the person may, and its risky runs wait for the person
 *   screens   every button, menu row and switch shown on the canvas, in the Library and in Settings runs a command (`data-command`), or
 *             only changes what is shown (`data-view-state`), or opens a menu of commands (`aria-haspopup`)
 */
const TODO = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/lib/commands-todo.json"), "utf8")) as { live?: { rule?: number; keys?: number; screens?: Record<string, number> } };
const live = TODO.live ?? {};
/** Gestures held down, not actions (a key that is pressed and held while dragging). */
const GESTURES = new Set(["view.panHold", /* (a second key for the palette, find.palette) */ "find.slash"]);

const ruleProblems = (app: App) => app.page.evaluate(() => window.__canvastDebug.commandRuleProblems());
const ids = (app: App) => app.page.evaluate(() => window.__canvastDebug.commandList().map((c) => c.id));

/** The controls shown now that run no command: their names, for the report. */
async function bareControls(app: App): Promise<string[]> {
  return app.page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, [role=menuitem], [role=menuitemradio], [role=switch], input[type=checkbox]")) {
      if (!el.getClientRects().length || el.closest("[hidden], [inert], iframe")) continue;
      if (el.closest("[data-command], [data-view-state], [aria-haspopup]") || el.hasAttribute("aria-haspopup")) continue;
      const name = (el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
      out.push(`${el.dataset["testid"] ?? el.className.toString().split(" ")[0] ?? el.tagName}: ${name}`);
    }
    return out;
  });
}

test("every command follows the rule, but those made before it (fewer each time)", async ({ app }) => {
  const problems = await ruleProblems(app);
  const all = await ids(app);
  console.log(`commands: ${all.length}; not following the rule yet: ${problems.length}`);
  for (const p of problems) console.log(`  ${p.id} (${p.source}): needs ${p.missing.join(", ")}`);
  expect(problems.length, "a new command must follow the rule (ADR 0205); see the list above").toBeLessThanOrEqual(live.rule ?? 0);
  // (a fixed id given twice is numbered by the registry: that is a mistake)
  const fixed = new Set(all.filter((id) => !/^[a-z]+:[a-z0-9-]+$/.test(id)));
  expect(all.filter((id) => /-\d+$/.test(id) && fixed.has(id.replace(/-\d+$/, ""))), "no fixed id twice").toEqual([]);
  expect(app.consoleErrors).toEqual([]);
});

test("every key of Settings > Shortcuts runs the command of the same id", async ({ app }) => {
  const have = new Set(await ids(app));
  const missing = KEY_COMMANDS.filter((k) => !GESTURES.has(k.id) && !have.has(k.id)).map((k) => `${k.id} (${k.name})`);
  console.log(`keys without a command: ${missing.length}`);
  for (const m of missing) console.log(`  ${m}`);
  expect(missing.length, "a new key must run a command").toBeLessThanOrEqual(live.keys ?? 0);
});

test("a command given wrong options says so and changes nothing; an outside caller cannot do what only the person may", async ({ app }) => {
  const p = app.page;
  // something on the canvas, selected, so that most commands can run
  await p.evaluate(() => window.__canvastDebug.runCommand("tool.shape"));
  await app.drag({ x: 500, y: 300 }, { x: 640, y: 420 });
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.selection().length)).toBe(1);
  const before = await p.evaluate(() => JSON.stringify(window.__canvastDebug.objects()));
  const report = await p.evaluate(async () => {
    const d = window.__canvastDebug;
    const bad: string[] = [];
    for (const c of d.commandList()) {
      const tries: Array<Record<string, unknown>> = [{ __none: 1 }];
      for (const o of c.options) tries.push({ [o.name]: o.type === "number" ? "x" : o.type === "boolean" || o.type === "ids" ? 7 : o.type === "choice" ? "__none" : { not: "text" } });
      for (const t of tries) {
        try {
          const r = await d.runCommand(c.id, t, "test");
          if (r.ok) bad.push(`${c.id} took ${JSON.stringify(t)}`);
        } catch (e) {
          bad.push(`${c.id} threw ${(e as Error).message}`);
        }
      }
    }
    return bad;
  });
  expect(report, "every command refuses options that do not fit").toEqual([]);
  expect(await p.evaluate(() => JSON.stringify(window.__canvastDebug.objects())), "and nothing changed").toBe(before);
  // an outside caller: a risky command asks the person first, in canvast; Cancel refuses it, Allow does it
  const ask = (): Promise<{ ok: boolean }> => p.evaluate(() => window.__canvastDebug.runCommand("edit.delete", {}, "agent"));
  const refused = ask();
  const dialog = p.getByRole("dialog").filter({ hasText: "An AI agent wants to" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect((await refused).ok).toBe(false);
  expect(await p.evaluate(() => window.__canvastDebug.objects().length)).toBe(1);
  const allowed = ask();
  await dialog.getByRole("button", { name: "Allow" }).click();
  expect((await allowed).ok).toBe(true);
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.objects().length)).toBe(0);
  // only the person may: an agent never changes the agents' own settings, whatever it asks
  const own = await p.evaluate(() => window.__canvastDebug.runCommand("settings.set", { key: "agents.readOnly", value: false }, "agent"));
  expect(own.ok).toBe(false);
  const unknown = await p.evaluate(() => window.__canvastDebug.runCommand("edit.undoo", {}, "agent"));
  expect(unknown.ok === false && unknown.suggest).toContain("edit.undo");
  expect(app.consoleErrors).toEqual([]);
});

test("every control on the canvas, in the Library and in Settings runs a command, but those made before the rule (fewer each time)", async ({ app }) => {
  const p = app.page;
  const counts: Record<string, number> = {};
  const look = async (view: string): Promise<void> => {
    // (a view draws some of its parts after it opens: counted once the count holds for three looks in a row)
    let bare = await bareControls(app);
    for (let same = 0, tries = 0; same < 2 && tries < 40; tries++) {
      await p.waitForTimeout(250);
      const again = await bareControls(app);
      same = again.length === bare.length ? same + 1 : 0;
      bare = again;
    }
    counts[view] = bare.length;
    console.log(`${view}: ${bare.length} controls without a command`);
    for (const b of bare) console.log(`  ${b}`);
  };
  await p.evaluate(() => window.__canvastDebug.runCommand("tool.shape"));
  await app.drag({ x: 500, y: 300 }, { x: 640, y: 420 });
  await expect.poll(() => p.evaluate(() => window.__canvastDebug.selection().length)).toBe(1);
  await look("canvas");
  await p.getByTestId("view-assets").click();
  await expect(p.locator("body")).toHaveAttribute("data-view", "assets");
  await look("library");
  await p.getByTestId("view-settings").click();
  await expect(p.locator("body")).toHaveAttribute("data-view", "settings");
  await look("settings");
  for (const [view, n] of Object.entries(counts)) expect(n, `${view}: a new control must run a command (ADR 0205)`).toBeLessThanOrEqual(live.screens?.[view] ?? 0);
});
