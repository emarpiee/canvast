import { ICONS } from "./icons";
import type { MenuItem } from "./more-menu";
import type { WorkspaceTree } from "../app/session";

/**
 * The boards' and canvases' commands (ADR 0205), by the action a row or menu names: the command, and whether it takes no id. The Files pane
 * and the board and canvas menu run them, as the palette, a macro and an outside caller do.
 */
export const NAV_COMMAND: Readonly<Record<string, readonly [string, boolean?]>> = {
  open: ["canvas.openId"], "new-board": ["workspace.newBoard", true], "new-canvas": ["canvas.newIn"], "export-workspace": ["workspace.backup", true],
  "export-files-workspace": ["workspace.exportFiles", true], "export-files-board": ["board.exportFiles"], "export-files-canvas": ["canvas.exportFiles"],
  "export-board": ["board.export"], "export-canvas": ["canvas.export"], "duplicate-canvas": ["canvas.duplicate"], "duplicate-board": ["board.duplicate"],
  "up-canvas": ["canvas.moveBy"], "down-canvas": ["canvas.moveBy"], "up-board": ["board.moveBy"], "down-board": ["board.moveBy"], "to-board": ["canvas.moveTo"],
  "delete-canvas": ["canvas.delete"], "delete-board": ["board.delete"],
};

/** The options a row's action gives its command: its id, a step for a move, the board for a move to another board. */
export function navOptions(action: string, id: string, attrs: Record<string, string> = {}): Record<string, string | number> {
  const cmd = NAV_COMMAND[action];
  return { ...(cmd?.[1] ? {} : { id }), ...(action.startsWith("up-") ? { by: -1 } : action.startsWith("down-") ? { by: 1 } : {}), ...(action === "to-board" ? { board: attrs["data-board"] ?? "" } : {}) };
}

/**
 * The actions of one board or canvas (its More menu, wherever its row is): rename, duplicate, move up or down or to another board, export,
 * delete. `run` does an action (`rename-canvas`, `to-board` with `data-board`…): the caller's, as renaming happens in place.
 */
export function workspaceRowMenu(tree: WorkspaceTree, kind: "board" | "canvas", id: string, run: (action: string, attrs?: Record<string, string>) => void): { label: string; items: MenuItem[] } {
  const boards = tree.boards;
  const home = kind === "board" ? boards.find((b) => b.board.id === id) : boards.find((b) => b.canvases.some((c) => c.id === id));
  const siblings = kind === "board" ? boards.map((b) => b.board) : (home?.canvases ?? []);
  const at = siblings.findIndex((x) => x.id === id);
  const name = (kind === "board" ? home?.board.name : home?.canvases[at]?.name) ?? "";
  const canDelete = siblings.length > 1;
  const why = kind === "board" ? "A workspace keeps one board" : "A board keeps one canvas";
  const row = (action: string, label: string, hint: string, icon: string, aria: string, more: Partial<MenuItem> = {}, attrs: Record<string, string> = {}): MenuItem => ({
    label, hint, icon, aria, ...more, command: NAV_COMMAND[action]?.[0] ?? `${kind}.renameId`, run: () => run(action, attrs),
  });
  return {
    label: `Actions for ${kind} ${name}`,
    items: [
      row(`rename-${kind}`, "Rename", "Give it a new name", ICONS.textCursorInput, `Rename ${kind} ${name}`),
      row(`duplicate-${kind}`, "Duplicate", "Make a copy", ICONS.copy, `Duplicate ${kind} ${name}`),
      row(`up-${kind}`, "Move up", "Earlier in the list", ICONS.arrowUp, `Move ${kind} ${name} up`, { disabled: at <= 0 }),
      row(`down-${kind}`, "Move down", "Later in the list", ICONS.arrowDown, `Move ${kind} ${name} down`, { disabled: at === siblings.length - 1 }),
      ...(kind === "canvas" && boards.length > 1
        ? boards.filter((b) => b.board.id !== home?.board.id).map((b) => row("to-board", `Move to ${b.board.name}`, "Another board", ICONS.squareStack, `Move canvas ${name} to board ${b.board.name}`, {}, { "data-board": b.board.id }))
        : []),
      row(`export-${kind}`, "Export to a file", "A file to keep or share", ICONS.fileOutput, `Export ${kind} ${name}`),
      row(`export-files-${kind}`, "Export files as ZIP", "The files it uses", ICONS.fileArchive, `Export the files of ${kind} ${name} as a ZIP`),
      row(`delete-${kind}`, "Delete", canDelete ? "Remove it" : why, ICONS.trash2, `Delete ${kind} ${name}`, { danger: true, disabled: !canDelete }),
    ],
  };
}
