import { ICONS } from "./icons";
import { esc } from "./format";
import { openMoreMenu } from "./more-menu";
import type { MenuItem } from "./more-menu";
import { promptDialog } from "./confirm";
import { treeGuides, treeSlot, walkTree } from "./tree";
import { NAV_COMMAND, navOptions, workspaceRowMenu } from "./workspace-menus";
import { canSwitchWorkspace, openWorkspaceSwitcher } from "./workspace-switch";
import { pressCommand } from "../commands/registry";
import type { Session } from "../app/session";

/** The boards folded in the Files pane, kept on this device (view state). */
const FOLDED_KEY = "canvast.files.folded";
const readFolded = (): Set<string> => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
};

type Node = { kind: "board" | "canvas"; id: string; name: string; kids: Node[] };

/**
 * The Files pane (B39): the workspace's boards and their canvases as a tree in the left sidebar. A click on a canvas opens it; a board folds;
 * each row's More menu has its actions (the board and canvas menu, shared), and its foot is the workspace: its name and what is done with the
 * whole of it. Every action is a command.
 */
export function mountFilesPane(body: HTMLElement, o: { session: Session; foot: HTMLElement }): void {
  const { session } = o;
  body.innerHTML = `
    <div class="pane-actions" data-cmd-group="Files">
      <button type="button" class="layer-btn" data-files="new-canvas" data-testid="files-new-canvas" aria-label="New canvas" title="New canvas, on the open board">${ICONS.infinity}</button>
      <button type="button" class="layer-btn" data-files="new-board" data-testid="files-new-board" aria-label="New board" title="New board, with its first canvas">${ICONS.squareStack}</button>
      <button type="button" class="layer-btn" data-files="fold-all" data-testid="files-fold-all" aria-label="Fold every board" title="Fold every board">${ICONS.chevronsDownUp}</button>
    </div>
    <div class="files-tree" role="tree" aria-label="Boards and canvases" data-testid="files-tree"></div>`;
  const list = body.querySelector<HTMLElement>(".files-tree")!;
  o.foot.innerHTML = `<button type="button" class="files-ws" data-testid="files-workspace" aria-haspopup="menu" aria-expanded="false">${ICONS.folderOpen}<span class="files-ws-name"></span>${ICONS.chevronDown}</button>`;
  const wsButton = o.foot.querySelector<HTMLElement>(".files-ws")!;
  const folded = readFolded();
  const keepFolded = (): void => {
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify([...folded]));
    } catch {
      /* (no storage: folds last this run) */
    }
  };

  const render = (): void => {
    const tree = session.tree;
    wsButton.querySelector(".files-ws-name")!.textContent = tree?.workspace.displayName ?? "Workspace";
    if (!tree) {
      list.innerHTML = `<p class="pane-empty">Storage unavailable: one unsaved canvas.</p>`;
      return;
    }
    const cur = session.current?.canvasId;
    const roots: Node[] = tree.boards.map(({ board, canvases }) => ({ kind: "board", id: board.id, name: board.name, kids: canvases.map((c) => ({ kind: "canvas", id: c.id, name: c.name, kids: [] })) }));
    list.innerHTML = walkTree(roots, (n) => n.kids, (n) => !folded.has(n.id), (n, at) => {
      const here = n.kind === "canvas" && n.id === cur;
      return `<div class="tree-row files-row${here ? " is-current" : ""}" role="treeitem" style="--depth:${at.depth}" data-kind="${n.kind}" data-id="${esc(n.id)}" aria-selected="${here}"${at.hasKids ? ` aria-expanded="${at.open}"` : ""}>
        ${treeGuides(at.depth, at.last, at.conts)}${treeSlot(at, `data-twist="${esc(n.id)}"`)}
        <button type="button" class="files-item" data-open="${n.kind}" data-id="${esc(n.id)}" title="${esc(n.name)}">${n.kind === "board" ? ICONS.squareStack : ICONS.infinity}<span class="files-name">${esc(n.name)}</span></button>
        <button type="button" class="layer-btn files-more" data-more="${n.kind}" data-id="${esc(n.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${n.kind} ${esc(n.name)}" title="More: rename, export, delete">${ICONS.ellipsis}</button>
      </div>`;
    });
  };

  const rename = async (kind: "board" | "canvas" | "workspace", id: string, now: string): Promise<void> => {
    const name = await promptDialog({ title: `Rename the ${kind}`, lines: [], value: now, confirmLabel: "Rename" });
    if (name === null || !name.trim() || name === now) return;
    if (kind === "workspace") void pressCommand("workspace.rename", { name });
    else void pressCommand(`${kind}.renameId`, { id, name });
  };
  const nameOf = (kind: "board" | "canvas", id: string): string => {
    const tree = session.tree;
    if (!tree) return "";
    return kind === "board" ? (tree.boards.find((b) => b.board.id === id)?.board.name ?? "") : (tree.boards.flatMap((b) => b.canvases).find((c) => c.id === id)?.name ?? "");
  };
  /** A row's action: its command, or renaming it (a dialog that runs the rename command). */
  const act = (action: string, id: string, attrs: Record<string, string> = {}): void => {
    if (action === "rename-board" || action === "rename-canvas") return void rename(action.slice(7) as "board" | "canvas", id, nameOf(action.slice(7) as "board" | "canvas", id));
    const cmd = NAV_COMMAND[action];
    if (cmd) void pressCommand(cmd[0], navOptions(action, id, attrs));
  };

  // commands: canvas.openId, go.canvas, workspace.newCanvas, workspace.newBoard, and each row's More menu (NAV_COMMAND); a board's fold is view state
  body.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const tool = t.closest<HTMLElement>("[data-files]")?.dataset["files"];
    if (tool === "new-canvas") return void pressCommand("workspace.newCanvas");
    if (tool === "new-board") return void pressCommand("workspace.newBoard");
    if (tool === "fold-all") {
      // view-state: (every board folded)
      for (const b of session.tree?.boards ?? []) folded.add(b.board.id);
      keepFolded();
      return render();
    }
    const twist = t.closest<HTMLElement>("[data-twist]")?.dataset["twist"];
    const more = t.closest<HTMLElement>("[data-more]");
    if (more && session.tree) {
      const m = workspaceRowMenu(session.tree, more.dataset["more"] as "board" | "canvas", more.dataset["id"]!, (action, attrs) => act(action, more.dataset["id"]!, attrs));
      return void openMoreMenu(more, m.items, m.label);
    }
    const open = t.closest<HTMLElement>("[data-open]");
    const id = twist ?? (open?.dataset["open"] === "board" ? open.dataset["id"] : undefined);
    if (id) {
      // view-state: (a board folded or unfolded)
      if (folded.has(id)) folded.delete(id);
      else folded.add(id);
      keepFolded();
      return render();
    }
    if (open?.dataset["open"] === "canvas") {
      void pressCommand("canvas.openId", { id: open.dataset["id"]! });
      void pressCommand("go.canvas");
    }
  });
  // (double-click a name to rename it, as in the Layers panel)
  // commands: canvas.renameId, board.renameId (after the dialog)
  body.addEventListener("dblclick", (e) => {
    const open = (e.target as HTMLElement).closest<HTMLElement>("[data-open]");
    if (open) void rename(open.dataset["open"] as "board" | "canvas", open.dataset["id"]!, nameOf(open.dataset["open"] as "board" | "canvas", open.dataset["id"]!));
  });

  // The workspace, at the foot: its name, and what is done with the whole of it.
  // commands: workspace.rename, workspace.backup, workspace.exportFiles, workspace.import, workspace.switch
  wsButton.addEventListener("click", () => {
    const tree = session.tree;
    const items: MenuItem[] = [
      { label: "Rename", hint: "Give the workspace a new name", icon: ICONS.textCursorInput, command: "workspace.rename", disabled: !tree || session.readOnly, run: () => void rename("workspace", tree?.workspace.id ?? "", tree?.workspace.displayName ?? "") },
      { label: "Export a backup", hint: "The whole workspace in one .canvast file", icon: ICONS.hardDriveDownload, command: "workspace.backup", run: () => void pressCommand("workspace.backup") },
      { label: "Export all files as ZIP", hint: "Every file it uses", icon: ICONS.fileArchive, command: "workspace.exportFiles", run: () => void pressCommand("workspace.exportFiles") },
      { label: "Import a file…", hint: "A backup, a canvas or files", icon: ICONS.arrowDownToLine, command: "workspace.import", disabled: session.readOnly, run: () => void pressCommand("workspace.import") },
      ...(canSwitchWorkspace() ? [{ label: "Switch workspace…", hint: "Open another workspace folder", icon: ICONS.arrowLeftRight, command: "workspace.switch", run: () => void openWorkspaceSwitcher(wsButton) }] : []),
    ];
    openMoreMenu(wsButton, items, "The workspace");
  });

  session.subscribe(render);
  render();
}
