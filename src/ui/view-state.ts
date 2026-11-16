import type { Session } from "../app/session";
import type { CatalogEntry } from "../assets/asset-catalog";
import { promptDialog } from "./confirm";
import { ICONS } from "./icons";
import type { MenuItem } from "./more-menu";
import { commands, pressCommand } from "../commands/registry";

/** A place in a file its viewer can go back to: `at` as its kind of file reads it (a PDF's page), `label` what the row says. */
export interface ViewMark {
  readonly at: string;
  readonly label: string;
}

/** What a viewer keeps for a file in its library item (`CatalogEntry.viewer`). */
export interface ViewState {
  /** Where it was left. */
  at?: string;
  marks: ViewMark[];
}

export const MAX_MARKS = 200;

export function viewStateOf(e: Pick<CatalogEntry, "viewer"> | undefined | null): ViewState {
  try {
    const r = JSON.parse(e?.viewer || "{}") as { at?: unknown; marks?: unknown };
    const marks = Array.isArray(r.marks) ? r.marks.filter((m): m is ViewMark => typeof m?.at === "string" && typeof m?.label === "string").slice(0, MAX_MARKS) : [];
    return { ...(typeof r.at === "string" ? { at: r.at } : {}), marks };
  } catch {
    return { marks: [] };
  }
}

/** Written quietly: a place in a file is no step of undo. */
export async function keepViewState(session: Session, hash: string, s: ViewState): Promise<void> {
  if (session.readOnly || !session.catalog) return;
  const viewer = s.at || s.marks.length ? JSON.stringify(s) : "";
  await session.catalog.updateMeta(hash, { viewer }).catch(() => undefined);
}

/**
 * What a view keeps of its file: `keep(state)` writes it only when it changed since the last write. A view calls it when a bookmark changes
 * and when it closes, never on each page turned or view turned: each write is a library change (on the desktop, a write of its files).
 */
export function viewKeeper(session: Session, hash: string, first: ViewState): (s: ViewState) => void {
  let last = JSON.stringify(first);
  return (s) => {
    const now = JSON.stringify(s);
    if (now === last) return;
    last = now;
    void keepViewState(session, hash, s);
  };
}

/** A bookmark put at `mark`, or taken off if it has one there; the list stays in file order by `order`. */
export function toggledMark(s: ViewState, mark: ViewMark, order: (at: string) => number): ViewState {
  const marks = s.marks.some((m) => m.at === mark.at) ? s.marks.filter((m) => m.at !== mark.at) : [...s.marks, mark].sort((a, b) => order(a.at) - order(b.at)).slice(0, MAX_MARKS);
  return { ...s, marks };
}

/** A change to the list of bookmarks, whoever holds it. */
export type MarksChange = (change: (marks: ViewMark[]) => ViewMark[]) => void;

/** The bookmarks whose menu was opened last (a view's, or a file's in the details): what the bookmark commands change. */
let holder: MarksChange | null = null;
commands.setProvider("file-bookmarks", () => (holder ? [
  { id: "file.renameBookmark", group: "Bookmarks", kind: "bookmark", title: "Rename a file's bookmark", hint: "Its name in the list", risk: "edit", why: () => null,
    options: [{ name: "at", type: "text", doc: "the bookmark's place", required: true }, { name: "name", type: "text", doc: "its new name", required: true }],
    exec: (o) => {
      const label = String(o["name"]).trim().slice(0, 120);
      if (!label) return { ok: false, error: "A name is needed." };
      holder!((marks) => marks.map((m) => (m.at === o["at"] ? { ...m, label } : m)));
      return { ok: true };
    } },
  { id: "file.deleteBookmark", group: "Bookmarks", kind: "bookmark", title: "Delete a file's bookmark", hint: "Only this bookmark", risk: "confirm", why: () => null,
    options: [{ name: "at", type: "text", doc: "the bookmark's place", required: true }],
    exec: (o) => void holder!((marks) => marks.filter((m) => m.at !== o["at"])) },
] : []));

/** What a bookmark's ⋯ offers, in a view's menu and in the details alike: each row runs a command (ADR 0205). */
export function markActions(mark: ViewMark, change: MarksChange): MenuItem[] {
  holder = change;
  return [
    {
      id: "mark-rename",
      label: "Rename",
      hint: "Its name in the list",
      icon: ICONS.textCursorInput,
      command: "file.renameBookmark",
      run: () => void promptDialog({ title: "Rename this bookmark", lines: [], value: mark.label, confirmLabel: "Rename" }).then((name) => {
        if (name?.trim()) pressCommand("file.renameBookmark", { at: mark.at, name });
      }),
    },
    { id: "mark-delete", label: "Delete", hint: "Only this bookmark", icon: ICONS.trash, danger: true, command: "file.deleteBookmark", run: () => void pressCommand("file.deleteBookmark", { at: mark.at }) },
  ];
}
