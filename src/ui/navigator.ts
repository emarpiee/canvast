import type { Session } from "../app/session";
import { isGuestPage, readOnlyLine, readOnlyWhy } from "../storage/guest-page";
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
import { NAV_COMMAND, navOptions, workspaceRowMenu } from "./workspace-menus";
import { commands, pressCommand } from "../commands/registry";
import { REASON } from "../commands/types";
import type { Command, Options, OptionSpec, Risk, RunContext } from "../commands/types";

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
        <button type="button" class="nav-crumb" data-view-state data-testid="view-canvas" aria-current="page" aria-label="Canvas view" title="Canvas view">${ICONS.infinity}</button>
        <button type="button" class="nav-name-btn" data-view-state data-testid="workspace-chevron" aria-haspopup="true" aria-expanded="false" title="Switch board or canvas"><span class="nav-crumb-text"></span>${ICONS.chevronDown}</button>
      </div>
      <div class="nav-menu" role="menu" data-testid="workspace-menu" hidden></div>
    </div>
    <div class="readonly-banner" role="alert" data-testid="readonly-banner" hidden>
      <span>${esc(readOnlyLine())}</span>
      ${isGuestPage() ? `<button type="button" data-testid="follow-host" aria-pressed="false" title="Go where the host is, on its canvas, as it moves; moving the view yourself stops it">Follow the host</button>` : `<button type="button" data-action="take-over">Take over</button>`}
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
    const actions = (kind: "board" | "canvas", id: string, name: string): string => {
      rowMenus.set(`${kind}:${id}`, workspaceRowMenu(tree, kind, id, (action, attrs) => pressAs(menu, { "data-action": action, "data-id": id, ...attrs })));
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
             ${actions("board", board.id, board.name)}`,
          );
          const items = canvases
            .map((c) => {
              const active = cur?.canvasId === c.id;
              return `<li class="nav-canvas-row${active ? " is-current" : ""}">${label(
                "canvas",
                c.id,
                c.name,
                `<button type="button" role="menuitemradio" aria-checked="${active}" class="nav-canvas${active ? " is-active" : ""}" data-action="open" data-id="${c.id}"><span class="nav-name">${esc(c.name)}</span><span class="nav-count">${c.objectCount === 0 ? "empty" : `${c.objectCount} object${c.objectCount === 1 ? "" : "s"}`}</span></button>
                 ${actions("canvas", c.id, c.name)}`,
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
         <button type="button" data-action="import-archive" data-testid="nav-import"${session.readOnly ? ` disabled title="Read-only: ${readOnlyWhy()}"` : ""}>${ICONS.arrowDownToLine}<span>Import a file…</span></button>
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
  crumb.addEventListener("click", () => (view === "canvas" ? setOpen(menu.hidden === true) : openCanvasView())); // view-state: (opens the list, or the canvas view)
  chev.addEventListener("click", () => setOpen(menu.hidden === true)); // view-state: (opens the list)
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

  // view-state: (the file picker of workspace.import)
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
    const action = b.dataset["action"] ?? "";
    // (renaming opens a field in the list; the switcher is a menu of its own: what they lead to are commands)
    if (action === "rename-board" || action === "rename-workspace" || action === "rename-canvas") {
      renaming = { kind: action.slice(7) as "board" | "workspace" | "canvas", id };
      return renderMenu();
    }
    if (action === "switch-workspace") return void openWorkspaceSwitcher(b);
    if (action === "import-archive") return void pressCommand("workspace.import");
    const cmd = NAV_COMMAND[action];
    if (!cmd) return;
    if (!["up-canvas", "down-canvas", "up-board", "down-board"].includes(action)) setOpen(false);
    pressCommand(cmd[0], navOptions(action, id, { "data-board": b.dataset["board"] ?? "" }));
  });

  // The boards' and canvases' commands (ADR 0205): the navigator's rows and menus run them, as the palette, a macro and an outside caller do.
  const ID: OptionSpec = { name: "id", type: "id", doc: "the canvas or board", required: true };
  const boardOf = (canvasId: string) => session.tree?.boards.find((bd) => bd.canvases.some((c) => c.id === canvasId));
  const hasCanvas = (o: Options): string | null => (boardOf(String(o["id"])) ? null : `There is no canvas "${String(o["id"])}".`);
  const hasBoard = (o: Options): string | null => (session.tree?.boards.some((bd) => bd.board.id === o["id"]) ? null : `There is no board "${String(o["id"])}".`);
  const nav = (id: string, title: string, hint: string, risk: Risk, options: readonly OptionSpec[], exec: (o: Options, ctx: RunContext) => Promise<unknown> | unknown, check?: (o: Options) => string | null): Command => ({
    id, group: "Boards and canvases", kind: "canvas", title, hint, risk, options, why: () => (session.tree ? null : REASON.noWorkspace),
    exec: async (o, ctx) => {
      const no = check?.(o);
      if (no) return { ok: false, error: no };
      await exec(o, ctx);
      return { ok: true };
    },
  });
  commands.setProvider("navigator-actions", () => [
    { id: "read.canvases", group: "Boards and canvases", kind: "canvas", title: "List the boards and canvases", hint: "Their ids and names, and which is open", risk: "read", why: () => (session.tree ? null : REASON.noWorkspace),
      exec: () => ({ ok: true, value: session.tree!.boards.map((b) => ({ id: b.board.id, name: b.board.name, canvases: b.canvases.map((c) => ({ id: c.id, name: c.name, items: c.objectCount, open: session.current?.canvasId === c.id })) })) }) },
    nav("canvas.openId", "Open a canvas", "By its id", "edit", [ID], (o) => session.openCanvas(String(o["id"])), hasCanvas),
    nav("canvas.newIn", "New canvas on a board", "An empty canvas", "edit", [{ ...ID, doc: "the board" }], (o) => session.newCanvas(String(o["id"])), hasBoard),
    nav("canvas.renameId", "Rename a canvas", "By its id", "edit", [ID, { name: "name", type: "text", doc: "the new name", required: true }], (o) => session.renameCanvas(String(o["id"]), String(o["name"])), hasCanvas),
    nav("board.renameId", "Rename a board", "By its id", "edit", [ID, { name: "name", type: "text", doc: "the new name", required: true }], (o) => session.renameBoard(String(o["id"]), String(o["name"])), hasBoard),
    nav("workspace.rename", "Rename the workspace", "Its name", "edit", [{ name: "name", type: "text", doc: "the new name", required: true }], (o) => session.renameWorkspace(String(o["name"]))),
    nav("canvas.duplicate", "Duplicate a canvas", "A copy on the same board", "edit", [ID], (o) => session.duplicateCanvas(String(o["id"])), hasCanvas),
    nav("board.duplicate", "Duplicate a board", "A copy with its canvases", "edit", [ID], (o) => session.duplicateBoard(String(o["id"])), hasBoard),
    nav("canvas.moveBy", "Move a canvas up or down", "In its board's list", "edit", [ID, { name: "by", type: "number", doc: "-1 up, 1 down", required: true, min: -1000, max: 1000 }], (o) => {
      const entry = boardOf(String(o["id"]))!;
      const at = entry.canvases.findIndex((c) => c.id === o["id"]);
      return session.moveCanvas(String(o["id"]), entry.board.id, at + Number(o["by"]));
    }, hasCanvas),
    nav("board.moveBy", "Move a board up or down", "In the list", "edit", [ID, { name: "by", type: "number", doc: "-1 up, 1 down", required: true, min: -1000, max: 1000 }], (o) => {
      const at = session.tree!.boards.findIndex((bd) => bd.board.id === o["id"]);
      return session.moveBoard(String(o["id"]), at + Number(o["by"]));
    }, hasBoard),
    nav("canvas.moveTo", "Move a canvas to a board", "At the end of it", "edit", [ID, { name: "board", type: "id", doc: "the board", required: true }], (o) => {
      const target = session.tree!.boards.find((bd) => bd.board.id === o["board"]);
      return target ? session.moveCanvas(String(o["id"]), target.board.id, target.canvases.length) : undefined;
    }, (o) => hasCanvas(o) ?? (session.tree?.boards.some((bd) => bd.board.id === o["board"]) ? null : `There is no board "${String(o["board"])}".`)),
    nav("canvas.delete", "Delete a canvas", "Its pictures stay in the library", "confirm", [ID], (o, ctx) => (ctx.caller === "agent" ? session.deleteCanvas(String(o["id"])) : confirmDeleteCanvas(String(o["id"]))), hasCanvas),
    nav("board.delete", "Delete a board", "With its canvases", "confirm", [ID], (o, ctx) => (ctx.caller === "agent" ? session.deleteBoard(String(o["id"])) : confirmDeleteBoard(String(o["id"]))), hasBoard),
    nav("canvas.export", "Export a canvas", "As a .canvast archive", "confirm", [ID], (o) => runExport(session, { kind: "canvas", canvasId: String(o["id"]) }), hasCanvas),
    nav("board.export", "Export a board", "As a .canvast archive", "confirm", [ID], (o) => runExport(session, { kind: "board", boardId: String(o["id"]) }), hasBoard),
    nav("canvas.exportFiles", "Export a canvas's files", "A ZIP of its library files", "confirm", [ID], (o) => runExportFiles(session, { kind: "canvas", canvasId: String(o["id"]) }), hasCanvas),
    nav("board.exportFiles", "Export a board's files", "A ZIP of its library files", "confirm", [ID], (o) => runExportFiles(session, { kind: "board", boardId: String(o["id"]) }), hasBoard),
    nav("workspace.exportFiles", "Export the workspace's files", "A ZIP of every library file", "confirm", [], () => runExportFiles(session, { kind: "workspace" })),
    nav("workspace.import", "Import a .canvast archive", "Boards, canvases and files from a backup", "confirm", [], () => menu.querySelector<HTMLInputElement>('[data-testid="nav-import-input"]')?.click()),
  ]);
  const KEPT = "Pictures placed on it stay in the library. This cannot be undone.";
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
      if (rename === "board") pressCommand("board.renameId", { id: id!, name: input.value });
      else if (rename === "workspace") pressCommand("workspace.rename", { name: input.value });
      else pressCommand("canvas.renameId", { id: id!, name: input.value });
      e.preventDefault();
    } else if (e.key === "Escape") {
      renaming = null;
      renderMenu();
      e.preventDefault();
      e.stopPropagation();
    }
  });
  // view-state: (this tab takes over writing the workspace from another tab: the person's own, on the spot)
  banner.querySelector('[data-action="take-over"]')?.addEventListener("click", () => void session.takeOver());

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
