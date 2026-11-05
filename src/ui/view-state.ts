import type { Session } from "../app/session";
import type { CatalogEntry } from "../assets/asset-catalog";
import { promptDialog } from "./confirm";
import { ICONS } from "./icons";
import type { MenuItem } from "./more-menu";

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

/** A bookmark put at `mark`, or taken off if it has one there; the list stays in file order by `order`. */
export function toggledMark(s: ViewState, mark: ViewMark, order: (at: string) => number): ViewState {
  const marks = s.marks.some((m) => m.at === mark.at) ? s.marks.filter((m) => m.at !== mark.at) : [...s.marks, mark].sort((a, b) => order(a.at) - order(b.at)).slice(0, MAX_MARKS);
  return { ...s, marks };
}

/** A change to the list of bookmarks, whoever holds it. */
export type MarksChange = (change: (marks: ViewMark[]) => ViewMark[]) => void;

/** What a bookmark's ⋯ offers, in a view's menu and in the details alike. */
export function markActions(mark: ViewMark, change: MarksChange): MenuItem[] {
  return [
    {
      id: "mark-rename",
      label: "Rename",
      hint: "Its name in the list",
      icon: ICONS.textCursorInput,
      run: () => void promptDialog({ title: "Rename this bookmark", lines: [], value: mark.label, confirmLabel: "Rename" }).then((name) => {
        const label = name?.trim().slice(0, 120);
        if (label) change((marks) => marks.map((m) => (m.at === mark.at ? { ...m, label } : m)));
      }),
    },
    { id: "mark-delete", label: "Delete", hint: "Only this bookmark", icon: ICONS.trash, danger: true, run: () => change((marks) => marks.filter((m) => m.at !== mark.at)) },
  ];
}
