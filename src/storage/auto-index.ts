/**
 * The library index kept up to date by itself (ADR 0159): while a library folder is in use, a little after the last change
 * (a commit, an import, a move of files, a changed setting) the index is written again, so the folder always carries the
 * workspace the files belong to. One write at a time, never more than one per minute, nothing while another tab is
 * the writer, nothing when there is nothing new. The manual buttons stay.
 */
import { externalFolder } from "./external-folder";
import type { ExportResult, ExportScope, ProgressFn } from "./archive";

export const QUIET_MS = 20_000;
export const MIN_GAP_MS = 60_000;

export interface AutoIndexDeps {
  enabled(): boolean;
  readOnly(): boolean;
  build(scope: ExportScope, progress?: ProgressFn): Promise<ExportResult>;
  /** Told when a save failed (once per streak), and when one succeeds after a failure. */
  say(text: string): void;
  now?(): number;
}

export interface AutoIndex {
  /** Something changed: the index is out of date. */
  poke(): void;
  /** Write now if it is out of date (what the timer does). Resolves when nothing is pending. */
  flush(): Promise<void>;
}

export function installAutoIndex(deps: AutoIndexDeps): AutoIndex {
  const now = deps.now ?? (() => performance.now());
  let dirty = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWrite = -Infinity;
  let failing = false;

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), Math.max(QUIET_MS, lastWrite + MIN_GAP_MS - now()));
  };

  async function flush(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    if (running || !dirty) return;
    if (!externalFolder.ready || deps.readOnly() || !deps.enabled()) {
      dirty = false; // nothing to write to: the next change, or choosing a folder, starts it again
      return;
    }
    running = true;
    dirty = false;
    try {
      const r = await deps.build({ kind: "workspace", noBytes: true, skipHidden: true }) /* (the index lies on disk: hidden items are not in it) */;
      await externalFolder.writeLibraryFile(r.blob);
      lastWrite = now();
      externalFolder.touch(); // (the card shows when it was saved)
      if (failing) deps.say("The library index is saved again.");
      failing = false;
    } catch (e) {
      dirty = true;
      if (!failing) deps.say(`Could not save the library index in the library folder: ${(e as Error).message}. canvast tries again after the next change.`);
      failing = true;
    } finally {
      running = false;
    }
    if (dirty && !failing) schedule(); // (a change came in while writing)
  }

  return {
    poke() {
      if (!externalFolder.ready || !deps.enabled()) return;
      dirty = true;
      if (!running) schedule();
    },
    flush,
  };
}
