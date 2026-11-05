/**
 * Library items on the system's clipboard: the library's Copy and Ctrl+C, its viewer's, and a note card on a canvas, all through here. What each kind becomes is
 * `clipboardFor`; putting it there is `writeSystemClipboard`. The message always says what landed.
 */
import { isDisk, writeProven } from "../storage/disk-file";
import type { DesktopBridge } from "../storage/desktop-bridge";
import { meta, type CatalogEntry } from "../assets/asset-catalog";
import { clipboardFor, isPicture, isWords } from "../assets/clipboard-kinds";
import { plural } from "../doc/plural";
import { splitFrontmatter, wholeMarkdown } from "../notes/frontmatter";
import { linksToWiki, noteKindOf, richNoteBody } from "../notes/note-file";
import { desktopBridge } from "../storage/desktop-bridge";
import { confirmDialog } from "../ui/confirm";
import { asPng, copyPlainText, writeSystemClipboard, type ClipboardFiles } from "./system-clipboard";

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
let asking: Promise<boolean> | null = null;
/** The system's clipboard is outside the app: asked once a session before a hidden item goes there. */
export async function hiddenFine(ents: readonly CatalogEntry[]): Promise<boolean> {
  if (hiddenAsked || !ents.some((e) => meta(e).hidden)) return true;
  // (one question at a time, whichever route asks: all that ask have the one answer)
  asking ??= confirmDialog({ title: "Copy a hidden item", lines: ["It goes on the system's clipboard, readable, where other programs and clipboard managers can see and keep it."], confirmLabel: "Copy it", danger: false }).finally(() => { asking = null; });
  if (!(await asking)) return false;
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

/** A copy that takes a moment says so, and says when it can be pasted; one that fails says that, whatever went wrong. */
export async function sayingProgress(say: (text: string) => void, work: () => Promise<void>): Promise<void> {
  let slow = false;
  const timer = setTimeout(() => {
    slow = true;
    say("Preparing the copy…");
  }, 400);
  try {
    await work();
    if (slow) say("Ready to paste.");
  } catch {
    say("Could not copy to the clipboard.");
  } finally {
    clearTimeout(timer);
  }
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
  // The desktop app: their real files too, for whatever pastes files. (A browser cannot put a file on the clipboard.)
  const bridge = desktopBridge();
  const kinds = ents.map((e) => clipboardFor(e.name, e.type));
  // Several real files: as Copy file, and nothing beside them, for a program given one picture would take that and leave the rest.
  if (bridge && ents.length > 1 && !kinds.every(isWords)) {
    await copyItemsAsFiles(deps, ents);
    return null;
  }
  const real = bridge ? await filesOf(deps, bridge, ents) : undefined;
  const files = real?.n ? real : undefined;
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
    if (files ? (await writeSystemClipboard({ text, files })) === "failed" : !(await copyPlainText(text))) {
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
    if (files) deps.say((await writeSystemClipboard({ text: names, files })) === "failed" ? "Could not copy to the clipboard." : `Copied “${ents[0]!.name}”.`);
    else if (await copyPlainText(names)) onlyName();
    else deps.say("Could not copy to the clipboard.");
    return null;
  }
  const first = ents[single ? 0 : at]!;
  const source = single ? await deps.thumb(first.hash).catch(() => undefined) : await deps.file(first.hash).catch(() => undefined);
  const svg = source && kinds[single ? 0 : at] === "vector" ? await source.text().catch(() => undefined) : undefined;
  const done = await writeSystemClipboard({ ...(source ? { image: asPng(source) } : {}), text: names, ...(svg ? { svg } : {}), ...(files ? { files } : {}) });
  if (done === "failed") deps.say("Could not copy to the clipboard.");
  else if (done === "text") onlyName();
  else {
    const others = ents.length - 1;
    const kind = kinds[single ? 0 : at]!;
    deps.say(others ? `Copied “${first.name}” only: a clipboard holds one picture (${others} more selected).` : kind === "picture" || kind === "vector" ? `Copied “${first.name}”.` : `Copied a picture of “${first.name}”: the clipboard holds a still picture.`);
  }
  return null;
}

/** What `openCopy` and `copyFiles` take: the bytes, or, too big to pass through the page, where a readable copy was written a part at a time. */
export async function copyBytes(bridge: DesktopBridge, name: string, blob: Blob): Promise<Uint8Array | string> {
  if (!isDisk(blob)) return new Uint8Array(await blob.arrayBuffer());
  return writeProven(bridge.stream, await bridge.stream.copy(name), blob);
}

/** The items' real files for the clipboard, of any kind: a hidden one's is encrypted, so a readable copy in the app's own temporary folder, deleted on lock and on closing, as for opening it in another app. */
export async function filesOf(deps: CopyDeps, bridge: DesktopBridge, ents: readonly CatalogEntry[]): Promise<ClipboardFiles & { readonly n: number }> {
  const files: string[] = [];
  const copies: Array<{ name: string; bytes: Uint8Array | string }> = [];
  for (const e of ents) {
    if (meta(e).hidden) {
      const blob = await deps.file(e.hash).catch(() => undefined);
      if (blob) copies.push({ name: e.name, bytes: await copyBytes(bridge, e.name, blob) });
    } else {
      const file = await deps.fileOf?.(e.hash).catch(() => null);
      if (file) files.push(file);
    }
  }
  return { files, copies, n: files.length + copies.length };
}

/** The desktop app: the items' real files alone on the clipboard, of any kind. In a browser, what Copy gives. */
export async function copyItemsAsFiles(deps: CopyDeps, ents: readonly CatalogEntry[]): Promise<void> {
  const bridge = desktopBridge();
  if (!bridge) return void (await copyItemsToClipboard(deps, ents));
  if (!ents.length || !(await hiddenFine(ents))) return;
  const { files, copies, n } = await filesOf(deps, bridge, ents);
  if (!n) return deps.say(ents.some((e) => meta(e).hidden) ? "Could not read it: are the hidden items locked?" : "Its file is not in the workspace folder yet: try again in a moment.");
  try {
    await bridge.copyFiles(files, copies);
  } catch {
    return deps.say("Could not copy to the clipboard.");
  }
  const left = ents.length - n;
  deps.say(`Copied ${plural(n, "file")}${left ? `, not the other ${left} (not in the workspace folder yet)` : ""}.`);
}
