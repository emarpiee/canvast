import { useMediaAddress } from "../assets/thumb";
import { plural } from "../doc/plural";
import { desktopBridge } from "../storage/desktop-bridge";
import type { Storage } from "../storage/store";
import { currentBusy, openBusyScreen, type BusyScreen } from "../ui/busy-screen";
import { confirmDialog } from "../ui/confirm";
import { anyNoteDirty, leaveAllNotes } from "../ui/note-session";
import { installShareAsk, installShareFolder } from "../ui/share-panel";
import { sendView } from "./follow";
import type { Session } from "./session";
import type { ViewState } from "./view-state";

/** A write of this many files into the workspace folder (an import's) shows the busy screen and asks before closing; fewer go by quietly. */
const BUSY_FILES = 20;
/** From this many files encrypted at once (hiding them), the busy screen shows how far it is. */
const BUSY_SEALS = 5;
/**
 * The desktop build's session (ADR 0177): a device asking to see this workspace answered from anywhere (Settings > Sharing), hidden
 * media read a part at a time, the last edits written into the workspace folder before the window closes (asking first while files
 * are still being written, or a note has changes), and the busy screen while a long write runs.
 */
export interface DesktopSessionDeps {
  view: ViewState;
  session: Session;
  storage: Storage | null;
  /** The workspace is open: past the lock screen, its session started (before that nothing waits to be written). */
  opened(): boolean;
}

export function mountDesktopSession(d: DesktopSessionDeps): void {
  const { view, session, storage } = d;
  // The desktop build: before its window closes, the last edits reach the workspace folder (ADR 0177).
  // While files are still being written into the folder (an import's), closing asks first: the rest are written at the next start.
  // A device asking to see this workspace (Settings > Sharing) is answered from anywhere in the app.
  const share = desktopBridge()?.share;
  if (share) installShareAsk(share);
  if (share) sendView(view, session, share); // (for guests that follow: ADR 0184)
  if (share && storage?.hiddenFiles && storage.sharedThumb) installShareFolder(share, storage.hiddenFiles, storage.sharedThumb.bind(storage));
  // A hidden video or sound played as it is read: the desktop shell asks for each part, decrypted here (this page holds the key).
  const hiddenMedia = desktopBridge()?.hiddenMedia;
  const hiddenFiles = storage?.hiddenFiles;
  // (a video past the import limit gets a frame of it as its thumbnail, read from where it plays a part at a time)
  if (storage) useMediaAddress((h) => storage.originals.mediaUrl(h));
  if (hiddenMedia && hiddenFiles) hiddenMedia.onAsk((a) => void hiddenFiles.readHash(a.hash, a.from, a.to).catch(() => null).then((v) => hiddenMedia.answer(a.id, v)));
  desktopBridge()?.onClosing(async () => {
    if (!d.opened()) return; // (still locked or starting: nothing was changed, so nothing waits to be written)
    // A note open with changes not saved: Save them, Don't save, or Cancel (the window stays).
    if (anyNoteDirty()) {
      await desktopBridge()!.holdClose();
      if (!(await leaveAllNotes())) return false;
    }
    const writing = storage?.folderWriting?.now();
    if (writing && writing.total >= BUSY_FILES) {
      await desktopBridge()!.holdClose();
      const close = await confirmDialog({
        title: "Files are still being written",
        lines: [
          `${writing.done} of ${plural(writing.total, "file")} ${writing.done === 1 ? "is" : "are"} in the workspace folder so far.`,
          "Closing now stops it: your work is safe in the app, and the rest are written the next time you open this workspace. Keep the app open until it ends to have every file in the folder.",
        ],
        confirmLabel: "Close anyway",
      });
      if (!close) return false;
      await session.persistence.flush();
      await session.persistence.saveCamera();
      return; // (not waiting for the files)
    }
    await session.persistence.flush();
    await session.persistence.saveCamera();
    await storage?.flush();
  });
  // A long write of files into the workspace folder (an import's) keeps the app waiting, so nothing is changed half-way.
  let busy: BusyScreen | null = null;
  storage?.folderWriting?.subscribe((done, total, encrypting) => {
    if (!total) {
      busy?.close();
      busy = null;
      return;
    }
    const doing = encrypting === "placing" ? "Renaming hidden files into their encrypted folders" : encrypting ? "Encrypting hidden files" : "Writing the files into the workspace folder";
    const shown = currentBusy();
    if (shown && shown !== busy) return shown.update(done / total, `${doing}: ${done} of ${total}`); // (a task's own screen, as an import's: one bar)
    // (Encrypting reads each file back and opens it to prove it, so a few already take a while: shown from BUSY_SEALS on.)
    if (!busy && total < (encrypting === true ? BUSY_SEALS : BUSY_FILES)) return;
    busy ??=
      encrypting === "placing"
        ? openBusyScreen("Updating hidden items", ["Hidden files are renamed into encrypted folders and names, once, after this update. Nothing is encrypted again, so your sync tool sees renames. Keep the app open until it ends."])
        : encrypting
          ? openBusyScreen("Encrypting hidden items", ["Each file is encrypted into .hidden/, read back to prove it, and only then is the readable one deleted. Keep the app open until it ends."])
          : openBusyScreen("Writing the workspace to its folder", ["The files are copied into the workspace folder, so other programs and devices see them. Keep the app open until it ends."]);
    busy.update(done / total, `${encrypting === "placing" ? "Renaming" : encrypting ? "Encrypting" : "Writing"} ${done} of ${plural(total, "file")}`);
  });
}
