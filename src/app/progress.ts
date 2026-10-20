import type { EditorState } from "./editor-state";

/**
 * Progress for anything that makes the person wait (ADR 0161): export, import, moving files, deleting. One call starts a
 * notice with a bar that stays until the work says it ended (`done` or `fail`), so nothing ever looks frozen.
 *
 *   const p = beginProgress(editor, "export", "Exporting the backup");
 *   p.update(0.4, "reading files (12 of 30)");   // a bar at 40%; null for work of unknown length
 *   p.done("Exported …");                         // closes it and says the result
 *   p.fail("Export failed: …");                   // closes it and says what went wrong
 *
 * A stage whose length is not known uses `p.update(null, "checking the file")`: the bar moves without a number.
 */
export interface Progress {
  update(fraction: number | null, detail?: string): void;
  done(result?: string, action?: { label: string; run(): void }): void;
  fail(text: string): void;
}

const MIN_GAP_MS = 80;

export function beginProgress(editor: EditorState, channel: string, label: string): Progress {
  let ended = false;
  let last = -Infinity;
  const show = (fraction: number | null, detail?: string): void => {
    const pct = fraction === null ? "" : ` ${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    const text = `${label}${detail ? `: ${detail}` : ""}${pct}`;
    editor.progressNow = { channel, text, fraction: fraction === null ? null : Math.min(1, Math.max(0, fraction)) };
    editor.changed();
  };
  const end = (message: string | undefined, action?: { label: string; run(): void }): void => {
    if (ended) return;
    ended = true;
    editor.progressDone.add(channel);
    if (message) {
      editor.message = message;
      editor.messageAction = action ?? null;
    }
    editor.changed();
  };
  show(null);
  return {
    update(fraction, detail) {
      if (ended) return;
      const now = performance.now();
      if (now - last < MIN_GAP_MS && fraction !== null && fraction < 1) return; // (a loop of thousands must not redraw the notice each time)
      last = now;
      show(fraction, detail);
    },
    done: (result, action) => end(result, action),
    fail: (text) => end(text),
  };
}
