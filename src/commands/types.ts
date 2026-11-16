/**
 * What a command is (ADR 0129, ADR 0205). Every action of the app is one: the palette, the menus, the keys, the bars, macros, tests and an
 * outside caller (the control channel, MCP) all run it by its id. A command says what it is called, what it takes, what it may touch, when
 * it can run and why not, and how; it holds no behaviour of the palette's or of a menu's.
 *
 * The rule (checked by `npm run check:commands`, the commands unit test and the live audit): a fixed `id` (`area.action`), a `title`, a
 * `hint`, its `options` described, a `risk`, a reason when it cannot run (`why`), and `exec`, which never throws (an error is a result).
 */

/** What a command may touch, which decides what an outside caller may do with it (ADR 0205). */
export type Risk =
  /** Only reads: lists, searches, info, a preview. Never recorded in a macro. */
  | "read"
  /** Changes what can be undone or put back (an edit, a move, a tag, a view). */
  | "edit"
  /** Hard to undo or private (deleting, hidden items, replacing the workspace, writing a file to the disk): an outside caller's run asks the person first. */
  | "confirm"
  /** Never for an outside caller (a password, files outside the granted folders, settings that widen access); the person may still run it. */
  | "refused";

export type OptionType = "text" | "number" | "boolean" | "colour" | "choice" | "id" | "ids" | "json";

/** One option of a command: what an outside caller reads to call it (and what MCP shows as its schema). */
export interface OptionSpec {
  name: string;
  type: OptionType;
  /** One short line: what it is. */
  doc: string;
  required?: boolean;
  /** The values a `choice` takes. */
  choices?: readonly string[];
  min?: number;
  max?: number;
}

export type Options = Readonly<Record<string, unknown>>;

/** What a run gave: done, with what it made or changed (ids) and any value it reads; or an error in plain words. */
export type Result =
  | { ok: true; made?: readonly string[]; changed?: readonly string[]; value?: unknown; note?: string }
  | { ok: false; error: string; suggest?: readonly string[] };

/** Who runs a command: the person (a button, a menu, a key, the palette), a macro, a test, or an outside caller (the control channel). */
export type Caller = "ui" | "key" | "palette" | "macro" | "test" | "agent";

export interface RunContext {
  caller: Caller;
  /** A long command (`job`) tells how far it is, 0 to 1. */
  progress?: (fraction: number, message?: string) => void;
  /** A long command stops when this is aborted, leaving things as they were. */
  signal?: AbortSignal;
}

/** The common reasons a command cannot run now; a command may give any other sentence. */
export const REASON = {
  noWorkspace: "No workspace is open.",
  noCanvas: "No canvas is open.",
  notOnCanvas: "This works on the canvas view.",
  noSelection: "Nothing is selected.",
  readOnly: "This workspace is read-only.",
  hiddenLocked: "Hidden items are locked.",
} as const;

export interface Command {
  /** The fixed name (`edit.undo`, `library.move`): never made from the title, never reused; a renamed id stays as an alias (`CommandRegistry.alias`). */
  id?: string;
  /** What it is called, without the group ("Select", "Zoom in"). */
  title: string;
  /** The label shown first in the row and matched too ("Tool", "View", "Selection"). */
  group: string;
  /** One short line: what it does (the menus' hint). */
  hint?: string;
  /** The icon of its menu rows and buttons (`ICONS.…` markup). */
  icon?: string;
  /** The `@keyword` that narrows the palette to it ("tool", "settings", "toolbar"); the group in lower case when left out. */
  kind?: string;
  /** More kinds it is also found under; filled in by the registry. */
  kinds?: string[];
  /** Its key or shortcut, when it has one. */
  keys?: string;
  /** Extra words that find it ("redo" for "Undo"). */
  words?: string;
  /** Found only when a kind is typed (`@shortcut undo`). */
  quiet?: boolean;
  /** What it takes. A run is checked against these before it starts. */
  options?: readonly OptionSpec[];
  /** What it may touch (see `Risk`). */
  risk?: Risk;
  /** Recorded by a macro (default: yes for every risk but `read`). */
  record?: boolean;
  /** A long command: it reports progress and can be cancelled. */
  job?: boolean;
  /** A way to a control from the palette (a bar's button by its own name): not listed for an outside caller, which runs the control's command. */
  paletteOnly?: boolean;
  /** (A palette-only entry) the command its control runs. */
  paletteOf?: string;
  /** A `confirm` command that shows the person its own dialog first (Delete the item?): an outside caller's run is asked there, not twice. */
  asks?: boolean;
  /** Why it cannot run now, or null when it can. */
  why?: () => string | null;
  /** (Old form of `why`) false when it cannot be done now. */
  enabled?: () => boolean;
  /** A command that needs one value typed in the palette (a name): the palette asks for it, then calls `takes.run`. */
  takes?: { prompt: string; option?: string; run(value: string): void };
  /** The action, with its options checked. Never throws: a failure is `{ ok: false, error }`. */
  exec?: (options: Options, ctx: RunContext) => Result | void | Promise<Result | void>;
  /** (Old form of `exec`) the action with no options. */
  run?: () => void;
}

/** A command as the registry hands it out: its id, kind and the source that made it are always there. */
export interface ResolvedCommand extends Command {
  id: string;
  kind: string;
  source: string;
  /** Its id was made from its title (it has no fixed id of its own: it does not follow the rule yet). */
  auto?: boolean;
}

/** Makes commands when asked: so what is possible now is read when the palette opens, and nothing has to be kept up to date by hand. */
export type CommandProvider = () => readonly Command[];

/** One row of the command list an outside caller reads (`command.list`). */
export interface CommandRow {
  id: string;
  title: string;
  group: string;
  hint: string;
  keys?: string;
  options: readonly OptionSpec[];
  risk: Risk;
  job: boolean;
  enabled: boolean;
  /** Null when it can run; else why not. */
  disabledReason: string | null;
  /** It is off only because no workspace (or canvas) is open: open one first. */
  needsWorkspace: boolean;
}
