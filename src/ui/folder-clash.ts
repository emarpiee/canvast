import { chooseDialog } from "./confirm";

/** Two folders side by side that a disk would take for one: the person chooses. `merge`, `separate`, or null to leave things as they are. */
export function askFolderClash(existing: string, name: string, action: string): Promise<"merge" | "separate" | null> {
  return chooseDialog({
    title: `A folder like “${name}” is already here`,
    lines: [`“${existing}” is beside it, and on a disk the two would be one folder.`],
    choices: [
      { value: "merge", label: `Merge into “${existing}”`, help: "One folder with the items of both. A file with the same name gets -2; nothing is overwritten. Undo works in this session; later it cannot be split automatically." },
      { value: "separate", label: "Keep separate", help: "Both stay, this one under a numbered name." },
    ],
    confirmLabel: action,
  }) as Promise<"merge" | "separate" | null>;
}
