import { describe, expect, it } from "vitest";
import { applySwitches, preparePrefs } from "../../src/artcraft/photocraft/prefs";
// @ts-expect-error (plain JavaScript, no types)
import { inlineGlue, pageParts } from "../../scripts/artcraft/photocraft/package.mjs";

describe("PhotoCraft's preferences as canvast leaves them", () => {
  it("a false switch hides, a true one shows, an unlisted id stays as the person left it", () => {
    expect(applySwitches(["a", "b"], { b: true, c: false })).toEqual(["a", "c"]);
    expect(applySwitches([], {})).toEqual([]);
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
