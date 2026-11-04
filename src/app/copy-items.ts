/**
 * Library items on the system's clipboard: the library's Copy and Ctrl+C, its viewer's, and a note card on a canvas, all through here. What each kind becomes is
 * `clipboardFor`; putting it there is `writeSystemClipboard`. The message always says what landed.
 */
import { meta, type CatalogEntry } from "../assets/asset-catalog";
import { clipboardFor, isPicture, isWords } from "../assets/clipboard-kinds";
import { plural } from "../doc/plural";
import { splitFrontmatter, wholeMarkdown } from "../notes/frontmatter";
import { linksToWiki, noteKindOf, richNoteBody } from "../notes/note-file";
import { desktopBridge } from "../storage/desktop-bridge";
import { confirmDialog } from "../ui/confirm";
import { asPng, copyPlainText, writeSystemClipboard } from "./system-clipboard";

export interface CopyDeps {
  file(hash: string): Promise<Blob | undefined>;
  thumb(hash: string): Promise<Blob | undefined>;
  /** The item's file in the workspace, when it has one there. */
  fileOf?(hash: string): Promise<string | null | undefined>;
  say(text: string): void;
}

/** Most words several notes put on the clipboard together. */
const MAX_JOINED = 5_000_000;
const NOTES_BETWEEN = "\n\n---\n\n";

let hiddenAsked = false;
/** The system's clipboard is outside the app: asked once a session before a hidden item goes there. */
async function hiddenFine(ents: readonly CatalogEntry[]): Promise<boolean> {
  if (hiddenAsked || !ents.some((e) => meta(e).hidden)) return true;
  if (!(await confirmDialog({ title: "Copy a hidden item", lines: ["It goes on the system's clipboard, readable, where other programs and clipboard managers can see and keep it."], confirmLabel: "Copy it", danger: false }))) return false;
  hiddenAsked = true;
  return true;
}

/** A note's words as one markdown file, its properties on top; a plain text note's as they are. */
async function wordsOf(e: CatalogEntry, file: string): Promise<string> {
  const m = meta(e);
  const props = { tags: m.tags, note: m.note, fields: m.fields };
  const kind = noteKindOf(e.name);
  if (kind === "txt") return file;
  if (kind === "md") return wholeMarkdown("md", file, splitFrontmatter(file).body, props, []);
  const { htmlMarkdown } = await import("../notes/note-markdown"); // (loaded when a rich text note is copied: it needs a page, not the unit tests' Node)
  return wholeMarkdown("rich", "", linksToWiki(htmlMarkdown(richNoteBody(file))), props, []);
}

/** Copy these items. What was written as text, when the words of notes were: a canvas needs it to know its own paste. */
export async function copyItemsToClipboard(deps: CopyDeps, ents: readonly CatalogEntry[], what: "picture" | "name" = "picture"): Promise<string | null> {
  if (!ents.length || !(await hiddenFine(ents))) return null;
  const names = ents.map((e) => e.name || "image").join("\n");
  const onlyName = (): void => deps.say(ents.length === 1 ? `Copied only the name “${ents[0]!.name || "image"}”: this kind of file cannot go on the clipboard as it is.` : `Copied ${ents.length} names.`);
  if (what === "name") {
    if (await copyPlainText(names)) deps.say(ents.length === 1 ? `Copied the name “${ents[0]!.name || "image"}”.` : `Copied ${ents.length} names.`);
    else deps.say("Could not copy to the clipboard.");
    return null;
  }
  const kinds = ents.map((e) => clipboardFor(e.name, e.type));
  if (kinds.every(isWords)) {
    const parts: string[] = [];
    let size = 0;
    let unread = 0;
    for (const e of ents) {
      const file = await (await deps.file(e.hash).catch(() => undefined))?.text();
      if (file === undefined) {
        unread++;
        continue;
      }
      const words = await wordsOf(e, file);
      if (parts.length && size + words.length > MAX_JOINED) break;
      parts.push(words);
      size += words.length;
    }
    if (!parts.length) {
      deps.say(ents.some((e) => meta(e).hidden) ? "Could not read it: are the hidden items locked?" : "Could not read the note's file.");
      return null;
    }
    const text = parts.join(NOTES_BETWEEN);
    if (!(await copyPlainText(text))) {
      deps.say("Could not copy to the clipboard.");
      return null;
    }
    const left = ents.length - parts.length;
    deps.say(ents.length === 1 ? `Copied the note “${ents[0]!.name}”, with its properties.` : `Copied ${plural(parts.length, "note")}${left ? `, not the other ${left}${unread ? " (could not be read, or too much at once)" : " (too much at once)"}` : ""}.`);
    return text;
  }
  const at = kinds.findIndex(isPicture);
  const single = ents.length === 1 && kinds[0] === "thumb";
  if (at < 0 && !single) {
    if (await copyPlainText(names)) onlyName();
    else deps.say("Could not copy to the clipboard.");
    return null;
  }
  const first = ents[single ? 0 : at]!;
  const source = single ? await deps.thumb(first.hash).catch(() => undefined) : await deps.file(first.hash).catch(() => undefined);
  const done = await writeSystemClipboard({ ...(source ? { image: asPng(source) } : {}), text: names });
  if (done === "failed") deps.say("Could not copy to the clipboard.");
  else if (done === "text") onlyName();
  else {
    const others = ents.length - 1;
    const kind = kinds[single ? 0 : at]!;
    deps.say(others ? `Copied “${first.name}” only: a clipboard holds one picture (${others} more selected).` : kind === "picture" ? `Copied “${first.name}”.` : `Copied a picture of “${first.name}”: the clipboard holds a still picture.`);
  }
  return null;
}

/** The desktop app: the items' real files on the clipboard, of any kind, to paste into a file manager. In a browser, what Copy gives. */
export async function copyItemsAsFiles(deps: CopyDeps, ents: readonly CatalogEntry[]): Promise<void> {
  const bridge = desktopBridge();
  if (!bridge) return void (await copyItemsToClipboard(deps, ents));
  if (!ents.length || !(await hiddenFine(ents))) return;
  const files: string[] = [];
  const copies: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const e of ents) {
    if (meta(e).hidden) {
      // (its file is encrypted: a readable copy in the app's own temporary folder, deleted on lock and on closing, as for opening it in another app)
      const blob = await deps.file(e.hash).catch(() => undefined);
      if (blob) copies.push({ name: e.name, bytes: new Uint8Array(await blob.arrayBuffer()) });
    } else {
      const file = await deps.fileOf?.(e.hash).catch(() => null);
      if (file) files.push(file);
    }
  }
  const n = files.length + copies.length;
  if (!n) return deps.say(ents.some((e) => meta(e).hidden) ? "Could not read it: are the hidden items locked?" : "Its file is not in the workspace folder yet: try again in a moment.");
  try {
    await bridge.copyFiles(files, copies);
  } catch {
    return deps.say("Could not copy to the clipboard.");
  }
  const left = ents.length - n;
  deps.say(`Copied ${plural(n, "file")}${left ? `, not the other ${left} (not in the workspace folder yet)` : ""}: paste in a file manager.`);
}
