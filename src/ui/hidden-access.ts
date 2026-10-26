import type { PasswordKind } from "../assets/asset-catalog";
import type { Session } from "../app/session";
import type { ExportScope } from "../storage/archive";
import { chooseDialog, promptDialog } from "./confirm";
import { plural } from "../doc/plural";

/**
 * Where the passwords are asked: the Hidden list's (in front of the list and of exporting hidden items) and the whole workspace's (when the app opens,
 * and when changing or removing it). These are gates, not encryption: the data is stored as it is. With no password set, nothing is asked.
 */
let rememberedHere = false;
const verifiedAt: Record<PasswordKind, number> = { hidden: -Infinity, workspace: -Infinity };

/** Forget the Hidden list's password given in this tab (the password was changed or removed, or remembering was turned off). */
export function forgetHiddenPassword(): void {
  rememberedHere = false;
}

/**
 * `remember` (the Hidden list only): a right password is kept for this tab (in memory, so a reload or closing the tab forgets it) and not asked again.
 * An export always asks.
 */
export async function askPassword(session: Session, kind: PasswordKind, why: string, remember = false): Promise<boolean> {
  if (kind === "hidden") {
    if (!remember) rememberedHere = false;
    if (remember && rememberedHere) return true;
  }
  if (!(await session.hasPassword(kind))) return true;
  let wrong = false;
  for (;;) {
    const typed = await promptDialog({ title: "Password", lines: [why, ...(wrong ? ["That is not the password."] : [])], value: "", confirmLabel: "Continue", secret: true });
    if (typed === null) return false;
    if (await session.checkPassword(kind, typed)) {
      verifiedAt[kind] = Date.now();
      if (kind === "hidden") rememberedHere = remember;
      return true;
    }
    wrong = true;
  }
}

export const askHiddenPassword = (session: Session, why: string, remember = false): Promise<boolean> => askPassword(session, "hidden", why, remember);

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

/**
 * Before a workspace backup: when there are passwords or a changed privacy setting, ask whether to include them (each password first, unless it was
 * just given). Resolves with the scope to export, or null when cancelled or a password was not given. Other exports never carry them.
 */
export async function scopeWithPrivacyChoice(session: Session, scope: ExportScope): Promise<ExportScope | null> {
  if (scope.kind !== "workspace" || scope.noBytes) return scope;
  const kinds = ["workspace", "hidden"] as const;
  const have = (await Promise.all(kinds.map((k) => session.hasPassword(k)))).map((h, i) => (h ? kinds[i]! : null)).filter((k): k is PasswordKind => k !== null);
  if (!have.length && !session.settingsHook?.privacySet()) return scope;
  const names = [have.includes("workspace") ? "the password of the workspace" : "", have.includes("hidden") ? "the password of the Hidden items" : "", session.settingsHook?.privacySet() ? "your privacy settings" : ""].filter(Boolean);
  const choice = await chooseDialog({
    title: "Passwords and privacy settings",
    lines: [`Include ${names.join(", ").replace(/, ([^,]*)$/, " and $1")} in this backup?`],
    choices: [
      { value: "leave", label: "Leave them out", help: "A copy restored from it starts with no password and the default privacy settings." },
      { value: "include", label: "Include them", help: "Importing it sets a password only on a device that has none. The file then holds the password's hash: anyone who has it could try to guess it." },
    ],
    confirmLabel: "Export",
  });
  if (choice === null) return null;
  if (choice === "include") {
    for (const k of have) {
      if (Date.now() - verifiedAt[k] > 60_000 && !(await askPassword(session, k, `Enter the password of the ${k === "workspace" ? "workspace" : "Hidden items"} to include it in the backup.`))) return null;
    }
  }
  return { ...scope, withPrivacy: choice === "include" };
}
