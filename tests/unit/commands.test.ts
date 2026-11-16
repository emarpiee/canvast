import { describe, expect, it } from "vitest";
import { CommandRegistry, findCommands, kindOf, parseQuery } from "../../src/commands/registry";
import { keysIn, shortTitle } from "../../src/commands/from-bars";
import { settingCommands } from "../../src/commands/settings-commands";
import type { Command } from "../../src/commands/types";
import { Macros } from "../../src/commands/macros";
import { answer } from "../../src/app/agent-link";

const c = (group: string, title: string, extra: Partial<Command> = {}): Command => ({ group, title, run: () => undefined, ...extra });

describe("the command registry (ADR 0129)", () => {
  it("hands out every provider's commands with an id, a kind and its source; a title another source gave first is left out; ids are unique", () => {
    const r = new CommandRegistry();
    r.setProvider("app", () => [c("Edit", "Undo"), c("Edit", "Redo"), c("Go to", "Canvas view")]);
    r.setProvider("bars", () => [c("Dock", "undo", { kind: "toolbar" }), c("Actions", "Group", { kind: "toolbar" }), c("Actions", "Group", { kind: "toolbar", id: "toolbar:group" })]);
    const all = r.all();
    expect(all.map((x) => x.title)).toEqual(["Undo", "Redo", "Canvas view", "Group", "Group"]); // (two of one source stay: it is the other sources that cannot repeat a name)
    expect(all[0]!.kinds).toEqual(["edit", "toolbar"]); // the bar's Undo is the same command, also found under @toolbar
    expect(all.map((x) => x.source)).toEqual(["app", "app", "app", "bars", "bars"]);
    expect(all.map((x) => x.kind)).toEqual(["edit", "edit", "go", "toolbar", "toolbar"]);
    expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
    expect(r.kinds()).toEqual([{ kind: "edit", count: 2 }, { kind: "go", count: 1 }, { kind: "toolbar", count: 3 }]);
    expect(findCommands(all, "@toolbar undo").map((x) => x.title)).toEqual(["Undo"]);
  });

  it("runs a command by id only when it can be done now, and a provider can be replaced (what a macro needs)", () => {
    const r = new CommandRegistry();
    const log: string[] = [];
    let on = false;
    r.setProvider("app", () => [c("Edit", "A", { id: "a", run: () => log.push("a") }), c("Edit", "B", { id: "b", enabled: () => on, run: () => log.push("b") })]);
    r.setProvider("macros", () => [c("Macro", "A then B", { id: "macro:ab", run: () => { r.run("a"); r.run("b"); } })]);
    expect(r.run("nope")).toBe(false);
    expect(r.run("b")).toBe(false);
    r.run("macro:ab");
    expect(log).toEqual(["a"]);
    on = true;
    r.run("macro:ab");
    expect(log).toEqual(["a", "a", "b"]);
    r.setProvider("macros", () => []);
    expect(r.get("macro:ab")).toBeUndefined();
  });
});

describe("@kind in the query", () => {
  const all = [c("Tool", "Select"), c("Setting", "Theme: Dark", { kind: "settings" }), c("Settings", "Appearance", { kind: "settings" }), c("Actions", "Group", { kind: "toolbar" }), c("Edit", "Group")];
  it("reads the kind, the words after it, and whether the kind is still being typed", () => {
    expect(parseQuery("zoom in")).toEqual({ kind: null, words: ["zoom", "in"], choosing: false });
    expect(parseQuery("@settings theme")).toEqual({ kind: "settings", words: ["theme"], choosing: false });
    expect(parseQuery("@set")).toEqual({ kind: "set", words: [], choosing: true });
    expect(parseQuery("@")).toEqual({ kind: "", words: [], choosing: true });
    expect(kindOf(c("Go to", "x"))).toBe("go");
  });
  it("narrows to a kind by its start, and the other words must still match", () => {
    expect(findCommands(all, "@settings").map((x) => x.title)).toEqual(["Theme: Dark", "Appearance"]);
    expect(findCommands(all, "@set dark").map((x) => x.title)).toEqual(["Theme: Dark"]);
    expect(findCommands(all, "@toolbar group").map((x) => x.title)).toEqual(["Group"]);
    expect(findCommands(all, "group")).toHaveLength(2);
    expect(findCommands(all, "@nothing")).toEqual([]);
  });
});

describe("commands made from the bars and the settings", () => {
  it("names a control by its short title and finds the key in its tooltip", () => {
    expect(shortTitle("Union: join the shapes into one")).toBe("Union");
    expect(shortTitle("Undo (Ctrl+Z)")).toBe("Undo");
    expect(shortTitle("Layers panel")).toBe("Layers");
    expect(keysIn("Undo (Ctrl+Z)")).toBe("Ctrl+Z");
    expect(keysIn("Zoom in (+)")).toBe("+");
    expect(keysIn("Download the original file (several files: one ZIP)")).toBeUndefined();
  });
  it("makes a command for a switch, for each choice of a menu (not the one now), and to open every row", () => {
    const values: Record<string, unknown> = { "ui.zen": false, "ui.theme": "light" };
    const store = { get: (k: string) => values[k], set: (k: string, v: unknown) => void (values[k] = v) } as never;
    const tabs = [{ id: "appearance", label: "Appearance", rows: [{ key: "ui.zen", label: "Zen mode", control: { kind: "toggle" } }, { key: "ui.theme", label: "Theme", control: { kind: "select", options: [["system", "System"], ["light", "Light"], ["dark", "Dark"]] as const } }] }];
    let opened = "";
    const cmds = settingCommands(tabs, store, (t) => (opened = t));
    expect(cmds.map((x) => x.title)).toEqual(["Toggle zen mode", "Zen mode", "Theme: System", "Theme: Light", "Theme: Dark", "Theme"]);
    void cmds[0]!.exec!({}, { caller: "test" });
    expect(values["ui.zen"]).toBe(true);
    expect(cmds.filter((x) => x.why && x.why() !== null).map((x) => x.title)).toEqual(["Theme: Light"]);
    void cmds.find((x) => x.title === "Theme: Dark")!.exec!({}, { caller: "test" });
    expect(values["ui.theme"]).toBe("dark");
    void cmds.find((x) => x.title === "Theme")!.exec!({}, { caller: "test" });
    expect(opened).toBe("appearance");
  });
});

describe("the command contract (ADR 0205)", () => {
  const mk = (): { r: CommandRegistry; log: string[] } => {
    const r = new CommandRegistry();
    const log: string[] = [];
    r.setProvider("app", () => [
      { id: "item.rename", title: "Rename", group: "Edit", hint: "Give it a new name", risk: "edit", options: [{ name: "name", type: "text", doc: "the new name", required: true }, { name: "size", type: "number", doc: "a size", min: 1, max: 10 }], exec: (o) => { log.push(`rename ${String(o["name"])}`); return { ok: true, changed: ["a"] }; } },
      { id: "item.delete", title: "Delete", group: "Edit", hint: "Remove it", risk: "confirm", exec: () => void log.push("delete") },
      { id: "hidden.password", title: "Change the password", group: "Hidden", hint: "A new password", risk: "refused", exec: () => void log.push("password") },
      { id: "item.broken", title: "Broken", group: "Edit", hint: "Fails", risk: "edit", exec: () => { throw new Error("boom"); } },
      { id: "item.off", title: "Off", group: "Edit", hint: "Cannot run", risk: "edit", why: () => "Nothing is selected.", exec: () => void log.push("off") },
      { id: "item.slow", title: "Slow", group: "Edit", hint: "Waits", risk: "read", exec: async () => ({ ok: true, value: 42 }) },
    ]);
    return { r, log };
  };

  it("runs by id with checked options, gives a result, and never throws", async () => {
    const { r, log } = mk();
    expect(await r.execute("item.rename", { name: "Moon" })).toEqual({ ok: true, changed: ["a"] });
    expect(log).toEqual(["rename Moon"]);
    expect((await r.execute("item.rename", {})).ok).toBe(false); // (a required option)
    expect((await r.execute("item.rename", { name: 3 })).ok).toBe(false); // (a wrong type)
    expect((await r.execute("item.rename", { name: "x", size: 99 })).ok).toBe(false); // (out of range)
    expect((await r.execute("item.rename", { name: "x", colour: "red" })).ok).toBe(false); // (an option it does not take)
    expect(await r.execute("item.broken")).toEqual({ ok: false, error: '"Broken" failed: boom' });
    expect(await r.execute("item.off")).toEqual({ ok: false, error: "Nothing is selected." });
    expect(await r.execute("item.slow")).toEqual({ ok: true, value: 42 });
    expect(log).toEqual(["rename Moon"]);
  });

  it("suggests close ids for an unknown one, and an old id still works through its alias", async () => {
    const { r } = mk();
    const miss = await r.execute("item.renam");
    expect(miss.ok).toBe(false);
    expect(!miss.ok && miss.suggest).toEqual(["item.rename"]);
    r.alias("edit:rename", "item.rename");
    expect((await r.execute("edit:rename", { name: "y" })).ok).toBe(true);
  });

  it("an outside caller cannot run a refused command, and its run of a risky one waits for the person", async () => {
    const { r, log } = mk();
    expect((await r.execute("hidden.password", {}, { caller: "agent" })).ok).toBe(false);
    expect((await r.execute("hidden.password", {}, { caller: "ui" })).ok).toBe(true); // (the person may)
    expect((await r.execute("item.delete", {}, { caller: "agent" })).ok).toBe(false); // (no one to ask: refused)
    let asked = 0;
    r.setConfirmer(async () => (asked++, false));
    expect((await r.execute("item.delete", {}, { caller: "agent" })).ok).toBe(false);
    r.setConfirmer(async () => (asked++, true));
    expect((await r.execute("item.delete", {}, { caller: "agent" })).ok).toBe(true);
    expect(asked).toBe(2);
    expect((await r.execute("item.delete", {}, { caller: "ui" })).ok).toBe(true); // (the person's own run asks in its own way)
    r.setProvider("asks", () => [{ id: "item.deleteAsks", title: "Delete, asking", group: "Edit", hint: "h", risk: "confirm", asks: true, exec: () => void log.push("asked itself") }]);
    expect((await r.execute("item.deleteAsks", {}, { caller: "agent" })).ok).toBe(true); // (its own dialog asks the person: not twice)
    expect(asked).toBe(2);
    log.pop();
    expect(asked).toBe(2);
    r.readOnlyCallers = true;
    expect((await r.execute("item.rename", { name: "z" }, { caller: "agent" })).ok).toBe(false);
    expect((await r.execute("item.slow", {}, { caller: "agent" })).ok).toBe(true);
    expect(log).toEqual(["password", "delete", "delete"]);
  });

  it("lists every command with its options, risk and why it cannot run; a batch stops at the first failure", async () => {
    const { r, log } = mk();
    const rows = r.list();
    expect(rows.find((x) => x.id === "item.off")).toMatchObject({ enabled: false, disabledReason: "Nothing is selected.", needsWorkspace: false, risk: "edit" });
    expect(rows.find((x) => x.id === "item.rename")!.options.map((o) => o.name)).toEqual(["name", "size"]);
    expect(r.list("delete").map((x) => x.id)).toEqual(["item.delete"]);
    const b = await r.batch([{ id: "item.rename", options: { name: "1" } }, { id: "item.off" }, { id: "item.rename", options: { name: "2" } }], { caller: "test" });
    expect(b).toMatchObject({ ok: false, completed: 1 });
    expect(log).toEqual(["rename 1"]);
    const b2 = await r.batch([{ id: "item.off" }, { id: "item.rename", options: { name: "3" } }], { caller: "test" }, false);
    expect(b2.completed).toBe(1);
  });

  it("a button's run is done when it returns; a failure is told", () => {
    const { r, log } = mk();
    const fails: string[] = [];
    r.onFail((_c, e) => fails.push(e));
    expect(r.press("item.rename", { name: "now" })).toBe(true);
    expect(log).toEqual(["rename now"]);
    expect(r.press("item.off")).toBe(false);
    r.press("item.broken");
    expect(fails).toEqual(['"Broken" failed: boom']);
  });

  it("a macro records what ran from anywhere but reads, and plays each step as a command of its own", async () => {
    const { r, log } = mk();
    const m = new Macros(r, () => undefined);
    await r.execute("macro.record");
    r.press("item.rename", { name: "A" }, "ui");
    await r.execute("item.slow"); // (a read: not recorded)
    await r.execute("item.delete", {}, { caller: "key" });
    await r.execute("macro.save", { name: "two" });
    expect(m.macros[0]!.steps).toEqual([{ id: "item.rename", options: { name: "A" } }, { id: "item.delete" }]);
    log.length = 0;
    expect(await m.play("two", "agent")).toBe(1); // (an outside caller's macro: the risky step is not allowed, no one was asked)
    expect(log).toEqual(["rename A"]);
  });
});

describe("the link to AI agents, the app's side (ADR 0205)", () => {
  it("answers list, run and batch as the agent's runs; read-only refuses all but reads; an unknown method says so", async () => {
    const r = new CommandRegistry();
    const log: string[] = [];
    r.setProvider("app", () => [
      { id: "a.read", title: "Read", group: "G", hint: "h", risk: "read", exec: () => ({ ok: true, value: 1 }) },
      { id: "a.edit", title: "Edit", group: "G", hint: "h", risk: "edit", exec: () => void log.push("edit") },
      { id: "a.pass", title: "Password", group: "G", hint: "h", risk: "refused", exec: () => void log.push("pass") },
    ]);
    expect(((await answer(r, "list", {}, false)) as Array<{ id: string }>).map((c) => c.id)).toEqual(["a.read", "a.edit", "a.pass"]);
    expect(await answer(r, "run", { id: "a.edit" }, false)).toEqual({ ok: true });
    expect(((await answer(r, "run", { id: "a.pass" }, false)) as { ok: boolean }).ok).toBe(false);
    expect(((await answer(r, "run", { id: "a.edit" }, true)) as { ok: boolean }).ok).toBe(false);
    expect(await answer(r, "run", { id: "a.read" }, true)).toEqual({ ok: true, value: 1 });
    expect(await answer(r, "batch", { steps: [{ id: "a.edit" }, { id: "a.edit" }] }, false)).toEqual({ ok: true, completed: 2 });
    // (short by default: only the steps that read something or failed, by their number; details: every step)
    expect(await answer(r, "batch", { steps: [{ id: "a.edit" }, { id: "a.read" }] }, false)).toEqual({ ok: true, completed: 2, results: [{ step: 1, ok: true, value: 1 }] });
    expect(((await answer(r, "batch", { steps: [{ id: "a.edit" }], details: true }, false)) as { results: unknown[] }).results).toEqual([{ ok: true }]);
    // what a run did to the items is told in its answer; a refused run tells nothing
    const watch = () => () => ({ made: ["n1"], changed: [], removed: ["o1"] });
    expect(await answer(r, "run", { id: "a.edit" }, false, watch)).toEqual({ ok: true, made: ["n1"], removed: ["o1"] });
    expect(await answer(r, "run", { id: "a.pass" }, false, watch)).not.toHaveProperty("made");
    await expect(answer(r, "drop", {}, false)).rejects.toThrow("no method");
    await expect(answer(r, "run", {}, false)).rejects.toThrow("id");
    expect(log).toEqual(["edit", "edit", "edit", "edit", "edit", "edit"]);
  });
});
