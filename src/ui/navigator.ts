import type { Session } from "../app/session";
import { boardFilterHtml, boardFilterState, wireBoardFilter } from "./board-filter";
import { plural } from "../doc/plural";
import { confirmDialog } from "./confirm";
import { esc } from "./format";
import { closeMoreMenu, openMoreMenu, pressAs } from "./more-menu";
import type { MenuItem } from "./more-menu";
import { ARCHIVE_ACCEPT, runExport, runExportFiles, runImport } from "./archive-ui";
import { ICONS } from "./icons";
import type { AppView } from "./view-switch";
import { canSwitchWorkspace, openWorkspaceSwitcher } from "./workspace-switch";

/**
 * Board › Canvas navigator (top-left, the first control) and the read-only banner (ADR 0079).
 * It is also the Canvas view's tab: one pill, "Board 1 › Canvas 1" and its arrow, so the word Canvas is not said twice. Pressing the name goes to
 * the Canvas view (and, when already there, opens the menu); the chevron always opens the menu, which lists boards and their canvases
 * with create, rename and export actions. Everything is a button or input, so it is keyboard-usable; Escape closes the menu.
 * Returns a function that tells it which view is open.
 */
export function mountNavigator(root: HTMLElement, session: Session, openCanvasView: () => void): (v: AppView) => void {
  const filter = boardFilterState(); // (what is typed in the menu's search field, kept while it is drawn again)
  root.innerHTML = `
    <div class="nav">
      <div class="nav-pill" data-cmd-group="Navigate" data-testid="workspace-nav" data-active="true">
        <button type="button" class="nav-crumb" data-testid="view-canvas" aria-current="page" aria-label="Canvas view" title="Canvas view">${ICONS.infinity}</button>
        <button type="button" class="nav-name-btn" data-testid="workspace-chevron" aria-haspopup="true" aria-expanded="false" title="Switch board or canvas"><span class="nav-crumb-text"></span>${ICONS.chevronDown}</button>
      </div>
      <div class="nav-menu" role="menu" data-testid="workspace-menu" hidden></div>
    </div>
    <div class="readonly-banner" role="alert" data-testid="readonly-banner" hidden>
      <span>Read-only — this workspace is open for editing in another tab.</span>
      <button type="button" data-action="take-over">Take over</button>
    </div>`;
  const crumb = root.querySelector<HTMLButtonElement>(".nav-crumb")!;
  const crumbText = root.querySelector<HTMLElement>(".nav-crumb-text")!;
  const chev = root.querySelector<HTMLButtonElement>(".nav-name-btn")!;
  const pill = root.querySelector<HTMLElement>(".nav-pill")!;
  let view: AppView = "canvas";
  const menu = root.querySelector<HTMLElement>(".nav-menu")!;
  const banner = root.querySelector<HTMLElement>(".readonly-banner")!;
  let renaming: { kind: "board" | "canvas" | "workspace"; id: string } | null = null;
  /** The board or canvas whose actions are open (the "More" button of its row). */
  const rowMenus = new Map<string, { label: string; items: MenuItem[] }>();

  const renderMenu = (): void => {
    const tree = session.tree;
    if (!tree) {
      menu.innerHTML = `<p class="nav-empty">Storage unavailable: one unsaved canvas.</p>`;
      return;
    }
    const cur = session.current;
    const label = (kind: "board" | "canvas", id: string, name: string, extra: string): string =>
      renaming && renaming.kind === kind && renaming.id === id
        ? `<input class="nav-rename" data-rename="${kind}" data-id="${id}" value="${esc(name)}" aria-label="New ${kind} name">`
        : extra;
    /** The actions of a board or canvas, opened by its More button in the shared menu. */
    const boards = tree.boards;
    const actions = (kind: "board" | "canvas", id: string, name: string, canDelete: boolean, why: string, first: boolean, last: boolean, here: string): string => {
      const row = (action: string, label: string, hint: string, icon: string, aria: string, more: Partial<MenuItem> = {}, attrs: Record<string, string> = {}): MenuItem => ({
        label, hint, icon, aria, ...more, run: () => pressAs(menu, { "data-action": action, "data-id": id, ...attrs }),
      });
      rowMenus.set(`${kind}:${id}`, {
        label: `Actions for ${kind} ${name}`,
        items: [
          row(`rename-${kind}`, "Rename", "Give it a new name", ICONS.textCursorInput, `Rename ${kind} ${name}`),
          row(`duplicate-${kind}`, "Duplicate", "Make a copy", ICONS.copy, `Duplicate ${kind} ${name}`),
          row(`up-${kind}`, "Move up", "Earlier in the list", ICONS.arrowUp, `Move ${kind} ${name} up`, { disabled: first }),
          row(`down-${kind}`, "Move down", "Later in the list", ICONS.arrowDown, `Move ${kind} ${name} down`, { disabled: last }),
          ...(kind === "canvas" && boards.length > 1
            ? boards.filter((b) => b.board.id !== here).map((b) => row("to-board", `Move to ${b.board.name}`, "Another board", ICONS.squareStack, `Move canvas ${name} to board ${b.board.name}`, {}, { "data-board": b.board.id }))
            : []),
          row(`export-${kind}`, "Export to a file", "A file to keep or share", ICONS.fileOutput, `Export ${kind} ${name}`),
          row(`export-files-${kind}`, "Export files as ZIP", "The files it uses", ICONS.fileArchive, `Export the files of ${kind} ${name} as a ZIP`),
          row(`delete-${kind}`, "Delete", canDelete ? "Remove it" : why, ICONS.trash2, `Delete ${kind} ${name}`, { danger: true, disabled: !canDelete }),
        ],
      });
      return `<button type="button" class="nav-more" data-action="more" data-kind="${kind}" data-id="${id}" aria-haspopup="menu" aria-expanded="false"
          aria-label="More actions for ${kind} ${esc(name)}" title="More: rename, export, delete">${ICONS.ellipsis}</button>`;
    };
    menu.innerHTML =
      boardFilterHtml(filter, "nav-find") +
      tree.boards
        .map(({ board, canvases }) => {
          const head = label(
            "board",
            board.id,
            board.name,
            `<span class="nav-board-icon" title="A board is a group of canvases">${ICONS.squareStack}</span><span class="nav-board-name">${esc(board.name)}</span><span class="nav-board-n">${canvases.length} ${canvases.length === 1 ? "canvas" : "canvases"}</span>
             ${actions("board", board.id, board.name, tree.boards.length > 1, "A workspace keeps one board", tree.boards[0]!.board.id === board.id, tree.boards[tree.boards.length - 1]!.board.id === board.id, board.id)}`,
          );
          const items = canvases
            .map((c) => {
              const active = cur?.canvasId === c.id;
              return `<li class="nav-canvas-row">${label(
                "canvas",
                c.id,
                c.name,
                `<button type="button" role="menuitemradio" aria-checked="${active}" class="nav-canvas${active ? " is-active" : ""}" data-action="open" data-id="${c.id}"><span class="nav-name">${esc(c.name)}</span><span class="nav-count">${c.objectCount === 0 ? "empty" : `${c.objectCount} object${c.objectCount === 1 ? "" : "s"}`}</span></button>
                 ${actions("canvas", c.id, c.name, canvases.length > 1, "A board keeps one canvas", canvases[0]!.id === c.id, canvases[canvases.length - 1]!.id === c.id, board.id)}`,
              )}</li>`;
            })
            .join("");
          return `<section class="nav-board" aria-label="Board ${esc(board.name)}">
            <div class="nav-board-head">${head}</div>
            <ul class="nav-canvases">${items}</ul>
            <button type="button" class="nav-add" data-action="new-canvas" data-id="${board.id}">+ New canvas</button>
          </section>`;
        })
        .join("") +
      `<button type="button" class="nav-add nav-add-board" data-action="new-board">+ New board</button>
       <section class="nav-ws" aria-label="The whole workspace">
         ${
           renaming?.kind === "workspace"
             ? `<input class="nav-rename" data-rename="workspace" data-id="${tree.workspace.id}" value="${esc(tree.workspace.displayName)}" aria-label="New workspace name" maxlength="120">`
             : `<h3><span class="nav-ws-name">Whole workspace “${esc(tree.workspace.displayName)}”</span>${session.readOnly ? "" : `<button type="button" class="nav-ws-rename" data-action="rename-workspace" data-id="${tree.workspace.id}" aria-label="Rename the workspace ${esc(tree.workspace.displayName)}" title="Rename the workspace">${ICONS.textCursorInput}</button>`}</h3>`
         }
         <button type="button" data-action="export-workspace" data-testid="nav-export-workspace">${ICONS.hardDriveDownload}<span>Export a backup (.canvast)</span></button>
         <button type="button" data-action="export-files-workspace" data-testid="nav-export-files">${ICONS.fileArchive}<span>Export all files as ZIP</span></button>
         <button type="button" data-action="import-archive" data-testid="nav-import"${session.readOnly ? ' disabled title="Read-only: another tab is editing"' : ""}>${ICONS.arrowDownToLine}<span>Import a file…</span></button>
         <input type="file" multiple accept="${ARCHIVE_ACCEPT}" hidden data-testid="nav-import-input">
         ${canSwitchWorkspace() ? `<button type="button" data-action="switch-workspace" data-testid="nav-switch-workspace" aria-haspopup="menu">${ICONS.arrowLeftRight}<span>Switch workspace…</span></button>` : ""}
       </section>`;
    wireBoardFilter(menu, { board: ".nav-board", head: ".nav-board-head", row: ".nav-canvas-row", current: (s) => !!s.querySelector(".nav-canvas.is-active") }, filter);
    const input = menu.querySelector<HTMLInputElement>(".nav-rename");
    if (input) {
      input.focus();
      input.select();
    }
  };

  const render = (): void => {
    const tree = session.tree;
    const cur = session.current;
    const entry = tree?.boards.find((b) => b.board.id === cur?.boardId);
    const canvas = entry?.canvases.find((c) => c.id === cur?.canvasId);
    // Each name is cut with an ellipsis to its own room (CSS), so a long name never pushes the tabs beside the pill; the full names are in the tooltip.
    if (entry && canvas) crumbText.innerHTML = `<span class="nav-crumb-board">${esc(entry.board.name)}</span><span class="nav-crumb-sep"> › </span><span class="nav-crumb-canvas">${esc(canvas.name)}</span>`;
    else crumbText.textContent = "Canvas";
    chev.title = tree && entry && canvas ? `${tree.workspace.displayName} › ${entry.board.name} › ${canvas.name}. Switch board or canvas` : "Switch board or canvas";
    banner.hidden = !session.readOnly;
    if (!menu.hidden) renderMenu();
  };

  const setOpen = (open: boolean): void => {
    menu.hidden = !open;
    chev.setAttribute("aria-expanded", String(open));
    if (open) renderMenu();
    else {
      renaming = null;
      closeMoreMenu();
    }
  };

  // The infinity button is the Canvas view's tab: from another view it goes there; on the canvas it opens the menu. The name with its arrow (one control, floating without a box) always opens the menu.
  crumb.addEventListener("click", () => (view === "canvas" ? setOpen(menu.hidden === true) : openCanvasView()));
  chev.addEventListener("click", () => setOpen(menu.hidden === true));
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden && !renaming) {
      setOpen(false);
      chev.focus();
      e.stopPropagation();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !root.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".pop-menu")) setOpen(false);
  });

  menu.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset["testid"] !== "nav-import-input") return;
    const files = [...(input.files ?? [])];
    input.value = "";
    if (!files.length) return;
    setOpen(false);
    void runImport(session, files);
  });
  menu.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    const id = b.dataset["id"] ?? "";
    if (b.dataset["action"] === "more") {
      const row = rowMenus.get(`${b.dataset["kind"]}:${id}`);
      if (row) openMoreMenu(b, row.items, row.label);
      return;
    }
    switch (b.dataset["action"]) {
      case "open":
        void session.openCanvas(id).then(() => setOpen(false));
        break;
      case "new-board":
        void session.newBoard().then(() => setOpen(false));
        break;
      case "new-canvas":
        void session.newCanvas(id).then(() => setOpen(false));
        break;
      case "rename-board":
        renaming = { kind: "board", id };
        renderMenu();
        break;
      case "rename-workspace":
        renaming = { kind: "workspace", id };
        renderMenu();
        break;
      case "rename-canvas":
        renaming = { kind: "canvas", id };
        renderMenu();
        break;
      case "export-workspace":
        setOpen(false);
        void runExport(session, { kind: "workspace" });
        break;
      case "export-files-workspace":
        setOpen(false);
        void runExportFiles(session, { kind: "workspace" });
        break;
      case "export-files-board":
        setOpen(false);
        void runExportFiles(session, { kind: "board", boardId: id });
        break;
      case "export-files-canvas":
        setOpen(false);
        void runExportFiles(session, { kind: "canvas", canvasId: id });
        break;
      case "import-archive":
        menu.querySelector<HTMLInputElement>('[data-testid="nav-import-input"]')?.click();
        break;
      case "switch-workspace":
        void openWorkspaceSwitcher(b);
        break;
      case "export-board":
        setOpen(false);
        void runExport(session, { kind: "board", boardId: id });
        break;
      case "export-canvas":
        setOpen(false);
        void runExport(session, { kind: "canvas", canvasId: id });
        break;
      case "duplicate-canvas":
        setOpen(false);
        void session.duplicateCanvas(id);
        break;
      case "duplicate-board":
        setOpen(false);
        void session.duplicateBoard(id);
        break;
      case "up-canvas":
      case "down-canvas": {
        const entry = session.tree?.boards.find((bd) => bd.canvases.some((c) => c.id === id));
        const at = entry?.canvases.findIndex((c) => c.id === id) ?? -1;
        if (entry && at >= 0) void session.moveCanvas(id, entry.board.id, at + (b.dataset["action"] === "up-canvas" ? -1 : 1));
        break;
      }
      case "up-board":
      case "down-board": {
        const at = session.tree?.boards.findIndex((bd) => bd.board.id === id) ?? -1;
        if (at >= 0) void session.moveBoard(id, at + (b.dataset["action"] === "up-board" ? -1 : 1));
        break;
      }
      case "to-board": {
        const target = session.tree?.boards.find((bd) => bd.board.id === b.dataset["board"]);
        if (target) void session.moveCanvas(id, target.board.id, target.canvases.length);
        setOpen(false);
        break;
      }
      case "delete-canvas":
        void confirmDeleteCanvas(id);
        break;
      case "delete-board":
        void confirmDeleteBoard(id);
        break;
    }
  });

  const KEPT = "Images placed on it stay in the library. This cannot be undone.";
  const confirmDeleteCanvas = async (id: string): Promise<void> => {
    const entry = session.tree?.boards.find((b) => b.canvases.some((c) => c.id === id));
    const c = entry?.canvases.find((x) => x.id === id);
    if (!entry || !c) return;
    setOpen(false);
    const ok = await confirmDialog({
      title: `Delete canvas “${c.name}”?`,
      lines: [`It holds ${plural(c.objectCount, "object")} on board “${entry.board.name}”.`, KEPT],
      confirmLabel: "Delete canvas",
    });
    if (ok) await session.deleteCanvas(id);
    crumb.focus();
  };
  const confirmDeleteBoard = async (id: string): Promise<void> => {
    const entry = session.tree?.boards.find((b) => b.board.id === id);
    if (!entry) return;
    setOpen(false);
    const objects = entry.canvases.reduce((n, c) => n + c.objectCount, 0);
    const ok = await confirmDialog({
      title: `Delete board “${entry.board.name}”?`,
      lines: [`Its ${plural(entry.canvases.length, "canvas", "canvases")} and ${plural(objects, "object")} will be deleted.`, KEPT],
      confirmLabel: "Delete board",
    });
    if (ok) await session.deleteBoard(id);
    crumb.focus();
  };
  menu.addEventListener("keydown", (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains("nav-rename")) return;
    if (e.key === "Enter") {
      const { rename, id } = input.dataset;
      renaming = null;
      if (rename === "board") void session.renameBoard(id!, input.value);
      else if (rename === "workspace") void session.renameWorkspace(input.value);
      else void session.renameCanvas(id!, input.value);
      e.preventDefault();
    } else if (e.key === "Escape") {
      renaming = null;
      renderMenu();
      e.preventDefault();
      e.stopPropagation();
    }
  });
  banner.querySelector("button")!.addEventListener("click", () => void session.takeOver());

  session.subscribe(render);
  render();
  return (v) => {
    view = v;
    pill.dataset["active"] = String(v === "canvas");
    if (v === "canvas") crumb.setAttribute("aria-current", "page");
    else crumb.removeAttribute("aria-current");
    if (v !== "canvas") setOpen(false);
  };
}
