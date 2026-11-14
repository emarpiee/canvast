import { describe, expect, it } from "vitest";
import { applySwitches, preparePrefs, themeIs, themeKeys, themeWanted } from "../../src/artcraft/photocraft/prefs";
import { browserKey } from "../../src/artcraft/photocraft/frame";
import { editableInPhotoCraft } from "../../src/artcraft/photocraft/app";
import { layerTree } from "../../src/artcraft/photocraft/layers";
import { withThemeOf } from "../../src/artcraft/photocraft/state";
import type { LayerNode } from "../../src/artcraft/photocraft/layers";
import type { CanvasObject } from "../../src/doc/model";
// @ts-expect-error (plain JavaScript, no types)
import { inlineGlue, pageParts } from "../../scripts/artcraft/photocraft/package.mjs";

describe("PhotoCraft's preferences as canvast leaves them", () => {
  it("a false switch hides, a true one shows, an unlisted id stays as the person left it", () => {
    expect(applySwitches(["a", "b"], { b: true, c: false })).toEqual(["a", "c"]);
    expect(applySwitches([], {})).toEqual([]);
  });

  it("the theme chosen survives PhotoCraft's own start (it sets Pro), the rest is what it wrote", () => {
    const chosen = JSON.stringify({ interface: { theme: "classic", uiScale: 1 } });
    const started = JSON.stringify({ interface: { theme: "pro", uiScale: 1.25 }, tools: { a: 1 } });
    expect(JSON.parse(withThemeOf(started, chosen))).toEqual({ interface: { theme: "classic", uiScale: 1.25 }, tools: { a: 1 } });
    expect(withThemeOf(started, "{}")).toBe(started);
  });

  it("its theme is given back by its own Window › Theme commands, each on a key no keyboard sends: a mode that follows the system sets both themes, then the mode", () => {
    const t = (i: Record<string, string>) => themeKeys(JSON.stringify({ interface: i }));
    expect(t({ appearanceMode: "dark", darkTheme: "solarizedDark", lightTheme: "classic" })).toEqual([{ command: "window.theme.solarizedDark", key: "F13" }]);
    expect(t({ appearanceMode: "light", darkTheme: "pro", lightTheme: "classic" })).toEqual([{ command: "window.theme.classic", key: "F13" }]);
    expect(t({ appearanceMode: "auto", darkTheme: "studio", lightTheme: "adwaita" }).map((k) => k.command)).toEqual(["window.theme.studio", "window.theme.adwaita", "window.theme.system"]);
    expect(themeKeys(null)).toEqual([]);
    expect(JSON.parse(preparePrefs(null, {}, {}, t({ appearanceMode: "dark", darkTheme: "studio" }))).shortcuts).toEqual({ "window.theme.studio": "F13" });
  });

  it("knows when its theme is the one chosen again: its mode and that mode's theme (its forced start keeps the light theme but switches to dark)", () => {
    const j = (i: Record<string, string>) => JSON.stringify({ interface: i });
    const wantLight = themeWanted(j({ appearanceMode: "light", darkTheme: "studio", lightTheme: "classic" }));
    expect(themeIs(j({ appearanceMode: "dark", darkTheme: "pro", lightTheme: "classic" }), wantLight)).toBe(false);
    expect(themeIs(j({ appearanceMode: "light", darkTheme: "pro", lightTheme: "classic" }), wantLight)).toBe(true);
    const wantDark = themeWanted(j({ appearanceMode: "dark", darkTheme: "solarizedDark" }));
    expect(themeIs(j({ appearanceMode: "dark", darkTheme: "pro" }), wantDark)).toBe(false);
    expect(themeIs(j({ appearanceMode: "dark", darkTheme: "solarizedDark" }), wantDark)).toBe(true);
  });

  it("keeps everything else, empties the recent files, and starts a new file at its current version", () => {
    const saved = JSON.stringify({ version: 2, interface: { theme: "pro" }, menus: { hidden: ["x"], colors: { y: "red" } }, fileHandling: { recentFiles: ["secret.png"], recentFileCount: 10 } });
    const p = JSON.parse(preparePrefs(saved, { "help.website": false }, { Sponge: false }));
    expect(p.interface).toEqual({ theme: "pro" });
    expect(p.menus).toEqual({ hidden: ["x", "help.website"], colors: { y: "red" } });
    expect(p.toolbar.hidden).toEqual(["Sponge"]);
    expect(p.fileHandling).toEqual({ recentFiles: [], recentFileCount: 10 });
    expect(JSON.parse(preparePrefs("not json", {}, {})).version).toBe(2);
  });
});

describe("PhotoCraft's released code as one inline module", () => {
  const snippet = "export function on() { return 1; }\nexport function off() { return 0; }\n";
  it("puts its snippets in front and its init on a global", () => {
    const glue = `import { on } from './snippets/x/inline0.js';\nimport * as import1 from "./snippets/x/inline0.js"\nasync function __wbg_init() {}\nexport { initSync, __wbg_init as default };\n`;
    const out: string = inlineGlue(glue, (p: string) => (p === "snippets/x/inline0.js" ? snippet : null));
    expect(out).toContain("const { on } = __photocraftSnippet0;");
    expect(out).toContain("const import1 = __photocraftSnippet0;");
    expect(out).toContain("globalThis.__photocraftInit = __wbg_init;");
    expect(out).not.toMatch(/^\s*(import|export)\b/m);
  });

  it("stops on what it does not recognise", () => {
    expect(() => inlineGlue("import x from './snippets/a.js';\nexport { initSync, __wbg_init as default };", () => snippet)).toThrow(/does not place/);
    expect(() => inlineGlue("export default 1;", () => null)).toThrow(/exports changed/);
    expect(() => pageParts("<style>a{}</style><body><canvas id=\"photocraft_canvas\"></canvas></body>")).toThrow(/photocraft_loading/);
  });
});

describe("PhotoCraft in canvast", () => {
  it("its shortcuts stay in it; copy, cut and paste keep the browser's way", () => {
    const k = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) => browserKey({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });
    expect([k("=", { ctrlKey: true }), k("-", { ctrlKey: true }), k("s", { metaKey: true }), k("F5"), k("ArrowLeft", { altKey: true })]).toEqual([true, true, true, true, true]);
    expect([k("c", { ctrlKey: true }), k("V", { ctrlKey: true }), k("x", { metaKey: true }), k("b"), k("Control", { ctrlKey: true })]).toEqual([false, false, false, false, false]);
  });

  it("opens art files by their kind, never videos or sounds", () => {
    expect(["a.psd", "b.KRA", "c.ora", "d.png", "e.cr2"].map((n) => editableInPhotoCraft(n))).toEqual([true, true, true, true, true]);
    expect([editableInPhotoCraft("f.mp4", "video/mp4"), editableInPhotoCraft("g.md"), editableInPhotoCraft("h.gif", "video/gif")]).toEqual([false, false, false]);
  });

  it("a sheet's objects as layer groups: the sheets on it and its groups, in paint order, bottom first", () => {
    const o = (id: string, z: number, more: Record<string, unknown> = {}): CanvasObject => ({ id, z, kind: "image", ...more }) as unknown as CanvasObject;
    const objs = [
      o("c", 4, { parent: "root", groups: ["g"], groupNames: { g: "Faces" } }),
      o("a", 1, { parent: "root" }),
      o("inner", 2, { kind: "path", container: { clip: true }, parent: "root" }),
      o("b", 3, { parent: "inner" }),
    ];
    const tree = layerTree(objs, (id) => objs.find((x) => x.id === id), "root", (x) => `name of ${x.id}`);
    const shape = (nodes: readonly LayerNode[]): unknown[] => nodes.map((n) => (n.kind === "layer" ? n.o.id : { [n.name]: shape(n.children) }));
    expect(shape(tree)).toEqual(["a", { "name of inner": ["inner", "b"] }, { Faces: ["c"] }]);
  });
});
