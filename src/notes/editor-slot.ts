/**
 * The notes editor's slot (B37): everything the app knows of the editor that writes notes. The app reaches the editor only through this file;
 * the editor itself (its engine) is one module behind it, today SunEditor (`ui/note-editor.ts`, with its Markdown converter in
 * `notes/note-markdown.ts`). To put another editor in, write a module whose `mountNoteEditor` keeps this contract and change the one line at
 * the end. `npm run check:components` refuses SunEditor imported anywhere but its own module.
 */
import type { NoteKind, NoteStyle, PathTarget } from "./note-file";
import type { Prop } from "./frontmatter";

export type AttachKind = "image" | "video" | "audio" | "file";

/** A library item as a note shows it. */
export interface NoteItem {
  hash: string;
  name: string;
  type: string;
}

/** What the notes editor needs from the library. */
export interface NoteHost {
  /** The whole note as a markdown file, properties and these words; null when it has none to carry. */
  whole(words: string, pasted: readonly Prop[]): string | null;
  /** Read the library's list again: what the note's links point at may have arrived since it opened. */
  reread(): Promise<void>;
  /** Read again what `whole` needs: the file and the item's properties. */
  refreshWhole(): Promise<void>;
  /** The folder of the note in the library (its links are relative to it). */
  dir: string[];
  /** The item a link in the note names (by its path in the library, or its hash), or null. */
  find(target: { hash: string } | PathTarget): Promise<NoteItem | null>;
  /** The item's file, to show it in the note. */
  blob(hash: string): Promise<Blob | null>;
  /** Where the item is in the library (its folders and file name), for a link to it. */
  pathOf(hash: string): Promise<string[]>;
  /** The library chooser, for this kind of item (it can import files too). */
  choose(kind: AttachKind | "any"): Promise<NoteItem | null>;
  /** Files dropped, pasted or uploaded into the note: put in the library first. */
  importFiles(files: File[]): Promise<NoteItem[]>;
  /** The fonts of the library, loaded, by their family names (the page knows them by those names too). */
  fonts(): Promise<string[]>;
  /** What `[[` offers: the library's notes and files, by the name a link names them with (`key`), and the name shown (`name`). */
  linkables(): Promise<Array<{ key: string; name: string; hash: string }>>;
  /** The library's tags, for `#` (a tag written in a note is one of its item's tags). */
  tags(): Promise<string[]>;
  /** The item a `[[target]]` link names, or null. */
  findWiki(target: string): Promise<NoteItem | null>;
  /** Ctrl+click on a link in the note: open what it points at (a note, a file of the library). `link`: as written in the file. */
  open(link: string): void;
  /** A small picture of what a link points at (its library preview), for a look while the pointer rests on it. */
  peek(link: string): Promise<Blob | null>;
  /** The notes of the library tagged `template`: offered in Insert ▸ Template after the built-in ones. */
  templates(): Promise<Array<{ name: string; kind: NoteKind; text: string; dir: string[] }>>;
  /** The editor's Save button (and Ctrl+S): whether it was saved. */
  save(): Promise<boolean>;
}

export interface NoteEditor {
  /** Properties pasted into the note and not saved yet. */
  pastedProps(): readonly Prop[];
  /** Edited since it was opened or last saved. */
  readonly dirty: boolean;
  /** The note as a markdown or plain text file, and whether that keeps everything in it (else formatting would be lost). */
  asText(kind: Exclude<NoteKind, "rich">): { text: string; keepsAll: boolean };
  /** The note as a rich text note's file. */
  asRich(title: string): string;
  /** Pasted content found its items: wait for this before writing the note. */
  settle(): Promise<void>;
  /** The editor's content now (given to `saved`, for what was saved). */
  current(): string;
  /** The note was saved (`as` this content, else as it is now): what was typed since stays a change. */
  saved(as?: string): void;
  /** Show the pictures that could not be found when the note opened, if they have arrived. Changes nothing in the note. */
  retryPictures(): Promise<void>;
  destroy(): void;
}

/** What opening a note in the editor takes. */
export type NoteEditorOptions = { kind: NoteKind; text: string; style: NoteStyle; host: NoteHost; /** A sign typed over selected words goes round them (Settings). */ wrapSelection?: boolean; /** A list's, a quote's or a heading's mark typed at a line's start, then a space, makes it (Settings). */ typedMarks?: boolean; /** Code blocks in a language are coloured (Settings). */ codeColours?: boolean; /** The note's name (no extension), for {{title}}. */ title: string; /** The whole place it is shown in (else the library's viewer). */ root?: HTMLElement | null };

/** The editor in use: the one line to change to swap it. */
export { mountNoteEditor } from "../ui/note-editor";
