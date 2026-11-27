import { ICONS } from "./icons";
import { esc } from "./format";
import { pressCommand } from "../commands/registry";

/** What a tab shows (B39): a canvas, the Library, or the start page of a new tab. */
export type Place = { kind: "canvas"; id: string } | { kind: "library" } | { kind: "start" } | { kind: "file"; hash: string };

interface Tab {
  key: string;
  /** Where it has been, and `at`, where it is (Back and Forward walk it). */
  history: Place[];
  at: number;
}

export interface TabsDeps {
  /** Make the app show this place (the tabs' own moves: a tab chosen, Back, Forward). */
  show(place: Place): void;
  /** How a place is named: its tab's title and icon, and the view header's path. */
  describe(place: Place): { title: string; icon: string; path: string[] };
  /** Whether a place still exists (a canvas deleted, another workspace). */
  valid(place: Place): boolean;
  /** Where the tabs are kept on this device (per workspace), or null to keep nothing. */
  storeKey(): string | null;
  /** Opens the view's ⋯ menu (a canvas's: what its small stack leaves out), from the view header's button. */
  openMenu(place: Place, anchor: HTMLElement): void;
}

export interface Tabs {
  /** The app moved (a canvas opened, the Library shown): the active tab goes there, as a step of its history. */
  follow(place: Place): void;
  /** A new tab showing this place, made active. */
  open(place: Place): void;
  close(key?: string): void;
  activate(key: string): void;
  step(by: 1 | -1): void;
  /** Back in the active tab's history; false when it is at its start. */
  back(): boolean;
  forward(): void;
  /** Names changed (a canvas renamed): draw again. */
  refresh(): void;
  /** Read the tabs kept for this workspace and show the active one (at start, and after a workspace switch). */
  restore(fallback: Place): void;
  /** Whether a tab of this group has this key. */
  owns(key: string): boolean;
  readonly active: Place;
  readonly count: number;
}

const same = (a: Place, b: Place): boolean =>
  a.kind === b.kind && (a.kind === "canvas" ? b.kind === "canvas" && a.id === b.id : a.kind === "file" ? b.kind === "file" && a.hash === b.hash : true);
let made = 0;
const newKey = (): string => `t${++made}`;

/**
 * The tab strip and the view header of the workspace (B39): one group of tabs, each a place with its own Back and Forward. Opening something
 * moves the active tab (`follow`); Ctrl+click and the + button make a new one. The strip also holds the buttons that show a hidden sidebar.
 */
export function mountTabs(strip: HTMLElement, head: HTMLElement, deps: TabsDeps): Tabs {
  let tabs: Tab[] = [{ key: newKey(), history: [{ kind: "start" }], at: 0 }];
  let activeKey = tabs[0]!.key;
  const cur = (): Tab => tabs.find((t) => t.key === activeKey) ?? tabs[0]!;
  const placeOf = (t: Tab): Place => t.history[t.at]!;

  const save = (): void => {
    const key = deps.storeKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({ tabs: tabs.map((t) => ({ history: t.history, at: t.at })), active: tabs.findIndex((t) => t.key === activeKey) }));
    } catch {
      /* (no storage: the tabs last this run) */
    }
  };

  const render = (): void => {
    strip.innerHTML = `
      <button type="button" class="tab-side tab-side-left" data-tabs="left" aria-label="Show the left sidebar" title="Show the left sidebar">${ICONS.panelLeft}</button>
      <div class="tab-list" role="tablist" aria-label="Open tabs">${tabs
        .map((t) => {
          const d = deps.describe(placeOf(t));
          const on = t.key === activeKey;
          return `<div class="tab${on ? " is-active" : ""}" role="presentation"><button type="button" role="tab" class="tab-main" data-tab="${t.key}" data-testid="tab" aria-selected="${on}" title="${esc(d.title)}">${d.icon}<span class="tab-title">${esc(d.title)}</span></button><button type="button" class="tab-close" data-tab-close="${t.key}" aria-label="Close ${esc(d.title)}" title="Close (middle click)">${ICONS.x}</button></div>`;
        })
        .join("")}<button type="button" class="tab-new" data-tabs="new" data-testid="tab-new" aria-label="New tab" title="New tab">${ICONS.plus}</button></div>
      <button type="button" class="tab-side tab-side-right" data-tabs="right" aria-label="Show the right sidebar" title="Show the right sidebar">${ICONS.panelRight}</button>`;
    const t = cur();
    const d = deps.describe(placeOf(t));
    head.innerHTML = `
      <button type="button" class="layer-btn" data-tabs="back" data-testid="tab-back" aria-label="Back" title="Back"${t.at > 0 ? "" : " disabled"}>${ICONS.arrowLeft}</button>
      <button type="button" class="layer-btn is-forward" data-tabs="forward" data-testid="tab-forward" aria-label="Forward" title="Forward"${t.at < t.history.length - 1 ? "" : " disabled"}>${ICONS.arrowLeft}</button>
      <nav class="view-path" aria-label="Where this is" data-testid="view-path">${d.path.map((p, i) => `<span class="view-crumb${i === d.path.length - 1 ? " is-here" : ""}">${esc(p)}</span>`).join(`<span class="view-sep" aria-hidden="true">/</span>`)}</nav>
      ${placeOf(t).kind === "file" || placeOf(t).kind === "library" ? `<button type="button" class="layer-btn view-split" data-command="tab.split" data-testid="view-split" aria-label="Open beside the canvas" title="Open beside the canvas (a split)">${ICONS.columns2}</button>` : ""}
      ${placeOf(t).kind === "canvas" ? `<button type="button" class="layer-btn view-bookmark" data-command="bookmark.add" data-testid="view-bookmark" aria-label="Bookmark this view" title="Bookmark this view">${ICONS.bookmark}</button>` : ""}
      ${placeOf(t).kind === "canvas" ? `<button type="button" class="layer-btn view-more" data-tabs="menu" data-testid="view-more" aria-haspopup="menu" aria-expanded="false" aria-label="More for this view" title="More: views, pattern, background, information, names, Zen">${ICONS.ellipsis}</button>` : ""}`;
  };

  const showActive = (): void => {
    render();
    save();
    deps.show(placeOf(cur()));
  };
  const api: Tabs = {
    follow(place) {
      const t = cur();
      if (same(placeOf(t), place)) return render();
      t.history = [...t.history.slice(0, t.at + 1), place];
      t.at = t.history.length - 1;
      render();
      save();
    },
    open(place) {
      const t: Tab = { key: newKey(), history: [place], at: 0 };
      tabs.splice(tabs.indexOf(cur()) + 1, 0, t);
      activeKey = t.key;
      showActive();
    },
    close(key = activeKey) {
      const i = tabs.findIndex((t) => t.key === key);
      if (i < 0) return;
      tabs.splice(i, 1);
      // (the last one closed: a new tab's start page, never no tab at all)
      if (!tabs.length) tabs = [{ key: newKey(), history: [{ kind: "start" }], at: 0 }];
      if (key === activeKey) activeKey = (tabs[i] ?? tabs[i - 1] ?? tabs[0]!).key;
      showActive();
    },
    activate(key) {
      if (key === activeKey || !tabs.some((t) => t.key === key)) return;
      activeKey = key;
      showActive();
    },
    step(by) {
      const i = tabs.indexOf(cur());
      api.activate(tabs[(i + by + tabs.length) % tabs.length]!.key);
    },
    back() {
      const t = cur();
      if (t.at <= 0) return false;
      t.at -= 1;
      showActive();
      return true;
    },
    forward() {
      const t = cur();
      if (t.at < t.history.length - 1) (t.at += 1), showActive();
    },
    refresh: render,
    restore(fallback) {
      type Kept = { tabs?: Array<{ history?: Place[]; at?: number }>; active?: number };
      const read = (): Kept | null => {
        try {
          const key = deps.storeKey();
          return key ? (JSON.parse(localStorage.getItem(key) ?? "null") as Kept | null) : null;
        } catch {
          return null;
        }
      };
      const kept = read();
      const back = (kept?.tabs ?? [])
        .map((t) => {
          const history = (t.history ?? []).filter((p) => p && typeof p === "object" && ["canvas", "library", "start", "file"].includes(p.kind) && deps.valid(p));
          return history.length ? { key: newKey(), history, at: Math.min(Math.max(0, t.at ?? history.length - 1), history.length - 1) } : null;
        })
        .filter((t): t is Tab => t !== null);
      tabs = back.length ? back : [{ key: newKey(), history: [fallback], at: 0 }];
      activeKey = (tabs[kept?.active ?? 0] ?? tabs[0]!).key;
      showActive();
    },
    owns: (key) => tabs.some((t) => t.key === key),
    get active() {
      return placeOf(cur());
    },
    get count() {
      return tabs.length;
    },
  };

  // commands: tab.new, tab.close, tab.split, bookmark.add, layout.leftSidebar, layout.rightSidebar; choosing a tab, Back and Forward are view state (where the tab is)
  const onClick = (e: MouseEvent): void => {
    const t = e.target as HTMLElement;
    const close = t.closest<HTMLElement>("[data-tab-close]")?.dataset["tabClose"];
    if (close) return void pressCommand("tab.close", { tab: close });
    const tab = t.closest<HTMLElement>("[data-tab]")?.dataset["tab"];
    if (tab) return api.activate(tab); // view-state: (the tab shown)
    const what = t.closest<HTMLElement>("[data-tabs]")?.dataset["tabs"];
    if (what === "new") void pressCommand("tab.new");
    else if (what === "left") void pressCommand("layout.leftSidebar");
    else if (what === "right") void pressCommand("layout.rightSidebar");
    else if (what === "back") api.back(); // view-state: (the tab's own history)
    else if (what === "forward") api.forward(); // view-state: (the tab's own history)
    else if (t.closest("[data-command='tab.split']")) void pressCommand("tab.split");
    else if (t.closest("[data-command='bookmark.add']")) void pressCommand("bookmark.add");
    else if (what === "menu") deps.openMenu(api.active, t.closest<HTMLElement>("[data-tabs]")!); // (each row of the menu runs its command)
  };
  // commands: tab.new, tab.close, layout.leftSidebar, layout.rightSidebar (through onClick)
  strip.addEventListener("click", onClick);
  // commands: (Back and Forward through onClick: view state; the ⋯ menu's rows run theirs)
  head.addEventListener("click", onClick);
  // commands: tab.close (a middle click on a tab)
  strip.addEventListener("auxclick", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset["tab"];
    if (e.button === 1 && tab) void pressCommand("tab.close", { tab });
  });
  // A tab dragged down onto the right half of the view opens beside the canvas (a split: a file's or the Library's tab); the half lights while
  // the tab is over it.
  // commands: tab.split (a tab dropped on the right half of the view)
  strip.addEventListener("pointerdown", (e) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset["tab"];
    if (!key || e.button !== 0 || strip.classList.contains("tabbar-split")) return; // (the split's own tabs are beside the canvas already)
    const place = tabs.find((t) => t.key === key);
    if (!place || !["file", "library"].includes(placeOf(place).kind)) return;
    const root = document.documentElement;
    const over = (ev: PointerEvent): boolean => {
      const box = strip.getBoundingClientRect();
      return ev.clientY > box.bottom + 40 && ev.clientX > box.left + box.width / 2 && ev.clientX < box.right;
    };
    const move = (ev: PointerEvent): void => {
      if (over(ev)) root.dataset["splitDrop"] = "on";
      else delete root.dataset["splitDrop"];
    };
    const up = (ev: PointerEvent): void => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      delete root.dataset["splitDrop"];
      if (!over(ev)) return;
      api.activate(key);
      void pressCommand("tab.split");
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  });
  // commands: tab.new (a double click on the strip's empty room)
  strip.addEventListener("dblclick", (e) => {
    if (!(e.target as HTMLElement).closest("button")) void pressCommand("tab.new");
  });
  render();
  return api;
}
