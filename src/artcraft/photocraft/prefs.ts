/**
 * PhotoCraft's preferences as canvast leaves them before it starts (they are its own JSON, in the browser's storage under `PREFS_KEY`):
 * the switches' menu items and tools hidden or shown (PHOTOCRAFT_FEATURES), and no list of recent files. Everything else is the person's.
 */
export const PREFS_KEY = "photocraft.preferences";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** `hidden` with the switches applied: a `false` id in it, a `true` one out of it, the others as they were. */
export function applySwitches(hidden: readonly string[], switches: Readonly<Record<string, boolean>>): string[] {
  const out = hidden.filter((id) => switches[id] !== true);
  for (const [id, on] of Object.entries(switches)) if (!on && !out.includes(id)) out.push(id);
  return out;
}

/** The preferences text PhotoCraft finds when it starts, from what it saved last (null or unreadable: none yet). */
export function preparePrefs(saved: string | null, menus: Readonly<Record<string, boolean>>, tools: Readonly<Record<string, boolean>>, keys: ReadonlyArray<{ command: string; key: string }> = []): string {
  let p: Json = {};
  try {
    p = obj(saved ? JSON.parse(saved) : {});
  } catch {
    p = {};
  }
  const m = obj(p["menus"]);
  const t = obj(p["toolbar"]);
  const files = obj(p["fileHandling"]);
  return JSON.stringify({
    ...p,
    // (a file of its first version has an older default for one key: a new file is written as its current version)
    version: typeof p["version"] === "number" ? p["version"] : 2,
    menus: { ...m, hidden: applySwitches(strings(m["hidden"]), menus) },
    toolbar: { ...t, hidden: applySwitches(strings(t["hidden"]), tools) },
    fileHandling: { ...files, recentFiles: [] },
    ...(keys.length ? { shortcuts: { ...obj(p["shortcuts"]), ...Object.fromEntries(keys.map((k) => [k.command, k.key])) } } : {}),
  });
}

/**
 * Its web build starts in its Pro theme each time, over the theme chosen (its `apps/photocraft-web/src/web.rs`). The theme chosen is
 * then applied by its own Window › Theme commands, as a click on them would: each is given a key no keyboard of a person sends (F13…),
 * pressed once it runs (frame.ts), and taken out of what is kept (state.ts). In the order to press: a mode that follows the system sets
 * both its themes, then the mode.
 */
export function themeKeys(saved: string | null): Array<{ command: string; key: string }> {
  let i: Json = {};
  try {
    i = obj(obj(saved ? JSON.parse(saved) : {})["interface"]);
  } catch {
    return [];
  }
  const mode = typeof i["appearanceMode"] === "string" ? i["appearanceMode"] : null;
  const dark = typeof i["darkTheme"] === "string" ? i["darkTheme"] : null;
  const light = typeof i["lightTheme"] === "string" ? i["lightTheme"] : null;
  const commands = mode === "light" ? [light] : mode === "dark" ? [dark] : mode === "auto" ? [dark, light, "system"] : [typeof i["theme"] === "string" ? i["theme"] : null];
  return commands.filter((c): c is string => !!c && /^[a-zA-Z]+$/.test(c)).map((c, n) => ({ command: `window.theme.${c}`, key: `F${13 + n}` }));
}

/** The theme fields of the preferences kept (its mode and its dark and light themes), to see when it shows them again. */
export function themeWanted(saved: string | null): { mode?: string; dark?: string; light?: string } {
  try {
    const i = obj(obj(saved ? JSON.parse(saved) : {})["interface"]);
    const str = (k: string): string | undefined => (typeof i[k] === "string" ? (i[k] as string) : undefined);
    const mode = str("appearanceMode"), dark = str("darkTheme"), light = str("lightTheme");
    return { ...(mode ? { mode } : {}), ...(dark ? { dark } : {}), ...(light ? { light } : {}) };
  } catch {
    return {};
  }
}

/** Whether the preferences it saved show the theme `wanted`: its mode, and the theme of that mode (both when it follows the system). */
export function themeIs(saved: string | null, wanted: { mode?: string; dark?: string; light?: string }): boolean {
  if (!wanted.mode) return true; // (an older file with only its single theme: nothing more to check)
  const now = themeWanted(saved);
  if (now.mode !== wanted.mode) return false;
  const darkOk = !wanted.dark || now.dark === wanted.dark, lightOk = !wanted.light || now.light === wanted.light;
  return wanted.mode === "dark" ? darkOk : wanted.mode === "light" ? lightOk : darkOk && lightOk;
}
