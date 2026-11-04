/** Delete library items with every instance of them, from the library or a canvas: one question, one way. */
import type { Session } from "../app/session";
import { plural } from "../doc/plural";
import { desktopBridge } from "../storage/desktop-bridge";
import { confirmDialog } from "./confirm";

export interface DeleteEverywhere {
  hashes: readonly string[];
  /** The one item's name, or none for several. */
  name?: string | undefined;
  uses: number;
  canvases: number;
  /** Where the one item is, as a board and canvas, when known. */
  places?: readonly string[];
}

/** Asked, then done: whether it was. */
export async function deleteEverywhere(session: Session, d: DeleteEverywhere): Promise<boolean> {
  const one = d.hashes.length === 1;
  const places = d.places ?? [];
  const named = places.slice(0, 3).join(", ");
  const where = one && places.length ? (places.length > 3 ? `${named} and ${plural(places.length - 3, "other canvas", "other canvases")}` : named) : null;
  const ok = await confirmDialog({
    title: `Delete ${one ? `“${d.name || "Untitled"}”` : plural(d.hashes.length, "item")} everywhere?`,
    lines: [
      `${one ? "It is" : "They are"} used ${plural(d.uses, "time")}${where ? ` on ${where}` : d.canvases ? ` on ${plural(d.canvases, "canvas", "canvases")} or more` : ""}. Those instances are removed too; a text that uses one as its font keeps its words in the default font.`,
      `On the open canvas Undo brings them back; on the other canvases they cannot be brought back. The files are erased from ${desktopBridge() ? "the workspace folder" : "this browser's storage"} once nothing can use them any more.`,
    ],
    confirmLabel: "Delete everywhere",
  });
  if (ok) await session.deleteAssetsEverywhere(d.hashes);
  return ok;
}
