import type { Session } from "../app/session";
import type { ExportScope } from "../storage/archive";
import { chooseDialog, promptDialog } from "./confirm";
import { plural } from "../doc/plural";

/**
 * Where the Hidden list's password is asked (a gate in front of the list and of exporting hidden items; the files themselves are not encrypted).
 * With no password set, nothing is asked.
 */
export async function askHiddenPassword(session: Session, why: string): Promise<boolean> {
  if (!(await session.hasHiddenPassword())) return true;
  let wrong = false;
  for (;;) {
    const typed = await promptDialog({ title: "Password", lines: [why, ...(wrong ? ["That is not the password."] : [])], value: "", confirmLabel: "Continue", secret: true });
    if (typed === null) return false;
    if (await session.checkHiddenPassword(typed)) return true;
    wrong = true;
  }
}

/**
 * Before an export that would carry hidden items: ask whether to include them and their data (then the password first, when there is one) or leave
 * them out. Resolves with the scope to export, or null when cancelled or the password was not given.
 */
export async function scopeWithHiddenChoice(session: Session, scope: ExportScope): Promise<ExportScope | null> {
  const n = await session.hiddenInExport(scope);
  if (!n) return scope;
  const choice = await chooseDialog({
    title: "Hidden items",
    lines: [`${plural(n, "hidden item")} would be in this export. Include ${n === 1 ? "it" : "them"}, and ${n === 1 ? "its" : "their"} files and names?`],
    choices: [
      { value: "leave", label: "Leave them out", help: "The export has no trace of them. Pictures on a canvas that use them show as missing when it is imported." },
      { value: "include", label: "Include them", help: "They stay hidden when imported. The file is not encrypted: anyone who has it can open it." },
    ],
    confirmLabel: "Export",
  });
  if (choice === null) return null;
  if (choice === "include" && !(await askHiddenPassword(session, "Enter the password to include the hidden items."))) return null;
  return { ...scope, skipHidden: choice === "leave" };
}
