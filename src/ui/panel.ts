import { ICONS } from "./icons";

/**
 * The one shape of every floating panel (Layers, Bookmarks, Tags, Styles, Adjust): an optional header (title, count, tools, and always the
 * button that hides the panel), an optional strip under it that stays put (a filter, tabs), a body that scrolls, and an optional footer
 * that stays put. A panel needs only the parts it has; the CSS (`.panel-head`, `.panel-sub`, `.panel-body`, `.panel-foot`) does the rest.
 */
export interface PanelParts {
  /** The header: omit it for a panel that is all content. */
  title?: string;
  count?: number;
  /** Buttons in the header, before the one that hides the panel. */
  tools?: string;
  /** Stays under the header while the body scrolls. */
  sub?: string;
  body: string;
  /** Stays at the bottom while the body scrolls. */
  foot?: string;
}

export function panelHtml(p: PanelParts): string {
  const head = p.title
    ? `<header class="panel-head"><h2>${p.title}${p.count === undefined ? "" : ` <span class="layers-count">${p.count}</span>`}</h2><span class="layers-tools">${p.tools ?? ""}<button type="button" class="layer-btn" data-close aria-label="Hide the ${p.title} panel" title="Hide the ${p.title} panel">${ICONS.x}</button></span></header>`
    : "";
  return `${head}${p.sub ? `<div class="panel-sub">${p.sub}</div>` : ""}<div class="panel-body">${p.body}</div>${p.foot ? `<footer class="panel-foot">${p.foot}</footer>` : ""}`;
}
