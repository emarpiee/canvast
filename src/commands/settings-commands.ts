import type { Command } from "./types";

/** What this needs of a settings store and of the Settings view's rows (structural, so it does not import them). */
interface Store {
  get(key: never): unknown;
  set(key: never, value: never): unknown;
}
interface Row {
  readonly key: string;
  readonly label: string;
  readonly help?: string;
  readonly control: { readonly kind: string; readonly options?: ReadonlyArray<readonly [string, string]> };
}
interface Tab {
  readonly id: string;
  readonly label: string;
  readonly rows?: readonly Row[];
}

/**
 * The settings as commands (ADR 0129), from the same rows the Settings view is made of, so a new setting is in the palette with its row:
 * a switch is toggled, each choice of a menu is one command ("Theme: Dark", left out when it is the one now), and every row can be opened
 * in the Settings view. Setting and tab names are words that find them.
 */
export function settingCommands(tabs: readonly Tab[], store: Store, openTab: (tab: string) => void): Command[] {
  const get = (k: string): unknown => store.get(k as never);
  const set = (k: string, v: unknown): void => void store.set(k as never, v as never);
  const out: Command[] = [];
  for (const t of tabs) {
    for (const r of t.rows ?? []) {
      const words = `${t.label} ${r.help ?? ""} preferences options setting`;
      const open = (): void => openTab(t.id);
      if (r.control.kind === "toggle") out.push({ group: "Setting", kind: "settings", title: `Toggle ${r.label.toLowerCase()}`, words, run: () => set(r.key, !get(r.key)) });
      else if (r.control.kind === "select")
        for (const [value, label] of r.control.options ?? []) out.push({ group: "Setting", kind: "settings", title: `${r.label}: ${label}`, words, enabled: () => String(get(r.key)) !== value, run: () => set(r.key, typeof get(r.key) === "number" ? Number(value) : value) });
      out.push({ group: "Setting", kind: "settings", title: r.label, words, run: open });
    }
  }
  return out;
}
