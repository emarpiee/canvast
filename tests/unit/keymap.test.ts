import { describe, expect, it } from "vitest";
import { KEY_COMMANDS, Keymap, comboOfEvent, eventInit, judge, normalizeCombo, parseCombo } from "../../src/settings/keymap";
import { SettingsStore } from "../../src/settings/settings";

function memory(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), key: () => null, length: 0, clear: () => m.clear() } as unknown as Storage;
}
const ev = (key: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}, code = "") => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe("key combos (ADR 0158)", () => {
  it("are written the same however they are typed", () => {
    expect(["ctrl+shift+f", "Shift+Control+F", "cmd+shift+f"].map(normalizeCombo)).toEqual(["Ctrl+Shift+F", "Ctrl+Shift+F", "Ctrl+Shift+F"]);
    expect([normalizeCombo("alt+q"), normalizeCombo("f"), normalizeCombo("space"), normalizeCombo("left"), normalizeCombo("f5"), normalizeCombo("Ctrl++")]).toEqual(["Alt+Q", "F", "Space", "ArrowLeft", "F5", "Ctrl++"]);
    expect([normalizeCombo(""), normalizeCombo("Ctrl+"), normalizeCombo("Ctrl+Blah")]).toEqual([null, null, null]);
    expect(parseCombo("Shift+#")?.shift, "a shifted symbol is the symbol").toBe(false);
  });
  it("are read from a key event, and sent on as one", () => {
    expect([comboOfEvent(ev("z", { ctrlKey: true })), comboOfEvent(ev("Z", { ctrlKey: true, shiftKey: true })), comboOfEvent(ev(" ", { ctrlKey: true })), comboOfEvent(ev("#", { shiftKey: true })), comboOfEvent(ev("ArrowLeft", { altKey: true, shiftKey: true }))])
      .toEqual(["Ctrl+Z", "Ctrl+Shift+Z", "Ctrl+Space", "#", "Alt+Shift+ArrowLeft"]);
    expect(comboOfEvent(ev("å", { altKey: true }, "KeyA")), "Alt changes the letter on some systems: the key is meant").toBe("Alt+A");
    expect([comboOfEvent(ev("Shift", { shiftKey: true })), comboOfEvent(ev("Control", { ctrlKey: true }))]).toEqual([null, null]);
    expect(eventInit("Ctrl+Shift+Z")).toMatchObject({ key: "Z", code: "KeyZ", ctrlKey: true, shiftKey: true, altKey: false });
    expect(eventInit("Space")).toMatchObject({ key: " ", code: "Space" });
    expect(eventInit("P")).toMatchObject({ key: "p", shiftKey: false });
  });
});

describe("the commands", () => {
  it("each listen for a key of their own, and no two share one", () => {
    const seen = new Map<string, string>();
    for (const c of KEY_COMMANDS) for (const k of c.internal) {
      expect(seen.get(k), `${c.id} and ${seen.get(k)} both listen for ${k}`).toBeUndefined();
      seen.set(k, c.id);
    }
    const bound = new Map<string, string>();
    for (const c of KEY_COMMANDS) for (const k of c.defaults) {
      expect(bound.get(k), `${c.id} and ${bound.get(k)} are both bound to ${k}`).toBeUndefined();
      bound.set(k, c.id);
    }
  });
  it("start with F for the focus, not the Alt tap", () => {
    const km = new Keymap(new SettingsStore(null));
    expect(km.bindings("view.focus")).toEqual(["F"]);
    expect(km.resolve("F", "canvas")).toEqual({ kind: "to", combo: "Ctrl+Space" });
    expect(km.resolve("Ctrl+Space", "canvas"), "the old internal key is not a binding any more").toEqual({ kind: "swallow" });
  });
});

describe("the keymap", () => {
  it("passes a command's own keys through, and sends a rebound key on as the command's own", () => {
    const km = new Keymap(new SettingsStore(null));
    expect(km.resolve("Ctrl+Z", "canvas")).toEqual({ kind: "pass" });
    km.set("edit.undo", ["Ctrl+Shift+U"]);
    expect(km.resolve("Ctrl+Shift+U", "canvas")).toEqual({ kind: "to", combo: "Ctrl+Z" });
    expect(km.resolve("Ctrl+Z", "canvas"), "the old key is dropped").toEqual({ kind: "swallow" });
    expect(km.resolve("Ctrl+Shift+U", "none"), "nothing is changed while typing or capturing").toEqual({ kind: "pass" });
    km.reset("edit.undo");
    expect(km.resolve("Ctrl+Z", "canvas")).toEqual({ kind: "pass" });
  });
  it("keeps two keys for a command, and none when they are all taken away", () => {
    const km = new Keymap(new SettingsStore(null));
    expect(km.bindings("edit.redo")).toEqual(["Ctrl+Shift+Z", "Ctrl+Y"]);
    km.set("edit.redo", ["Ctrl+Y"]);
    expect(km.resolve("Ctrl+Shift+Z", "canvas")).toEqual({ kind: "swallow" });
    km.set("edit.redo", []);
    expect(km.resolve("Ctrl+Y", "canvas")).toEqual({ kind: "swallow" });
    expect(km.display("edit.redo")).toBe("");
  });
  it("tells who has a key, and works only for the views a command is for", () => {
    const km = new Keymap(new SettingsStore(null));
    expect(km.owners("Ctrl+Z").map((c) => c.id)).toEqual(["edit.undo"]);
    expect(km.owners("Ctrl+Z", "edit.undo")).toEqual([]);
    km.set("find.palette", ["Ctrl+P"]);
    expect(km.resolve("Ctrl+P", "global")).toEqual({ kind: "to", combo: "Ctrl+K" });
    expect(km.resolve("Ctrl+Z", "global"), "an editing key is not for the Assets view").toEqual({ kind: "pass" });
  });
  it("is kept in the device settings, and takes over the letters chosen before it existed", () => {
    const st = memory({ "canvast.settings": JSON.stringify({ "key.pen": "x", "key.navUp": "i" }) });
    const s = new SettingsStore(st);
    const km = new Keymap(s);
    expect([km.bindings("tool.pen"), km.bindings("nav.up"), km.bindings("tool.hand")]).toEqual([["X"], ["I"], ["H"]]);
    expect(s.get("key.pen"), "the old setting goes back to its default").toBe("p");
    km.set("edit.undo", ["Ctrl+U"]);
    expect(JSON.parse(String(s.get("keys.custom" as never)))).toMatchObject({ "edit.undo": ["Ctrl+U"], "tool.pen": ["X"] });
    expect(new Keymap(s).bindings("edit.undo")).toEqual(["Ctrl+U"]);
  });
});

describe("what to warn about", () => {
  it("refuses what cannot be used, warns about what may not arrive, and notes the rest", () => {
    expect(judge("Escape", "edit.undo").level).toBe("refuse");
    expect(judge("Ctrl+W", "edit.undo").level, "the browser keeps it").toBe("refuse");
    expect(judge("Ctrl+Space", "view.focus").level, "an input method may take it").toBe("warn");
    expect(judge("Ctrl+S", "edit.undo").level, "the browser's save").toBe("warn");
    expect(judge("Alt+Q", "tool.pen").level, "Alt and a letter can open a menu").toBe("warn");
    expect(judge("Ctrl+Alt+Q", "tool.pen").level, "AltGr").toBe("warn");
    expect(judge("Ctrl+I", "tool.pen").level, "italic while typing").toBe("note");
    expect(judge("F", "view.focus").level, "a bare key: not while typing").toBe("note");
    expect(judge("Ctrl+Shift+F", "find.library").level).toBe("ok");
    expect(judge("F8", "view.focus").level).toBe("ok");
  });
});
