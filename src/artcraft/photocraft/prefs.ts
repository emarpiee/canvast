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
export function preparePrefs(saved: string | null, menus: Readonly<Record<string, boolean>>, tools: Readonly<Record<string, boolean>>): string {
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
  });
}
