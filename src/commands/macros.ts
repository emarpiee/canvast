import type { CommandRegistry } from "./registry";
import type { Caller, Command, Options } from "./types";

/**
 * Macros (ADR 0129, ADR 0205): a macro is a list of commands run in order, recorded from every command that runs (a button, a menu, a key,
 * the palette; reads and commands marked `record: false` are left out). It is a
 * provider of its own whose commands run others by id, so the registry knows nothing about macros. Kept on this device in `localStorage`
 * (the workspace has no store for settings yet; a macro refers to commands by id, which are the same on every device).
 */
export interface MacroStep {
  id: string;
  /** The options it ran with. */
  options?: Options;
  /** (Old macros) the value of a command that takes one. */
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
    registry.onRun((c, options) => {
      if (!this.steps || this.playing || c.kind === "macro" || c.record === false || (c.risk === "read" && c.record !== true) || options["live"] === true) return; // (a live step is a preview: the kept one follows)
      this.steps.push(Object.keys(options).length ? { id: c.id, options } : { id: c.id });
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
  async play(name: string, caller: Caller = "macro"): Promise<number> {
    const m = this.list.find((x) => x.name === name);
    if (!m) return 0;
    this.playing = true;
    let done = 0;
    try {
      for (const s of m.steps) {
        // (each step is checked as a command of its own: a macro an outside caller runs cannot skip what asks the person)
        const c = this.registry.get(s.id);
        const options = s.options ?? (s.arg !== undefined && c ? { [c.takes?.option ?? "value"]: s.arg } : {});
        if ((await this.registry.execute(s.id, options, { caller })).ok) done++;
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
    if (this.steps === null) out.push({ id: "macro.record", group: "Macro", kind: "macro", title: "Record a macro", hint: "Start recording what you do", risk: "edit", words: "start recording", exec: () => { this.steps = []; this.tell("Recording: do what the macro should do, then Save the macro."); } });
    else {
      out.push({
        id: "macro.save", group: "Macro", kind: "macro", title: "Save the macro", hint: "Stop recording and keep it", risk: "edit", words: "stop recording",
        takes: { prompt: "Name the macro", option: "name", run: (name) => this.tell(this.stop(name) ? `Macro "${name.trim()}" saved.` : "Nothing was recorded.") },
      });
      out.push({ id: "macro.cancel", group: "Macro", kind: "macro", title: "Cancel the recording", hint: "Stop without keeping it", risk: "edit", exec: () => { this.steps = null; } });
    }
    for (const m of this.list) {
      out.push({ id: `macro:run:${m.name}`, group: "Macro", kind: "macro", title: `Run ${m.name}`, hint: `Its ${m.steps.length} steps in order`, risk: "edit", words: "play", why: () => (this.playing ? "A macro is running." : null), exec: async (_o, ctx) => { await this.play(m.name, ctx.caller === "agent" ? "agent" : "macro"); } });
      out.push({ id: `macro:delete:${m.name}`, group: "Macro", kind: "macro", title: `Delete the macro ${m.name}`, hint: "Remove it from this device", risk: "confirm", words: "remove", exec: () => this.remove(m.name) });
    }
    return out;
  }
}
