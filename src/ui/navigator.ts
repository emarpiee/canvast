import type { Session } from "../app/session";
import { confirmDialog } from "./confirm";
import { esc } from "./format";
import { ARCHIVE_ACCEPT, runExport, runExportFiles, runImport } from "./archive-ui";
import { ICONS } from "./icons";

/**
 * Workspace › Board › Canvas navigator (top-left) and the read-only banner.
 * The breadcrumb button opens a menu listing boards and their canvases with
 * create and rename actions. Everything is a button or input, so it is
 * keyboard-usable; Escape closes the menu.
 */
export function mountNavigator(root: HTMLElement, session: Session): void {
  root.innerHTML = `
    <div class="nav">
      <button type="button" class="nav-crumb" data-testid="workspace-nav" aria-haspopup="true" aria-expanded="false"></button>
      <div class="nav-menu" role="menu" data-testid="workspace-menu" hidden></div>
    </div>
    <div class="readonly-banner" role="alert" data-testid="readonly-banner" hidden>
      <span>Read-only — this workspace is open for editing in another tab.</span>
      <button type="button" data-action="take-over">Take over</button>
    </div>`;
  const crumb = root.querySelector<HTMLButtonElement>(".nav-crumb")!;
  const menu = root.querySelector<HTMLElement>(".nav-menu")!;
  const banner = root.querySelector<HTMLElement>(".readonly-banner")!;
  let renaming: { kind: "board" | "canvas"; id: string } | null = null;
  /** The board or canvas whose actions are open (the "More" button of its row). */
  let actionsOf: { kind: "board" | "canvas"; id: string } | null = null;

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
    /** The labelled actions of a board or canvas, opened by its More button: plain words, not icons to guess at. */
    const actions = (kind: "board" | "canvas", id: string, name: string, canDelete: boolean, why: string): string => {
      const open = actionsOf?.kind === kind && actionsOf.id === id;
      return `<button type="button" class="nav-more" data-action="more" data-kind="${kind}" data-id="${id}" aria-haspopup="menu" aria-expanded="${open}"
          aria-label="More actions for ${kind} ${esc(name)}" title="More: rename, export, delete">${ICONS.ellipsis}</button>
        ${
          open
            ? `<div class="nav-actions" role="menu" aria-label="Actions for ${kind} ${esc(name)}">
                 <button type="button" role="menuitem" data-action="rename-${kind}" data-id="${id}" aria-label="Rename ${kind} ${esc(name)}">${ICONS.pencil}<span>Rename</span></button>
                 <button type="button" role="menuitem" data-action="export-${kind}" data-id="${id}" aria-label="Export ${kind} ${esc(name)}">${ICONS.download}<span>Export to a file</span></button>
                 <button type="button" role="menuitem" data-action="export-files-${kind}" data-id="${id}" aria-label="Export the files of ${kind} ${esc(name)} as a ZIP">${ICONS.download}<span>Export files as ZIP</span></button>
                 <button type="button" role="menuitem" class="is-danger" data-action="delete-${kind}" data-id="${id}" aria-label="Delete ${kind} ${esc(name)}"${canDelete ? "" : ` disabled title="${why}"`}>${ICONS.trash2}<span>Delete</span></button>
               </div>`
            : ""
        }`;
    };
    menu.innerHTML =
      tree.boards
        .map(({ board, canvases }) => {
          const head = label(
            "board",
            board.id,
            board.name,
            `<span class="nav-board-icon" title="A board is a group of canvases">${ICONS.layers}</span><span class="nav-board-name">${esc(board.name)}</span>
             ${actions("board", board.id, board.name, tree.boards.length > 1, "A workspace needs at least one board")}`,
          );
          const items = canvases
            .map((c) => {
              const active = cur?.canvasId === c.id;
              return `<li class="nav-canvas-row">${label(
                "canvas",
                c.id,
                c.name,
                `<button type="button" role="menuitemradio" aria-checked="${active}" class="nav-canvas${active ? " is-active" : ""}" data-action="open" data-id="${c.id}"><span class="nav-mark">${active ? ICONS.check : ""}</span><span class="nav-name">${esc(c.name)}</span><span class="nav-count">${c.objectCount === 0 ? "empty" : `${c.objectCount} object${c.objectCount === 1 ? "" : "s"}`}</span></button>
                 ${actions("canvas", c.id, c.name, canvases.length > 1, "A board needs at least one canvas; delete the board instead")}`,
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
         <h3>Whole workspace “${esc(tree.workspace.displayName)}”</h3>
         <button type="button" data-action="export-workspace" data-testid="nav-export-workspace">${ICONS.download}<span>Export a backup (.canvast)</span></button>
         <button type="button" data-action="export-files-workspace" data-testid="nav-export-files">${ICONS.download}<span>Export all files as ZIP</span></button>
         <button type="button" data-action="import-archive" data-testid="nav-import"${session.readOnly ? ' disabled title="Read-only: another tab is editing"' : ""}>${ICONS.upload}<span>Import a file…</span></button>
         <input type="file" accept="${ARCHIVE_ACCEPT}" hidden data-testid="nav-import-input">
       </section>`;
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
    crumb.textContent = entry && canvas ? `${entry.board.name} › ${canvas.name}` : "Canvas";
    crumb.title = tree ? `${tree.workspace.displayName} › ${crumb.textContent}` : "";
    banner.hidden = !session.readOnly;
    if (!menu.hidden) renderMenu();
  };

  const setOpen = (open: boolean): void => {
    menu.hidden = !open;
    crumb.setAttribute("aria-expanded", String(open));
    if (open) renderMenu();
    else {
      renaming = null;
      actionsOf = null;
    }
  };

  crumb.addEventListener("click", () => setOpen(menu.hidden === true));
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden && !renaming && actionsOf) {
      const was = actionsOf;
      actionsOf = null;
      renderMenu();
      menu.querySelector<HTMLElement>(`.nav-more[data-kind="${was.kind}"][data-id="${was.id}"]`)?.focus();
      e.stopPropagation();
    } else if (e.key === "Escape" && !menu.hidden && !renaming) {
      setOpen(false);
      crumb.focus();
      e.stopPropagation();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !root.contains(e.target as Node)) setOpen(false);
  });

  menu.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset["testid"] !== "nav-import-input") return;
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    setOpen(false);
    void runImport(session, f);
  });
  menu.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    const id = b.dataset["id"] ?? "";
    if (b.dataset["action"] === "more") {
      const kind = b.dataset["kind"] as "board" | "canvas";
      actionsOf = actionsOf?.kind === kind && actionsOf.id === id ? null : { kind, id };
      renderMenu();
      menu.querySelector<HTMLElement>(".nav-actions button:not(:disabled)")?.focus();
      return;
    }
    actionsOf = null; // any other press closes an open list of actions
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
      case "export-board":
        setOpen(false);
        void runExport(session, { kind: "board", boardId: id });
        break;
      case "export-canvas":
        setOpen(false);
        void runExport(session, { kind: "canvas", canvasId: id });
        break;
      case "delete-canvas":
        void confirmDeleteCanvas(id);
        break;
      case "delete-board":
        void confirmDeleteBoard(id);
        break;
    }
  });

  const KEPT = "Images placed on it stay in the Assets library. This cannot be undone.";
  const confirmDeleteCanvas = async (id: string): Promise<void> => {
    const entry = session.tree?.boards.find((b) => b.canvases.some((c) => c.id === id));
    const c = entry?.canvases.find((x) => x.id === id);
    if (!entry || !c) return;
    setOpen(false);
    const ok = await confirmDialog({
      title: `Delete canvas “${c.name}”?`,
      lines: [`It holds ${c.objectCount} object(s) on board “${entry.board.name}”.`, KEPT],
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
      lines: [`Its ${entry.canvases.length} canvas(es) and ${objects} object(s) will be deleted.`, KEPT],
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
}
