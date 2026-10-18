/**
 * What a command is (ADR 0129). Everything the command palette can do is one of these, whoever made it: the app's own list, the buttons of
 * the bars, the settings, the panels, and (soon) a person's macros. A command carries no behaviour of the palette's: it says what it is
 * called, which `@kind` it belongs to, when it can run, and how.
 */
export interface Command {
  /** Stable name, for running it by name (a macro does) and for telling two apart; made from the kind and the title when left out. */
  id?: string;
  /** What it is called, without the group ("Select", "Zoom in"). */
  title: string;
  /** The label shown first in the row and matched too ("Tool", "View", "Selection"). */
  group: string;
  /** The `@keyword` that narrows the palette to it ("tool", "settings", "toolbar"); the group in lower case when left out. */
  kind?: string;
  /** More kinds it is also found under (a bar's button that is also an app command is under `@toolbar` as well); filled in by the registry. */
  kinds?: string[];
  /** Its key or shortcut, when it has one. */
  keys?: string;
  /** Extra words that find it ("redo" for "Undo"). */
  words?: string;
  /** False when it cannot be done now: it is not offered. */
  enabled?: () => boolean;
  run(): void;
}

/** A command as the registry hands it out: its id, kind and the source that made it are always there. */
export interface ResolvedCommand extends Command {
  id: string;
  kind: string;
  source: string;
}

/** Makes commands when asked: so what is possible now is read when the palette opens, and nothing has to be kept up to date by hand. */
export type CommandProvider = () => readonly Command[];
