import type { EditorState } from "../app/editor-state";
import { ICONS } from "./icons";
import { esc } from "./format";

/**
 * Notices (ADR 0053): what the app tells the user, where it can be seen. A stack at the bottom centre of the window, above every view,
 * replaces the small line that used to appear in the toolbar for a few seconds. A notice has an icon and a colour by kind, a progress
 * bar when it reports work in progress (importing, indexing), a close button, and a live region so it is read out. Successes and facts
 * fade after a while, errors stay longer, and a progress notice stays while it is being updated.
 *
 * Code anywhere still sets `editor.message`; this module takes it, works out the kind from the wording and the progress from
 * "3 of 10" or "45%", and replaces the earlier notice of the same activity instead of stacking a new one.
 */
export type NoticeKind = "info" | "progress" | "success" | "warning" | "error";

export interface Notice {
  readonly text: string;
  readonly kind: NoticeKind;
  /** 0 to 1, or null for work of unknown length. Only for `progress`. */
  readonly progress?: number | null;
  /** Notices with the same channel replace each other (all importing messages, say). */
  readonly channel?: string;
  /** A button on the notice (e.g. View); it runs and the notice goes. */
  readonly action?: { readonly label: string; run(): void };
}

/** The kind, progress and channel a plain message means. */
export function classify(text: string): Notice {
  const of = /^Importing (\d+) of (\d+)/.exec(text);
  if (of) return { text, kind: "progress", progress: Number(of[1]) / Number(of[2]), channel: "import" };
  if (/^Importing\b/.test(text)) return { text, kind: "progress", progress: null, channel: "import" };
  const pct = /^Indexing .*?(\d+)%/.exec(text);
  if (pct) return { text, kind: "progress", progress: Number(pct[1]) / 100, channel: "index" };
  if (/^(Could not|Not saved|Save failed|Storage unavailable|Upgrade could not|The browser reset|Text is too long|That bookmark)/i.test(text) || /failed|error/i.test(text)) return { text, kind: "error" };
  if (/^(Read-only|Skipped|Upgrading|canvast was upgraded|Select at least|Pasted in place)/i.test(text)) return { text, kind: "warning" };
  if (/^(Imported|Deleted|Copied|Showed|Unlocked|Saved|Upgraded|Exported)/i.test(text) || /^\d+ new file/.test(text)) return { text, kind: "success" };
  return { text, kind: "info" };
}

const LIFETIME_MS: Record<NoticeKind, number> = { info: 6000, success: 5000, warning: 9000, error: 14000, progress: 4000 };
const MAX_SHOWN = 3;

interface Shown {
  readonly el: HTMLElement;
  readonly notice: Notice;
  timer: ReturnType<typeof setTimeout> | null;
}

export function mountNotices(host: HTMLElement, editor: EditorState): { push(n: Notice): void; subscribe(fn: (text: string) => void): void } {
  const stack = document.createElement("div");
  stack.id = "notices";
  stack.dataset["testid"] = "toast";
  // The container is the live region; each notice carries its own role (status, or alert for an error).
  stack.setAttribute("aria-live", "polite");
  stack.hidden = true;
  host.appendChild(stack);
  const shown: Shown[] = [];
  const mirrors: Array<(text: string) => void> = [];

  const icon = (n: Notice): string => (n.kind === "progress" ? `<span class="notice-spin">${ICONS.loader}</span>` : n.kind === "success" ? ICONS.circleCheck : n.kind === "error" ? ICONS.circleAlert : n.kind === "warning" ? ICONS.triangleAlert : ICONS.info);
  const fill = (s: Shown, n: Notice): void => {
    const bar = n.kind === "progress" ? `<span class="notice-bar${n.progress == null ? " is-unknown" : ""}"><span style="width:${Math.round((n.progress ?? 0) * 100)}%"></span></span>` : "";
    s.el.className = `notice is-${n.kind}`;
    s.el.setAttribute("role", n.kind === "error" ? "alert" : "status");
    s.el.innerHTML = `<span class="notice-icon">${icon(n)}</span><span class="notice-body"><span class="notice-text">${esc(n.text)}</span>${bar}</span>${n.action ? `<button type="button" class="notice-action">${esc(n.action.label)}</button>` : ""}<button type="button" class="notice-close" aria-label="Dismiss">${ICONS.x}</button>`;
  };
  const remove = (s: Shown): void => {
    if (s.timer) clearTimeout(s.timer);
    s.el.remove();
    shown.splice(shown.indexOf(s), 1);
    stack.hidden = shown.length === 0;
  };
  const arm = (s: Shown): void => {
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => remove(s), LIFETIME_MS[s.notice.kind]);
  };

  const push = (n: Notice): void => {
    for (const fn of mirrors) fn(n.text);
    // The same activity replaces its earlier notice; an identical text only renews its time.
    const same = shown.find((s) => (n.channel && s.notice.channel === n.channel) || s.notice.text === n.text);
    if (same) {
      (same as { notice: Notice }).notice = n;
      fill(same, n);
      arm(same);
      return;
    }
    // Work that has ended (a result arrives) replaces the progress notice that reported it.
    if (n.kind !== "progress") for (const s of [...shown]) if (s.notice.kind === "progress") remove(s);
    const el = document.createElement("div");
    const s: Shown = { el, notice: n, timer: null };
    fill(s, n);
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest(".notice-close")) remove(s);
      else if (t.closest(".notice-action")) {
        s.notice.action?.run();
        remove(s);
      }
    });
    el.addEventListener("pointerenter", () => s.timer && clearTimeout(s.timer));
    el.addEventListener("pointerleave", () => arm(s));
    stack.appendChild(el);
    shown.push(s);
    while (shown.length > MAX_SHOWN) remove(shown[0]!);
    stack.hidden = false;
    arm(s);
  };

  editor.subscribe(() => {
    if (editor.progressDone.size) {
      for (const channel of editor.progressDone) for (const s of [...shown]) if (s.notice.channel === channel && s.notice.kind === "progress") remove(s);
      editor.progressDone.clear();
    }
    if (!editor.message) return;
    const text = editor.message;
    const action = editor.messageAction;
    editor.message = "";
    editor.messageAction = null;
    push(action ? { ...classify(text), action } : classify(text));
  });
  return { push, subscribe: (fn) => void mirrors.push(fn) };
}
