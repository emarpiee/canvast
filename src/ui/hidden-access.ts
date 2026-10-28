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
 * Before hiding items, or showing hidden ones, in the desktop build, where hidden items are encrypted (ADR 0177): the key must be
 * open. With no Hidden password yet, one is set first (hiding only); with a locked key, the password is asked. True when ready.
 */
export async function readyForHidden(session: Session, hiding: boolean): Promise<boolean> {
  const hidden = session.storage?.hidden;
  if (!hidden) return true;
  const state = await hidden.state();
  if (state === "open") return true;
  if (state === "locked" || (await session.hasPassword("hidden"))) return askPassword(session, "hidden", "Enter the password of the Hidden items: they are encrypted with it.");
  if (!hiding) return true; // (hidden before they were encrypted: nothing to open)
  const first = await promptDialog({
    title: "Password for the Hidden items",
    lines: [
      "Hidden items are encrypted in the workspace folder with this password, so nobody can open them without it.",
      "If it is lost, so are they: it cannot be recovered. A full backup (Settings > Storage) keeps a copy you can open without it.",
    ],
    value: "",
    confirmLabel: "Next",
    secret: true,
  });
  if (!first) return false;
  const again = await promptDialog({ title: "Password for the Hidden items", lines: ["Type it again."], value: "", confirmLabel: "Set the password and hide", secret: true });
  if (again !== first) {
    session.tell("The two did not match, so nothing was hidden.");
    return false;
  }
  return session.setPassword("hidden", first);
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
    lines: [`${plural(n, "hidden item")} would be in this export. Include ${n === 1 ? "it" : "them"}, with ${n === 1 ? "its" : "their"} files and names?`],
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
  const items = [
    ...(have.includes("workspace") ? [{ name: "The workspace password" }] : []),
    ...(have.includes("hidden") ? [{ name: "The Hidden items password" }] : []),
    ...(session.settingsHook?.privacySet() ? [{ name: "Your privacy settings" }] : []),
  ];
  const choice = await chooseDialog({
    title: "Passwords and privacy settings",
    lines: ["Include these in this backup?"],
    list: { title: "This device has", items },
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
