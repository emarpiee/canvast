import { describe, expect, it } from "vitest";
import { CommandRegistry, findCommands, kindOf, parseQuery } from "../../src/commands/registry";
import { keysIn, shortTitle } from "../../src/commands/from-bars";
import { settingCommands } from "../../src/commands/settings-commands";
import type { Command } from "../../src/commands/types";

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
    cmds[0]!.run();
    expect(values["ui.zen"]).toBe(true);
    expect(cmds.filter((x) => x.enabled && !x.enabled()).map((x) => x.title)).toEqual(["Theme: Light"]);
    cmds.find((x) => x.title === "Theme: Dark")!.run();
    expect(values["ui.theme"]).toBe("dark");
    cmds.find((x) => x.title === "Theme")!.run();
    expect(opened).toBe("appearance");
  });
});
