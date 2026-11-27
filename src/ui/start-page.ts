import { ICONS } from "./icons";
import { esc } from "./format";
import { pressCommand } from "../commands/registry";
import type { Session } from "../app/session";

/**
 * A new tab's start page (B39): what to open in it (a new canvas or note, the Library) and the workspace's canvases, most recently changed
 * first. Every choice is a command; a canvas opens in this tab.
 */
export function mountStartPage(el: HTMLElement, session: Session): { render(): void } {
  const render = (): void => {
    const tree = session.tree;
    const canvases = (tree?.boards ?? []).flatMap((b) => b.canvases.map((c) => ({ c, board: b.board.name })));
    canvases.sort((a, b) => b.c.updatedAt - a.c.updatedAt);
    el.innerHTML = `
      <div class="start-inner">
        <h2 class="start-title">New tab</h2>
        <div class="start-actions" data-cmd-group="New tab">
          <button type="button" class="assets-btn" data-command="workspace.newCanvas" data-testid="start-new-canvas">${ICONS.infinity}<span>New canvas</span></button>
          <button type="button" class="assets-btn" data-command="library.newNote" data-testid="start-new-note">${ICONS.notebookPen}<span>New note</span></button>
          <button type="button" class="assets-btn" data-command="go.library" data-testid="start-library">${ICONS.images}<span>Open the Library</span></button>
        </div>
        ${canvases.length ? `<h3 class="start-head">Canvases</h3><ul class="start-list">${canvases
          .slice(0, 8)
          .map(({ c, board }) => `<li><button type="button" class="start-item" data-open-canvas="${esc(c.id)}">${ICONS.infinity}<span class="start-name">${esc(c.name)}</span><span class="start-meta">${esc(board)}</span></button></li>`)
          .join("")}</ul>` : ""}
      </div>`;
  };
  // commands: workspace.newCanvas, library.newNote, go.library, canvas.openId, go.canvas
  el.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const cmd = t.closest<HTMLElement>("[data-command]")?.dataset["command"];
    if (cmd) return void pressCommand(cmd);
    const id = t.closest<HTMLElement>("[data-open-canvas]")?.dataset["openCanvas"];
    if (id) {
      void pressCommand("canvas.openId", { id });
      void pressCommand("go.canvas");
    }
  });
  session.subscribe(() => !el.hidden && render());
  render();
  return { render };
}
