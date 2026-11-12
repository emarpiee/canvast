import { isModelFile, isPdfFile } from "../assets/file-kind";
import { noteKindOf, opensAsNote, tooBigForNote } from "../notes/note-file";
import { OpenNote } from "./note-session";
import type { NoteDeps, NotePlace } from "./note-session";
import type { MarksChange, ViewMark } from "./view-state";
import type { AssetRecord } from "../assets/asset-library";

/**
 * The kinds of file that open in a view of their own, in the library's viewer and in the panel on a canvas alike. A new kind of file is one
 * row here (and one in assets/adapters.ts, for its picture on a card): the viewer, the panel, their keys and the details need nothing else.
 */

/** What the place showing a file does for it, and what it reads. */
export type ViewPlace = NotePlace & {
  /** The object on a canvas it was opened from can show what is in view (doc/model.ts `preview`). */
  setPreview?(preview: string, size: { w: number; h: number }): void;
  /** Cards of this file put on the canvas, one showing each (a PDF's pages, a model's turnaround). */
  placeViews?(items: ReadonlyArray<{ preview: string; size: { w: number; h: number } }>): void;
  /** A drawing (SVG text) as editable paths on the canvas, as large as a card of `size`. */
  placeLines?(svg: string, size: { w: number; h: number }): void;
  /** A picture made from the file (a PDF's page) placed beside the card it was opened from. */
  pictureBeside?(record: AssetRecord): void;
  /** Opened from a card: what it shows (doc/model.ts `preview`, "" its first look), where the view starts instead of where the file was left. */
  startAt?: string;
};
/** What a place on a canvas can do with the card it was opened from. */
export type CardActions = Pick<ViewPlace, "setPreview" | "placeViews" | "placeLines" | "pictureBeside" | "startAt">;
export type ViewDeps = NoteDeps;

/** A file open in its view. */
/** What a card shows of a file, and its size in pixels. */
export type CardLook = { preview: string; size: { w: number; h: number } };

export interface OpenView {
  hash: string;
  /** Asks about what would be lost: whether to go on. */
  leave(): Promise<boolean>;
  /** Closes it; `stillThere`: its item is still in the library. */
  close(stillThere: boolean): void;
  /** Its keys are its own while the focus is in it, but for what the place lets through (a note's words). */
  readonly ownsKeys?: boolean;
  /** Being saved: its item's old hash going is no deletion. */
  readonly busy?: boolean;
  /** Zooms itself; without it, the place zooms a note's words. */
  zoom?(dir: 1 | -1 | 0): void;
  /** A key while it is on show: true when it took it. */
  key?(e: KeyboardEvent): boolean;
  /** Goes to a place in the file (a bookmark). */
  goTo?(at: string): void;
  /** Bookmarks the place in view, or takes that bookmark off. */
  toggleMark?(): Promise<void>;
  /** The place in view, as a bookmark would be. */
  here?(): ViewMark | null;
  /** The page or view in sight as a card shows it (`ImageObject.preview` and the card's pixel size): what Place puts on a canvas. */
  card?(): CardLook;
  /** Changes its list of bookmarks (it holds them while it is open). */
  changeMarks?: MarksChange;
}

export interface FileFacts {
  hash: string;
  name: string;
  blob: Blob;
}

export interface FileViewKind {
  readonly id: "note" | "pdf" | "model";
  /** What the interface calls it. */
  readonly noun: string;
  /** Whether it has bookmarks, listed in the details. */
  readonly marks: boolean;
  /** By name, for what needs no reading (a menu, the details). */
  named(name: string): boolean;
  /** Whether this file opens here. */
  claims(file: FileFacts): Promise<boolean> | boolean;
  /** Its words, for the library's search; absent, or the file `tooBig`: it is found by its name. */
  words?(blob: Blob, name: string): Promise<string>;
  tooBig?(name: string, size: number): boolean;
  open(el: HTMLElement, file: FileFacts, deps: ViewDeps, place: ViewPlace): Promise<OpenView>;
}

const KINDS: readonly FileViewKind[] = [
  {
    id: "note",
    noun: "note",
    marks: false,
    named: (name) => !!noteKindOf(name),
    claims: (f) => opensAsNote(f.name, f.blob),
    words: async (blob, name) => {
      const text = await blob.text();
      return noteKindOf(name) === "rich" ? (new DOMParser().parseFromString(text, "text/html").body.textContent ?? "") : text;
    },
    tooBig: tooBigForNote,
    open: (el, f, deps, place) => OpenNote.open(el, f.hash, f.name, f.blob, deps, place),
  },
  {
    id: "pdf",
    noun: "PDF",
    marks: true,
    named: (name) => isPdfFile({ name }),
    claims: (f) => isPdfFile(f),
    words: async (blob) => (await import("../assets/pdf-engine")).pdfWords(new Uint8Array(await blob.arrayBuffer())),
    tooBig: (_name, size) => size > 128 * 2 ** 20,
    open: async (el, f, deps, place) => (await import("./pdf-view")).openPdfView(el, f, deps, place),
  },
  {
    id: "model",
    noun: "3D model",
    marks: true,
    named: isModelFile,
    claims: (f) => isModelFile(f.name),
    open: async (el, f, deps, place) => (await import("./model-view")).openModelView(el, f, deps, place),
  },
];


/** The kind of view of a file by its name, null for what has none. */
export const viewKindNamed = (name: string): FileViewKind | null => KINDS.find((k) => k.named(name)) ?? null;

/** The kind of view this file opens in, null for what has none (it shows as a picture, a player or a card). */
export async function viewKindOf(file: FileFacts): Promise<FileViewKind | null> {
  const k = viewKindNamed(file.name);
  return k && (await k.claims(file)) ? k : null;
}
