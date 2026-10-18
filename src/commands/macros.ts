import type { CommandRegistry } from "./registry";
import type { Command } from "./types";

/**
 * Macros (ADR 0129): a macro is a list of commands run in order, recorded from what is run through the registry (the palette). It is a
 * provider of its own whose commands run others by id, so the registry knows nothing about macros. Kept on this device in `localStorage`
 * (the workspace has no store for settings yet; a macro refers to commands by id, which are the same on every device).
 */
export interface MacroStep {
  id: string;
  /** The value of a command that takes one (a name, a number). */
  arg?: string;
}
export interface Macro {
  name: string;
  steps: MacroStep[];
}

const KEY = "canvast.macros";

export const loadMacros = (): Macro[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((m): m is Macro => !!m && typeof m.name === "string" && Array.isArray(m.steps) && m.steps.every((s: MacroStep) => s && typeof s.id === "string"));
  } catch {
    return [];
  }
};

const saveMacros = (list: readonly Macro[]): void => {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: the macro lasts until the page closes
  }
};

export class Macros {
  private list: Macro[] = loadMacros();
  private steps: MacroStep[] | null = null;
  private playing = false;

  constructor(private readonly registry: CommandRegistry, private readonly tell: (text: string) => void) {
    registry.onRun((c, arg) => {
      if (this.steps && !this.playing && c.kind !== "macro") this.steps.push(arg === undefined ? { id: c.id } : { id: c.id, arg });
    });
    registry.setProvider("macros", () => this.commands());
  }

  get recording(): boolean {
    return this.steps !== null;
  }
  get macros(): readonly Macro[] {
    return this.list;
  }

  /** Save the steps recorded so far under `name` (a macro of that name is replaced). */
  stop(name: string): boolean {
    const steps = this.steps;
    this.steps = null;
    const n = name.trim();
    if (!steps || !n || steps.length === 0) return false;
    this.list = [...this.list.filter((m) => m.name !== n), { name: n, steps }];
    saveMacros(this.list);
    return true;
  }

  /** Run a macro: its commands in order, one turn apart so each sees the result of the one before. Returns how many could run. */
  async play(name: string): Promise<number> {
    const m = this.list.find((x) => x.name === name);
    if (!m) return 0;
    this.playing = true;
    let done = 0;
    try {
      for (const s of m.steps) {
        if (this.registry.run(s.id, s.arg)) done++;
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      this.playing = false;
    }
    this.tell(done === m.steps.length ? `Macro "${name}" ran (${done} steps).` : `Macro "${name}": ${done} of ${m.steps.length} steps could run now.`);
    return done;
  }

  remove(name: string): void {
    this.list = this.list.filter((m) => m.name !== name);
    saveMacros(this.list);
  }

  private commands(): Command[] {
    const out: Command[] = [];
    if (this.steps === null) out.push({ group: "Macro", kind: "macro", title: "Record a macro", words: "start recording", run: () => { this.steps = []; this.tell("Recording: run commands from the palette, then Save the macro."); } });
    else {
      out.push({
        group: "Macro", kind: "macro", title: "Save the macro", words: "stop recording", run: () => undefined,
        takes: { prompt: "Name the macro", run: (name) => this.tell(this.stop(name) ? `Macro "${name.trim()}" saved.` : "Nothing was recorded.") },
      });
      out.push({ group: "Macro", kind: "macro", title: "Cancel the recording", run: () => { this.steps = null; } });
    }
    for (const m of this.list) {
      out.push({ id: `macro:run:${m.name}`, group: "Macro", kind: "macro", title: `Run ${m.name}`, words: "play", enabled: () => !this.playing, run: () => void this.play(m.name) });
      out.push({ id: `macro:delete:${m.name}`, group: "Macro", kind: "macro", title: `Delete the macro ${m.name}`, words: "remove", run: () => this.remove(m.name) });
    }
    return out;
  }
}
