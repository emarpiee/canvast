import { ICONS } from "./icons";
import { esc } from "./format";
import { pressCommand } from "../commands/registry";

/** One pane of a sidebar (B39): its tab, and its body drawn the first time it shows. */
export interface SidebarPane {
  id: string;
  title: string;
  icon: string;
  /** Draws the pane into its body, once, the first time it shows. */
  mount(body: HTMLElement): void;
}

export interface Sidebar {
  /** A pane more, its tab at the end. */
  add(pane: SidebarPane): void;
  /** Show this pane (when it is there). */
  show(id: string): void;
  /** The pane shown, or null when it has none. */
  readonly active: string | null;
  /** The strip at its foot (the left one holds the workspace switcher); hidden while empty. */
  readonly foot: HTMLElement;
}

/**
 * A sidebar of the workspace (B39), the one implementation of both: a header of pane tabs and the button that hides it, the shown pane's body,
 * and a foot. Which pane shows is view state (`onShow` keeps it, `initial` brings it back); hiding the sidebar is its command.
 */
export function mountSidebar(el: HTMLElement, o: { side: "left" | "right"; label: string; toggleCommand: string; initial?: string | null; onShow?(id: string): void }): Sidebar {
  el.innerHTML = `
    <header class="sb-head">
      <div class="sb-tabs" role="tablist" aria-label="${esc(o.label)}"></div>
      <button type="button" class="layer-btn sb-collapse" data-command="${o.toggleCommand}" aria-label="Hide the ${o.side} sidebar" title="Hide the ${o.side} sidebar">${o.side === "left" ? ICONS.panelLeft : ICONS.panelRight}</button>
    </header>
    <div class="sb-body"></div>
    <footer class="sb-foot" hidden></footer>`;
  const tabs = el.querySelector<HTMLElement>(".sb-tabs")!;
  const body = el.querySelector<HTMLElement>(".sb-body")!;
  const foot = el.querySelector<HTMLElement>(".sb-foot")!;
  const panes = new Map<string, { pane: SidebarPane; box: HTMLElement; drawn: boolean }>();
  let active: string | null = null;
  const show = (id: string, chosen = false): void => {
    const p = panes.get(id);
    if (!p) return;
    active = id;
    for (const [k, q] of panes) {
      q.box.hidden = k !== id;
      tabs.querySelector(`[data-pane="${k}"]`)?.setAttribute("aria-selected", String(k === id));
    }
    if (!p.drawn) (p.drawn = true), p.pane.mount(p.box);
    if (chosen) o.onShow?.(id);
  };
  // view-state: (which pane a sidebar shows)
  tabs.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-pane]")?.dataset["pane"];
    if (id) show(id, true);
  });
  // commands: (the button that hides the sidebar runs its toggle command)
  el.querySelector(".sb-collapse")!.addEventListener("click", () => void pressCommand(o.toggleCommand));
  // (the foot shows only while something is in it)
  new MutationObserver(() => void (foot.hidden = !foot.childElementCount)).observe(foot, { childList: true });
  return {
    add(pane) {
      const box = document.createElement("div");
      box.className = "sb-pane";
      box.dataset["pane"] = pane.id;
      box.hidden = true;
      body.append(box);
      panes.set(pane.id, { pane, box, drawn: false });
      tabs.insertAdjacentHTML("beforeend", `<button type="button" role="tab" class="sb-tab" data-pane="${esc(pane.id)}" data-testid="pane-${esc(pane.id)}" aria-selected="false" aria-label="${esc(pane.title)}" title="${esc(pane.title)}">${pane.icon}</button>`);
      // (the first pane shows until the one kept from last time is added)
      if (active === null || o.initial === pane.id) show(pane.id);
    },
    show: (id) => show(id),
    get active() {
      return active;
    },
    foot,
  };
}
