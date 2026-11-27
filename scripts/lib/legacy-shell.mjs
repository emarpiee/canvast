/**
 * The layout the scripts that drive the app were written for (B39), as the specs' harness sets it (tests/e2e/harness.ts, `legacyShell`):
 * `data-shell="legacy"` (no ribbon or tabs, the top-left buttons) and both sidebars hidden, so the canvas has the size it had. An init script:
 * `page.addInitScript(legacyShell)` or a context's, before the page loads.
 */
export function legacyShell() {
  const mark = () => !!document.documentElement && ((document.documentElement.dataset.shell = "legacy"), true);
  if (!mark()) new MutationObserver((_, o) => mark() && o.disconnect()).observe(document, { childList: true });
  try {
    const saved = JSON.parse(localStorage.getItem("canvast.settings") ?? "{}");
    if (!("ui.sidebarLeft" in saved)) localStorage.setItem("canvast.settings", JSON.stringify({ "ui.sidebarLeft": false, "ui.sidebarRight": false, ...saved }));
  } catch { /* (no storage: the app's own layout) */ }
}
