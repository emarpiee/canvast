import type { Command, CommandProvider, ResolvedCommand } from "./types";

/**
 * The one list of commands (ADR 0129). Each part of the app that has commands adds a provider under its own name (`setProvider`): the
 * palette, a macro runner or a shortcut map ask the registry, never the parts. A macro is just another provider (source "macros") whose
 * commands run others by id (`run`), so nothing here has to change to take it.
 */
export class CommandRegistry {
  private readonly providers = new Map<string, CommandProvider>();

  /** Add or replace the commands of one source. Sources keep their order of first adding: earlier ones win a tie on a title. */
  setProvider(source: string, provider: CommandProvider): void {
    this.providers.set(source, provider);
  }

  removeProvider(source: string): void {
    this.providers.delete(source);
  }

  /**
   * Every command now, ids and kinds filled in. A command whose title another source already gave is not listed twice: the first stays and
   * is also found under the kind of the later one (the Undo button of a bar is `@toolbar` as well as `@edit`). Settings are the exception:
   * a row to open in Settings and a button of the same name are two different commands.
   */
  all(): ResolvedCommand[] {
    const out: ResolvedCommand[] = [];
    const byTitle = new Map<string, ResolvedCommand>();
    const ids = new Set<string>();
    for (const [source, provider] of this.providers) {
      const mine = new Map<string, ResolvedCommand>();
      for (const c of provider()) {
        const kind = kindOf(c);
        const key = (kind === "settings" ? "s:" : "") + c.title.toLowerCase();
        const first = byTitle.get(key);
        if (first) {
          if (!first.kinds!.includes(kind)) first.kinds!.push(kind);
          continue;
        }
        let id = c.id ?? `${kind}:${slug(c.title)}`;
        for (let n = 2; ids.has(id); n++) id = `${c.id ?? `${kind}:${slug(c.title)}`}-${n}`;
        ids.add(id);
        const r: ResolvedCommand = { ...c, id, kind, kinds: [kind, ...(c.kinds ?? [])], source };
        mine.set(key, r);
        out.push(r);
      }
      for (const [k, r] of mine) byTitle.set(k, r);
    }
    return out;
  }

  get(id: string): ResolvedCommand | undefined {
    return this.all().find((c) => c.id === id);
  }

  /** Run a command by id if it exists and can be done now; false when not. `arg` is the value of a command that takes one. */
  run(id: string, arg?: string): boolean {
    const c = this.get(id);
    if (!c || (c.enabled && !c.enabled())) return false;
    if (c.takes) {
      if (arg === undefined) return false;
      c.takes.run(arg);
    } else c.run();
    this.listeners.forEach((fn) => fn(c, arg));
    return true;
  }

  private readonly listeners = new Set<(c: ResolvedCommand, arg?: string) => void>();

  /** Told after every command that ran by `run` (the palette's recents and the macro recorder listen). */
  onRun(fn: (c: ResolvedCommand, arg?: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The kinds there are now, with how many commands each has (what `@` offers). */
  kinds(): Array<{ kind: string; count: number }> {
    const counts = new Map<string, number>();
    for (const c of this.all()) if (!c.enabled || c.enabled()) for (const k of c.kinds ?? [c.kind]) counts.set(k, (counts.get(k) ?? 0) + 1);
    return [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => a.kind.localeCompare(b.kind));
  }
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

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


/**
 * The commands that match `query`, best first. `@kind` narrows to a kind (its start is enough: `@set`); the other words must each be in
 * the group, title or extra words. A title that starts with a word scores best, then shorter titles; with no words the order stays as listed.
 */
export function findCommands(all: readonly Command[], query: string): Command[] {
  const { kind, words } = parseQuery(query);
  const scored: Array<{ c: Command; score: number }> = [];
  for (const c of all) {
    if (c.enabled && !c.enabled()) continue;
    if (c.quiet && !kind) continue;
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
