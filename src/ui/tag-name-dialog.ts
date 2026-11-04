import { promptDialog } from "./confirm";

/** The one way a tag is renamed: the library's, or a tag on canvases. The new name, or null when cancelled or unchanged. */
export async function askTagName(label: string, where: "library" | "canvases"): Promise<string | null> {
  const name = await promptDialog({
    title: `Rename the tag “${label}”`,
    lines: [`It changes on every ${where === "library" ? "item" : "canvas item"} that has it. A name another tag has joins the two.`],
    value: label,
    confirmLabel: "Rename tag",
  });
  return name === null || name.trim().replace(/^#+/, "") === label ? null : name;
}
