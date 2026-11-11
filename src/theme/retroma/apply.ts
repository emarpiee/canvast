// Retroma on the page: its settings (Retroma's defaults with what the person changed over them), worked out by the engine and written
// on :root as custom properties named --rt-* and switches named data-rt-*. Legacy, the app's earlier look, is the stylesheet alone:
// switching to it takes every one of them off again.
import { BASE, clone, computeRetroma, type RetromaOutput } from "./engine";
import { installRetromaFonts } from "../fonts";

/** Retroma's settings: its defaults, and over them what was changed (kept as JSON, only what differs). Nested groups merge one level down. */
export function retromaSettings(changedJson: string): Record<string, unknown> {
  const s = clone(BASE) as Record<string, unknown>;
  let changed: Record<string, unknown> = {};
  try {
    const v = JSON.parse(changedJson || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) changed = v as Record<string, unknown>;
  } catch {
    // (a broken value is no change)
  }
  for (const [k, v] of Object.entries(changed)) {
    if (!(k in s) && k !== "hex" && k !== "preset") continue;
    const base = s[k];
    s[k] = base && typeof base === "object" && !Array.isArray(base) && v && typeof v === "object" ? deepMerge(base as Record<string, unknown>, v as Record<string, unknown>) : v;
  }
  return s;
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const base = out[k];
    out[k] = base && typeof base === "object" && !Array.isArray(base) && v && typeof v === "object" ? deepMerge(base as Record<string, unknown>, v as Record<string, unknown>) : v;
  }
  return out;
}

/** What differs from Retroma's defaults: what is kept in the setting. */
export function retromaChanges(s: Record<string, unknown>): string {
  const diff = (a: unknown, b: unknown): unknown => {
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a)) {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
        const d = diff(v, (b as Record<string, unknown>)[k]);
        if (d !== undefined) o[k] = d;
      }
      return Object.keys(o).length ? o : undefined;
    }
    return JSON.stringify(a) === JSON.stringify(b) ? undefined : a;
  };
  return JSON.stringify(diff(s, BASE) ?? {});
}

let applied: string[] = [];
let appliedData: string[] = [];

/** Puts Retroma on the page (or takes it off: `on` false); returns what the engine gave, for the parts that read it themselves. */
export function applyRetroma(root: HTMLElement, on: boolean, changedJson: string, o: { dark: boolean; reducedMotion: boolean }): RetromaOutput | null {
  for (const k of applied) root.style.removeProperty(k);
  for (const k of appliedData) delete root.dataset[k];
  applied = [];
  appliedData = [];
  if (!on) {
    root.dataset["look"] = "legacy";
    return null;
  }
  root.dataset["look"] = "retroma";
  installRetromaFonts();
  const s = retromaSettings(changedJson);
  s["em"] = o.dark ? "dk" : "lt";
  s["mode"] = o.dark ? "dark" : "light";
  // (Zen mode, Animation and Density are the app's own settings, the same in every theme: motion follows the app's choice passed in,
  // and the keys' sizes follow the app's Density)
  s["zen"] = false;
  s["motion"] = "system";
  const out = computeRetroma(s, o);
  for (const [k, v] of Object.entries(out.vars)) {
    const name = `--rt-${k.slice(2)}`;
    // (a value that names another of the theme's values, such as a card's outline "var(--outline)", names it with the prefix)
    root.style.setProperty(name, v.replace(/var\(--/g, "var(--rt-"));
    applied.push(name);
  }
  for (const [k, v] of Object.entries(out.data)) {
    const name = `rt${k[0]!.toUpperCase()}${k.slice(1)}`;
    root.dataset[name] = v;
    appliedData.push(name);
  }
  // each rainbow folder's colours, and each callout's and alternative checkbox's, as numbered or named properties
  out.folders.forEach((f, i) => {
    for (const [k, v] of Object.entries(f)) {
      const name = `--rt-folder-${i + 1}-${k}`;
      root.style.setProperty(name, v);
      applied.push(name);
    }
  });
  for (const [k, v] of Object.entries(out.callouts)) {
    const name = `--rt-callout-${k}`;
    root.style.setProperty(name, v);
    applied.push(name);
  }
  for (const [k, v] of Object.entries(out.checkboxes)) {
    const name = `--rt-check-${CHECK_NAMES[k] ?? k}`;
    root.style.setProperty(name, v);
    applied.push(name);
  }
  for (const [k, v] of Object.entries(out.parts)) {
    const name = `rtPart${k[0]!.toUpperCase()}${k.slice(1)}`;
    root.dataset[name] = String(v);
    appliedData.push(name);
  }
  return out;
}

/** The alternative checkboxes' marks as names a custom property can carry. */
export const CHECK_NAMES: Record<string, string> = { "/": "incomplete", "-": "cancelled", ">": "forwarded", "<": "scheduling", "?": "question", "!": "important", "*": "star", '"': "quote", l: "location", b: "bookmark", i: "information", S: "savings", I: "idea", p: "pros", c: "cons", f: "fire", k: "key", w: "win", u: "up", d: "down", D: "draft", P: "open", M: "merged" };
