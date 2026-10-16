import { loadRecent, saveRecent } from "../search/history";
import type { RecentSearch, SearchWay } from "../search/history";
import { esc } from "./format";

/** The "Recent" chips of a search box (ADR 0071), the same in the canvas search and the library search. */
const PREFIX: Record<SearchWay, string> = { all: "", name: "/ ", tag: "# ", bookmark: "@ " };

/** Draw the chips into `box` (hidden when there are none or `show` is false). */
export function paintRecent(box: HTMLElement, key: string, show: boolean): void {
  const h = show ? loadRecent(key) : [];
  box.hidden = !h.length;
  box.innerHTML = h.length
    ? `<span class="cs-recent-title">Recent</span>${h
        .map((r, i) => `<span class="cs-chip"><button type="button" data-recent="${i}" title="Search again">${esc(PREFIX[r.m] + r.q)}</button><button type="button" data-forget="${i}" aria-label="Remove ${esc(r.q)} from recent searches" title="Remove">×</button></span>`)
        .join("")}<button type="button" class="cs-clear-all" data-forget-all>Clear recent</button>`
    : "";
}

/** One click does it: search again (`pick`), remove one, or clear all. `repaint` redraws the chips afterwards. */
export function wireRecent(box: HTMLElement, key: string, pick: (r: RecentSearch) => void, repaint: () => void): void {
  box.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const h = loadRecent(key);
    const chosen = t.closest<HTMLElement>("[data-recent]");
    const forget = t.closest<HTMLElement>("[data-forget]");
    if (chosen) {
      const r = h[Number(chosen.dataset["recent"])];
      if (r) pick(r);
    } else if (forget) {
      saveRecent(key, h.filter((_, i) => i !== Number(forget.dataset["forget"])));
      repaint();
    } else if (t.closest("[data-forget-all]")) {
      saveRecent(key, []);
      repaint();
    }
  });
}
