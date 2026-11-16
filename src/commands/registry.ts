import type { Caller, Command, CommandProvider, CommandRow, Options, OptionSpec, ResolvedCommand, Result, RunContext } from "./types";
import { REASON } from "./types";

/**
 * The one list of commands (ADR 0129, ADR 0205). Each part of the app that has commands adds a provider under its own name
 * (`setProvider`): the palette, the menus, the keys, a macro runner, tests and an outside caller ask the registry, never the parts.
 * `execute` is the one way to run a command: it finds it by id (or an old id, `alias`), checks its options, says why it cannot run, asks
 * the person before an outside caller's risky run, never throws, and tells the listeners (recents, the macro recorder).
 */
export class CommandRegistry {
  private readonly providers = new Map<string, CommandProvider>();
  private readonly aliases = new Map<string, string>();
  /** Asks the person whether an outside caller may run a `confirm` command (the app sets it; without one the run is refused). */
  private confirmer: ((c: ResolvedCommand, options: Options, caller: Caller) => Promise<boolean>) | null = null;
  /** Outside callers may only read (the control channel's read-only switch). */
  readOnlyCallers = false;

  /** Add or replace the commands of one source. Sources keep their order of first adding: earlier ones win a tie on a title. */
  setProvider(source: string, provider: CommandProvider): void {
    this.providers.set(source, provider);
  }

  removeProvider(source: string): void {
    this.providers.delete(source);
  }

  /** An old id that now means another (a renamed command keeps working in macros and for outside callers). */
  alias(old: string, now: string): void {
    this.aliases.set(old, now);
  }

  setConfirmer(fn: (c: ResolvedCommand, options: Options, caller: Caller) => Promise<boolean>): void {
    this.confirmer = fn;
  }

  /**
   * Every command now, ids and kinds filled in. A command whose title another source already gave is not listed twice: the first stays and
   * is also found under the kind of the later one (the Undo button of a bar is `@toolbar` as well as `@edit`). Settings are the exception:
   * a row to open in Settings and a button of the same name are two different commands. A command with its own id is always listed.
   */
  all(): ResolvedCommand[] {
    const out: ResolvedCommand[] = [];
    const byTitle = new Map<string, ResolvedCommand>();
    const ids = new Set<string>();
    for (const [source, provider] of this.providers) {
      const mine = new Map<string, ResolvedCommand>();
      let list: readonly Command[];
      try {
        list = provider();
      } catch {
        continue; // (a part that cannot list its commands now offers none, the others still do)
      }
      for (const c of list) {
        const kind = kindOf(c);
        const key = (kind === "settings" ? "s:" : "") + c.title.toLowerCase();
        const first = byTitle.get(key);
        if (first && !c.id) {
          if (!first.kinds!.includes(kind)) first.kinds!.push(kind);
          continue;
        }
        let id = c.id ?? `${kind}:${slug(c.title)}`;
        for (let n = 2; ids.has(id); n++) id = `${c.id ?? `${kind}:${slug(c.title)}`}-${n}`; // (a fixed id given twice is a mistake the live audit reports)
        ids.add(id);
        const r: ResolvedCommand = { ...c, id, kind, kinds: [kind, ...(c.kinds ?? [])], source, ...(c.id ? {} : { auto: true }) };
        mine.set(key, r);
        out.push(r);
      }
      for (const [k, r] of mine) if (!byTitle.has(k)) byTitle.set(k, r);
    }
    return out;
  }

  get(id: string): ResolvedCommand | undefined {
    const want = this.aliases.get(id) ?? id;
    return this.all().find((c) => c.id === want);
  }

  /** Why the command cannot run now, or null. */
  reasonOf(c: Command): string | null {
    try {
      if (c.why) return c.why();
      if (c.enabled && !c.enabled()) return "It cannot be done now.";
    } catch (e) {
      return `It cannot be checked now: ${(e as Error).message}`;
    }
    return null;
  }

  /** The command list an outside caller reads: every command with its options, risk and whether it can run now. */
  list(filter = ""): CommandRow[] {
    const f = filter.toLowerCase();
    return this.all()
      .filter((c) => !f || `${c.id} ${c.title} ${c.group} ${c.words ?? ""}`.toLowerCase().includes(f))
      .map((c): CommandRow => {
        const reason = this.reasonOf(c);
        return {
          id: c.id,
          title: c.title,
          group: c.group,
          hint: c.hint ?? "",
          ...(c.keys ? { keys: c.keys } : {}),
          options: optionsOf(c),
          risk: c.risk ?? "edit",
          job: !!c.job,
          enabled: reason === null,
          disabledReason: reason,
          needsWorkspace: reason === REASON.noWorkspace || reason === REASON.noCanvas,
        };
      });
  }

  /**
   * Run a command by id. Never throws: an unknown id (with up to three close matches), options that do not fit, a reason it cannot run,
   * a refusal and a failure inside it are all `{ ok: false, error }`. An outside caller (`agent`) cannot run a `refused` command, and its
   * run of a `confirm` command waits for the person's answer.
   */
  async execute(id: string, options: Options = {}, ctx: RunContext = { caller: "ui" }): Promise<Result> {
    return await this.start(id, options, ctx);
  }

  /** `execute`, but done at once when the command is: a button's command has done its work when the click returns. */
  private start(id: string, options: Options, ctx: RunContext): Result | Promise<Result> {
    const c = this.get(id);
    if (!c) {
      const suggest = closest(id, this.all().map((x) => x.id));
      return { ok: false, error: `There is no command "${id}".${suggest.length ? ` Did you mean ${suggest.map((s) => `"${s}"`).join(", ")}?` : ""}`, suggest };
    }
    const bad = checkOptions(optionsOf(c), options, c);
    if (bad) return { ok: false, error: bad };
    const reason = this.reasonOf(c);
    if (reason) return { ok: false, error: reason };
    const risk = c.risk ?? "edit";
    if (ctx.caller === "agent") {
      if (risk === "refused") return { ok: false, error: `"${c.title}" can only be done by the person, in the app.` };
      if (this.readOnlyCallers && risk !== "read") return { ok: false, error: "Outside callers may only read now (Settings: the connection is read-only)." };
      if (risk === "confirm") {
        const ask = this.confirmer ? this.confirmer(c, options, ctx.caller).catch(() => false) : Promise.resolve(false);
        return ask.then((yes) => (yes ? this.perform(c, options, ctx) : { ok: false, error: `The person did not allow "${c.title}".` }));
      }
    }
    return this.perform(c, options, ctx);
  }

  private perform(c: ResolvedCommand, options: Options, ctx: RunContext): Result | Promise<Result> {
    const fail = (e: unknown): Result => ({ ok: false, error: `"${c.title}" failed: ${(e as Error)?.message ?? String(e)}` });
    const done = (r: Result | void): Result => {
      const result = r ?? { ok: true };
      if (result.ok) this.listeners.forEach((fn) => fn(c, options, ctx));
      return result;
    };
    try {
      if (c.exec) {
        const r = c.exec(options, ctx);
        return r instanceof Promise ? r.then(done, fail) : done(r);
      }
      if (c.takes) {
        const value = options[c.takes.option ?? "value"];
        if (typeof value !== "string") return { ok: false, error: `"${c.title}" needs its "${c.takes.option ?? "value"}".` };
        c.takes.run(value);
        return done(undefined);
      }
      if (c.run) {
        c.run();
        return done(undefined);
      }
      return { ok: false, error: `"${c.title}" does nothing yet.` };
    } catch (e) {
      return fail(e);
    }
  }

  /** Several commands in order; stops at the first that fails unless `stopOnError` is false. Not one undo step: what ran stays. */
  async batch(steps: ReadonlyArray<{ id: string; options?: Options }>, ctx: RunContext, stopOnError = true): Promise<{ ok: boolean; completed: number; results: Result[] }> {
    const results: Result[] = [];
    for (const s of steps.slice(0, MAX_BATCH)) {
      const r = await this.execute(s.id, s.options ?? {}, ctx);
      results.push(r);
      if (!r.ok && stopOnError) break;
    }
    if (steps.length > MAX_BATCH) results.push({ ok: false, error: `A batch has at most ${MAX_BATCH} steps.` });
    return { ok: results.every((r) => r.ok), completed: results.filter((r) => r.ok).length, results };
  }

  /**
   * Run a command now, without waiting (a button, a menu row, a key). The old form: true when it was found and could run. Its result,
   * when it fails, is shown by `onFail`.
   */
  run(id: string, arg?: string, caller: Caller = "ui"): boolean {
    const c = this.get(id);
    if (!c || (c.takes && arg === undefined)) return false;
    return this.press(id, arg === undefined ? {} : { [c.takes?.option ?? "value"]: arg }, caller);
  }

  /** Run a command now with these options (a button, a menu row, a key): false when it is not there or cannot run now; a failure is told to `onFail`. */
  press(id: string, options: Options = {}, caller: Caller = "ui"): boolean {
    const c = this.get(id);
    if (!c || this.reasonOf(c)) return false;
    const told = (r: Result): void => {
      if (!r.ok) this.failListeners.forEach((fn) => fn(c, r.error));
    };
    const r = this.start(id, options, { caller });
    if (r instanceof Promise) void r.then(told);
    else told(r);
    return true;
  }

  private readonly listeners = new Set<(c: ResolvedCommand, options: Options, ctx: RunContext) => void>();
  private readonly failListeners = new Set<(c: ResolvedCommand, error: string) => void>();

  /** Told after every command that ran (the palette's recents and the macro recorder listen). */
  onRun(fn: (c: ResolvedCommand, options: Options, ctx: RunContext) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Told when a command run without waiting failed (the app shows the error as a notice). */
  onFail(fn: (c: ResolvedCommand, error: string) => void): () => void {
    this.failListeners.add(fn);
    return () => this.failListeners.delete(fn);
  }

  /** The kinds there are now, with how many commands each has (what `@` offers). */
  kinds(): Array<{ kind: string; count: number }> {
    const counts = new Map<string, number>();
    for (const c of this.all()) if (this.reasonOf(c) === null) for (const k of c.kinds ?? [c.kind]) counts.set(k, (counts.get(k) ?? 0) + 1);
    return [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => a.kind.localeCompare(b.kind));
  }
}

/** The one registry of the app: every part adds its commands here, every caller runs them from here. */
export const commands = new CommandRegistry();

/** Run a command of the app by id now (a button, a menu row): the one call a click handler makes (`check:commands`). */
export const runCommand = (id: string, options: Options = {}, caller: Caller = "ui"): Promise<Result> => commands.execute(id, options, { caller });

/** Run a command of the app now, without waiting (what a click handler or a key does): false when it cannot run now. */
export const pressCommand = (id: string, options: Options = {}, caller: Caller = "ui"): boolean => commands.press(id, options, caller);

export const MAX_BATCH = 256;

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The options of a command: its own, or the one value a `takes` command asks for. */
export function optionsOf(c: Command): readonly OptionSpec[] {
  if (c.options) return c.options;
  if (c.takes) return [{ name: c.takes.option ?? "value", type: "text", doc: c.takes.prompt, required: true }];
  return [];
}

/** What is wrong with these options for this command, or null when they fit. */
export function checkOptions(spec: readonly OptionSpec[], options: Options, c: Command): string | null {
  if (options === null || typeof options !== "object" || Array.isArray(options)) return `The options of "${c.title}" are a set of named values.`;
  const known = new Set(spec.map((o) => o.name));
  for (const k of Object.keys(options)) if (!known.has(k)) return `"${c.title}" has no option "${k}".${spec.length ? ` It takes: ${spec.map((o) => o.name).join(", ")}.` : " It takes none."}`;
  for (const o of spec) {
    const v = options[o.name];
    if (v === undefined || v === null) {
      if (o.required) return `"${c.title}" needs "${o.name}" (${o.doc}).`;
      continue;
    }
    const wrong = (what: string): string => `"${o.name}" of "${c.title}" is ${what}.`;
    switch (o.type) {
      case "text":
      case "id":
        if (typeof v !== "string") return wrong("text");
        if (v.length > 100_000) return wrong("too long");
        break;
      case "colour":
        if (typeof v !== "string" || !/^(#[0-9a-f]{3,8}|oklch\([^)]*\)|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i.test(v.trim())) return wrong("a colour (#rrggbb)");
        break;
      case "number":
        if (typeof v !== "number" || !Number.isFinite(v)) return wrong("a number");
        if (o.min !== undefined && v < o.min) return wrong(`at least ${o.min}`);
        if (o.max !== undefined && v > o.max) return wrong(`at most ${o.max}`);
        break;
      case "boolean":
        if (typeof v !== "boolean") return wrong("true or false");
        break;
      case "choice":
        if (typeof v !== "string" || !(o.choices ?? []).includes(v)) return wrong(`one of ${(o.choices ?? []).join(", ")}`);
        break;
      case "ids":
        if (!Array.isArray(v) || v.length > 100_000 || !v.every((x) => typeof x === "string")) return wrong("a list of ids");
        break;
      case "json":
        break;
    }
  }
  return null;
}

/** Up to three ids close to a mistyped one (by edit distance, and ids that contain it). */
export function closest(id: string, ids: readonly string[]): string[] {
  const q = id.toLowerCase();
  return ids
    .map((x) => ({ x, d: x.toLowerCase().includes(q) || q.includes(x.toLowerCase()) ? 0 : distance(q, x.toLowerCase()) }))
    .filter((s) => s.d <= Math.max(2, Math.floor(q.length / 3)))
    .sort((a, b) => a.d - b.d || a.x.length - b.x.length)
    .slice(0, 3)
    .map((s) => s.x);
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 8) return 99;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/** The `@keyword` of a command: its own, else its group in lower case as one word. */
export const kindOf = (c: Command): string => c.kind ?? slug(c.group).split("-")[0]!;

export interface ParsedQuery {
  /** The kind typed with `@` (`@settings theme`), as typed so far; null when there is none. */
  kind: string | null;
  /** The words after the kind. */
  words: string[];
  /** The query is only the kind being typed (`@set`): offer the kinds instead of commands. */
  choosing: boolean;
}

export function parseQuery(query: string): ParsedQuery {
  const q = query.trimStart();
  const m = /^@(\S*)(\s*)(.*)$/.exec(q);
  if (!m) return { kind: null, words: q.toLowerCase().split(/\s+/).filter(Boolean), choosing: false };
  return { kind: m[1]!.toLowerCase(), words: m[3]!.toLowerCase().split(/\s+/).filter(Boolean), choosing: m[2] === "" };
}

const usable = (c: Command): boolean => {
  try {
    return c.why ? c.why() === null : !c.enabled || c.enabled();
  } catch {
    return false;
  }
};

/**
 * The commands that match `query`, best first. `@kind` narrows to a kind (its start is enough: `@set`); the other words must each be in
 * the group, title or extra words. A title that starts with a word scores best, then shorter titles; with no words the order stays as listed.
 */
export function findCommands(all: readonly Command[], query: string): Command[] {
  const { kind, words } = parseQuery(query);
  const scored: Array<{ c: Command; score: number }> = [];
  for (const c of all) {
    if (!usable(c)) continue;
    if (c.quiet && !kind) continue;
    if (!c.takes && c.options?.some((o) => o.required)) continue; // (the palette asks for one value at most: a command that needs more is for a caller that gives them)
    if (kind !== null && kind !== "" && ![kindOf(c), ...(c.kinds ?? [])].some((k) => k.startsWith(kind)) && !c.group.toLowerCase().startsWith(kind)) continue;
    const title = c.title.toLowerCase();
    const hay = `${c.group} ${c.title} ${c.words ?? ""}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    let score = 0;
    for (const w of words) score += title.startsWith(w) ? 3 : title.includes(` ${w}`) ? 2 : title.includes(w) ? 1 : 0;
    scored.push({ c, score: score * 100 - title.length });
  }
  return (words.length ? scored.sort((a, b) => b.score - a.score) : scored).map((s) => s.c);
}
