/** Put text on the clipboard (the async API, else a hidden field); true when it worked. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.append(t);
    t.select();
    try {
      return document.execCommand("copy");
    } finally {
      t.remove();
    }
  }
}

export interface LongPressOptions {
  /** How long a press lasts before it counts (default 500 ms). */
  readonly ms?: number;
  /** Presses that start inside this selector (a button on the item) are not the item's. */
  readonly except?: string;
}

/**
 * Do `action` for an item (`selector`, inside `root`) that is long-pressed, right-clicked or has Ctrl/Cmd+C pressed while it has the focus: a way to copy
 * a swatch without choosing it. The click that ends a long press is swallowed, so the item is not also chosen. Returns a function that removes it.
 */
export function onLongPress(root: HTMLElement, selector: string, action: (el: HTMLElement) => void, options: LongPressOptions = {}): () => void {
  const ms = options.ms ?? 500;
  let timer = 0;
  let fired = false;
  let at = { x: 0, y: 0 };
  const item = (e: Event): HTMLElement | null => {
    const t = e.target as Element | null;
    return t?.closest?.(selector) && !(options.except && t.closest(options.except)) ? (t.closest(selector) as HTMLElement) : null;
  };
  const stop = (): void => window.clearTimeout(timer);
  const down = (e: PointerEvent): void => {
    fired = false; // (every press starts clean: a long press whose click never came must not swallow a later one)
    const el = item(e);
    if (!el || e.button > 0) return;
    at = { x: e.clientX, y: e.clientY };
    stop();
    timer = window.setTimeout(() => {
      fired = true;
      action(el);
    }, ms);
  };
  const move = (e: PointerEvent): void => {
    if (Math.hypot(e.clientX - at.x, e.clientY - at.y) > 8) stop();
  };
  const click = (e: MouseEvent): void => {
    if (!fired) return;
    fired = false;
    e.stopPropagation();
    e.preventDefault();
  };
  const menu = (e: MouseEvent): void => {
    const el = item(e);
    if (!el) return;
    e.preventDefault();
    stop();
    if (!fired) action(el); // (a mouse right click; a long press already did it)
  };
  const key = (e: KeyboardEvent): void => {
    const el = item(e);
    if (el && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      action(el);
    }
  };
  root.addEventListener("pointerdown", down);
  root.addEventListener("pointermove", move);
  for (const t of ["pointerup", "pointercancel", "pointerleave"] as const) root.addEventListener(t, stop);
  root.addEventListener("click", click, true);
  root.addEventListener("contextmenu", menu);
  root.addEventListener("keydown", key);
  return () => {
    stop();
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("pointermove", move);
    for (const t of ["pointerup", "pointercancel", "pointerleave"] as const) root.removeEventListener(t, stop);
    root.removeEventListener("click", click, true);
    root.removeEventListener("contextmenu", menu);
    root.removeEventListener("keydown", key);
  };
}

/** Show that something was copied: the item gets the class `is-copied` for a moment. */
export function flashCopied(el: HTMLElement): void {
  el.classList.add("is-copied");
  window.setTimeout(() => el.classList.remove("is-copied"), 700);
}
