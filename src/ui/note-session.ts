import type { Session } from "../app/session";
import type { AssetLibrary } from "../assets/asset-library";
import type { CatalogEntry } from "../assets/asset-catalog";
import { meta } from "../assets/asset-catalog";
import { concealedUnder } from "../assets/library-match";
import { chipOf } from "../assets/file-kind";
import type { SettingsStore } from "../settings/settings";
import { desktopBridge } from "../storage/desktop-bridge";
import { WIKI, linkTarget, newNoteFile, noteKindOf, wikiTarget, wikiKeyOf } from "../notes/note-file";
import { newNoteName } from "../app/frames";
import type { NoteKind } from "../notes/note-file";
import { autoDates, noteFileName, stampNote } from "../notes/note-dates";
import { splitFrontmatter, underProps, wholeMarkdown, withFileMeta, withPastedProps, type NoteMeta } from "../notes/frontmatter";
import { chooseDialog, confirmDialog } from "./confirm";
import { openLibraryPicker } from "./library-picker";
import { mountNoteEditor } from "./note-editor";
import { mountPlayerControls } from "./player-controls";
import { avEngine } from "./media-player";
import type { AttachKind, NoteEditor, NoteHost, NoteItem } from "./note-editor";

// A note open in the notes editor: the same for the library's viewer and for the canvas's note panel. Whoever shows it gives a
// `NotePlace` (how it imports files, shows another item, follows a new version); everything else (links, pictures, fonts,
// templates, saving, the questions asked) is here once.

/** What the place showing a note does for it. */
export interface NotePlace {
  /** The whole place the note is shown in: a press inside it is at the note, so the keyboard's Undo and Save are the note's. */
  root?(): HTMLElement | null;
  /** Files into the library: their hashes. */
  importFiles(files: File[]): Promise<string[]>;
  /** Show another item (a link followed). */
  show(hash: string): Promise<void>;
  /** A `[[canvas:Name]]` link was followed and that canvas opened: the canvas is shown. */
  showCanvas(): void;
  /** The note's item got a new version (its hash changed). */
  moved(from: string, to: string): void;
  /** Lists drawn again after a save. */
  refresh(): Promise<void>;
  /** Hidden items are listed (hidden mode). */
  hidden(): boolean;
}

/** What every open note reads. */
export interface NoteDeps {
  session: Session;
  assets: AssetLibrary;
  settings: SettingsStore;
}

/** A note with this tag is a template: offered in the `/` menu of every note. */
const TEMPLATE_TAG = "template";
const NOUNS: Record<AttachKind | "any", readonly [string, string]> = { image: ["picture", "pictures"], video: ["video", "videos"], audio: ["sound", "sounds"], file: ["file", "files"], any: ["item", "items"] };
/** A note file's words: without its properties (they are the library's too). */
const wordsOf = (kind: NoteKind, file: string): string => (kind === "md" ? splitFrontmatter(file).body : file).trim();
const titleOf = (name: string): string => name.replace(/\.(md|markdown|txt)$/i, "");

/** The notes open now (the library's and the canvas's): a new version follows into them, and leaving the app asks about them. */
const open = new Set<OpenNote>();
const followed = new WeakSet<Session>();

/** A note open in the notes editor. */
export class OpenNote {
  readonly ownsKeys = true;
  private saving = false;
  private constructor(
    public hash: string,
    public readonly kind: NoteKind,
    /** Its name when it was opened; a save takes its item's name as it is then (renamed meanwhile). */
    public name: string,
    private readonly type: string,
    private editor: NoteEditor | null,
    /** Its words as the editor read them (to tell whether its file was changed elsewhere since). */
    private base: string,
    private readonly deps: NoteDeps,
    private readonly place: NotePlace,
  ) {}

  /** Open the note `hash` (its file `blob`) in the notes editor inside `el`. Throws when the editor cannot open it. */
  static async open(el: HTMLElement, hash: string, name: string, blob: Blob, deps: NoteDeps, place: NotePlace): Promise<OpenNote> {
    const kind = noteKindOf(name)!;
    const text = await blob.text();
    const note = new OpenNote(hash, kind, name, blob.type || "text/plain", null, wordsOf(kind, text), deps, place);
    const host = await note.host();
    note.editor = await mountNoteEditor(el, { kind, text, mode: deps.settings.get("notes.editorMode"), wrapSelection: deps.settings.get("notes.wrapSelection"), codeColours: deps.settings.get("notes.codeColours"), host, title: titleOf(name), root: place.root?.() ?? null });
    open.add(note);
    await note.readWhole();
    if (!followed.has(deps.session)) {
      followed.add(deps.session);
      // A new version of an open note (its properties written by a library change, the file saved elsewhere): it stays open.
      deps.session.onVersion((from, to, own) => {
        for (const n of open)
          if (n.hash === from && n.deps.session === deps.session) {
            n.hash = to;
            n.place.moved(from, to);
            // (the app wrote it, following a moved file: no one's other work to warn about at the next save)
            if (own) void deps.assets.record(to).then((r) => r?.blob.text()).then((text) => void (text !== undefined && (n.base = wordsOf(n.kind, text))));
          }
      });
      // A picture a note links to may arrive after the note (a sync tool writes them one by one).
      deps.session.subscribeAssets(() => {
        for (const n of open) if (n.deps.session === deps.session) void n.editor?.retryPictures().catch(() => undefined);
      });
    }
    return note;
  }

  /** Edited since it was opened or last saved. */
  /** The editor while the note is open (the debug hook reads it). */
  get editorNow(): NoteEditor | null {
    return this.editor;
  }

  get dirty(): boolean {
    return !!this.editor?.dirty;
  }

  /** Being saved: its item's old hash going is no deletion. */
  get busy(): boolean {
    return this.saving;
  }

  /** What the editor needs from the library, read once when the note opens. */
  private async host(): Promise<NoteHost> {
    const { session, assets } = this.deps;
    const hash = this.hash;
    const listing = await session.catalog?.list().catch(() => null);
    let folders = listing?.folders ?? [];
    const shownOf = (l: typeof listing): CatalogEntry[] => (l?.entries ?? []).filter((x) => x.present && (this.place.hidden() || !meta(x).hidden));
    const all: CatalogEntry[] = shownOf(listing);
    const pathOf = (x: Pick<CatalogEntry, "hash" | "name" | "folderIds">): Promise<string[]> => session.itemPath(x, folders);
    const item = (x: CatalogEntry): NoteItem => ({ hash: x.hash, name: x.name, type: x.type });
    const fits = (kind: AttachKind | "any", x: CatalogEntry): boolean => kind === "any" || kind === "file" || (x.type.startsWith(`${kind}/`) && !x.card);
    const take = async (files: File[]): Promise<NoteItem[]> => {
      const got: NoteItem[] = [];
      for (const h of await this.place.importFiles(files)) {
        const x = await session.catalog?.entry(h).catch(() => undefined);
        if (!x) continue;
        if (!all.some((y) => y.hash === h)) all.push(x);
        got.push(item(x));
      }
      return got;
    };
    // What is offered (the picker, link and tag suggestions) leaves out a concealed folder's items; a link already written still finds them.
    const offered = (): CatalogEntry[] => {
      const hush = concealedUnder(folders, JSON.parse(this.deps.settings.get("library.concealed")) as string[]);
      return hush ? all.filter((x) => !(x.folderIds ?? []).some((id) => hush.has(id))) : all;
    };
    const self = all.find((x) => x.hash === hash);
    const dir = (await pathOf(self ?? { hash, name: this.name, folderIds: [] })).slice(0, -1);
    const host: NoteHost = {
      dir,
      async reread() {
        const now = await session.catalog?.list().catch(() => null);
        if (!now) return;
        folders = now.folders;
        all.splice(0, all.length, ...shownOf(now));
      },
      async find(t) {
        const x = "hash" in t ? all.find((y) => y.hash === t.hash) : await session.itemAtPath(t, all, folders);
        return x ? item(x) : null;
      },
      blob: async (h) => (await assets.record(h).catch(() => undefined))?.blob ?? null,
      pathOf: (h) => {
        const x = all.find((y) => y.hash === h);
        return pathOf(x ?? { hash: h, name: "", folderIds: [] });
      },
      async choose(kind) {
        const list = offered().filter((x) => fits(kind, x)).sort((a, b) => b.importedAt - a.importedAt);
        const chosen = await openLibraryPicker(
          null,
          list.map((x) => ({ hash: x.hash, name: x.name, ...(x.type.startsWith("image/") && !x.card ? {} : { chip: chipOf(x.name, x.type) }), thumb: () => session.thumbBlob(x.hash) })),
          { noun: NOUNS[kind], importFiles: { accept: kind === "file" || kind === "any" ? "" : `${kind}/*`, run: async (files) => (await take(files)).map((i) => i.hash) } },
        );
        const x = chosen ? all.find((y) => y.hash === chosen) : undefined;
        return x ? item(x) : null;
      },
      importFiles: take,
      async linkables() {
        // A note by its name without `.md`, any other file by its whole name; a name two items share gets its folders in front.
        const keyOf = (x: CatalogEntry): string => (noteKindOf(x.name) === "md" ? x.name.replace(/\.(md|markdown)$/i, "") : x.name);
        const count = new Map<string, number>();
        const shown = offered();
        for (const x of shown) count.set(keyOf(x).toLowerCase(), (count.get(keyOf(x).toLowerCase()) ?? 0) + 1);
        const canvases = (session.tree?.boards ?? []).flatMap(({ board, canvases }) => canvases.map((c) => ({ key: `canvas:${c.name}`, name: c.name, hash: board.id })));
        return Promise.all([
          ...canvases,
          ...shown.filter((x) => x.hash !== hash).map(async (x) => {
            const key = keyOf(x);
            if ((count.get(key.toLowerCase()) ?? 0) < 2) return { key, name: key, hash: x.hash };
            const path = (await pathOf(x)).slice(0, -1);
            return { key: [...path, key].join("/"), name: key, hash: x.hash };
          }),
        ]);
      },
      async peek(link) {
        const target = link.startsWith(WIKI) ? null : linkTarget(link, dir);
        const found = link.startsWith(WIKI) ? await host.findWiki(decodeURIComponent(link.slice(WIKI.length))) : target ? await host.find(target) : null;
        return found ? ((await session.thumbBlob(found.hash)) ?? null) : null;
      },
      tags: async () => [...new Set(offered().flatMap((x) => x.tags ?? []))].sort((a, b) => a.localeCompare(b)),
      async findWiki(target) {
        const t = wikiTarget(target);
        const named = all.filter((x) => x.name.toLowerCase() === t.name || wikiKeyOf(x.name) === t.name);
        if (named.length < 2 || !t.dirs.length) return named[0] ? item(named[0]) : null;
        for (const x of named) {
          const dirs = (await pathOf(x)).slice(0, -1).map((d) => d.toLowerCase());
          if (t.dirs.every((d, i) => dirs[dirs.length - t.dirs.length + i] === d)) return item(x);
        }
        return item(named[0]!);
      },
      open: (link) => {
        // `[[canvas:Name]]`: that canvas, opened
        const canvas = link.startsWith(`${WIKI}canvas%3A`) ? decodeURIComponent(link.slice(WIKI.length)).slice(7).trim().toLowerCase() : null;
        if (canvas !== null) {
          const c = (session.tree?.boards ?? []).flatMap((b) => b.canvases).find((x) => x.name.toLowerCase() === canvas);
          if (!c) return void ((session.editor.message = "No canvas has that name."), session.editor.changed());
          void this.leave().then(async (ok) => ok && (await session.openCanvas(c.id), this.place.showCanvas()));
          return;
        }
        void (async () => {
          const target = link.startsWith(WIKI) ? null : linkTarget(link, dir);
          const found = link.startsWith(WIKI) ? await host.findWiki(decodeURIComponent(link.slice(WIKI.length))) : target ? await host.find(target) : null;
          if (found) await this.place.show(found.hash);
          else {
            session.editor.message = /^[a-z][a-z0-9+.-]*:/i.test(link) && !link.startsWith(WIKI) ? "Links to the web are not opened from a note (canvast does not go online)." : "That link points at nothing in the library.";
            session.editor.changed();
          }
        })();
      },
      async templates() {
        const tagged = all.filter((x) => x.hash !== hash && noteKindOf(x.name) && meta(x).tags.some((t) => t.toLowerCase() === TEMPLATE_TAG));
        const read = await Promise.all(
          tagged.map(async (x) => {
            const blob = (await assets.record(x.hash).catch(() => undefined))?.blob;
            return blob ? { name: titleOf(x.name), kind: noteKindOf(x.name)!, text: await blob.text(), dir: (await pathOf(x)).slice(0, -1) } : null;
          }),
        );
        return read.filter((t) => t !== null).sort((a, b) => a.name.localeCompare(b.name));
      },
      save: () => this.save(),
      refreshWhole: () => this.readWhole(),
      vim: this.deps.settings.get("notes.vim"),
      // A video in the note plays in the app's own player (the canvas's and the viewer's controls, its device settings).
      player: (video, box, url) => {
        const controls = mountPlayerControls(box, this.deps.settings, { extract: () => undefined });
        controls.el.classList.add("note-media-bar");
        controls.el.querySelector('[data-cmd="extract"]')?.remove(); // (keeping a frame is the canvas's and the viewer's)
        const engine = avEngine(video);
        engine.load({ media: { t: 0, repeat: false, speed: 1 } } as never, url, 0).then(
          () => controls.show(engine, "video", false),
          () => void ((video.controls = true), controls.el.remove()),
        );
      },
      // A linked note's words (the link popover), under the properties its file has now, as its new version.
      async saveOther(h, words) {
        const rec = await assets.record(h).catch(() => undefined);
        if (!rec) return null;
        const file = await rec.blob.text();
        const kind = noteKindOf(rec.name);
        if (!kind) return null;
        const text = stampNote(kind, kind === "md" ? underProps(file, words) : words, undefined, Date.now());
        return (await session.saveVersion(h, new File([text], rec.name, { type: rec.blob.type || "text/markdown" }))) ?? null;
      },
      createNote: async (name) => {
        const [made] = await take([newNoteFile(name)]);
        return made ?? null;
      },
      newNote: () =>
        void take([newNoteFile(newNoteName(session, this.deps.settings))]).then(async ([made]) => {
          if (made && (await this.leave())) await this.place.show(made.hash);
        }),
      whole: (words, pasted) => (this.kind === "txt" ? null : wholeMarkdown(this.fileNow, words, this.metaNow, pasted)),
    };
    return host;
  }

  /** Rename notes on save: after the save, so a name that is refused never costs the note its words (the library says why). */
  private async renameFromNote(hash: string, text: string): Promise<void> {
    const { session } = this.deps;
    const e = await session.catalog?.entry(hash).catch(() => undefined);
    if (!e) return;
    const itemTitle = e.fields?.find((f) => f.key.toLowerCase() === autoDates().title.toLowerCase())?.value;
    const name = noteFileName(this.kind, text, e.name, itemTitle);
    if (name && (await session.renameAssets([{ hash, name }]))) this.name = name;
  }

  /** The file and the item's properties, ready for a copy (which cannot wait for them). */
  private fileNow = "";
  private metaNow: NoteMeta | null = null;
  private async readWhole(): Promise<void> {
    const { session, assets } = this.deps;
    const e = await session.catalog?.entry(this.hash).catch(() => undefined);
    this.metaNow = e ? { tags: e.tags ?? [], note: e.note ?? "", fields: e.fields ?? [] } : null;
    this.fileNow = (await (await assets.record(this.hash).catch(() => undefined))?.blob.text()) ?? this.fileNow;
  }

  /** Its words were changed elsewhere since it was opened (in another app): whether replacing them is fine (asked). `now`: the file as it is now. */
  private keepsOther(now: string): Promise<boolean> | boolean {
    if (!now || wordsOf(this.kind, now) === this.base) return true;
    return confirmDialog({ title: "Changed in another app", lines: [`“${this.name}” was changed outside canvast since you opened it here.`, "Saving puts your version in its place, and the other changes are lost. Cancel, then close the note without saving and open it again to see the other version."], confirmLabel: "Save mine" });
  }

  /** Write the note's file as a new version (its properties back in, asked first when its words were changed elsewhere). `as`: the editor's content that `text` was made from. */
  private async write(text: string, as: string): Promise<boolean> {
    const { session, assets } = this.deps;
    const editor = this.editor!;
    this.saving = true;
    try {
      // (the editor holds the note without its properties: the item's, as they are now, go back into the file)
      const e = await session.catalog?.entry(this.hash).catch(() => undefined);
      const now = (await (await assets.record(this.hash).catch(() => undefined))?.blob.text()) ?? "";
      if (!(await this.keepsOther(now))) return false;
      if (this.kind === "md") text = underProps(now, text); // (what it keeps as written, in its order)
      // (Settings > Notes: the item's properties go in only when asked for; else the file's YAML stays as it is)
      if (e && this.kind !== "txt" && this.deps.settings.get("notes.writeProps")) text = withFileMeta(this.kind, text, { tags: e.tags ?? [], note: e.note ?? "", fields: e.fields ?? [] });
      text = withPastedProps(this.kind, text, editor.pastedProps());
      if (e?.name) this.name = e.name;
      const was = this.hash;
      text = stampNote(this.kind, text, e?.importedAt, Date.now(), editor.pastedProps());
      const hash = await session.saveVersion(was, new File([text], this.name, { type: this.type }));
      if (!hash) return false;
      if (open.has(this)) editor.saved(as); // (closed meanwhile: there is no editor left to tell; what was typed while it was being saved stays a change)
      this.base = wordsOf(this.kind, text);
      if (open.has(this) && this.hash === was) {
        this.hash = hash;
        this.place.moved(was, hash);
      }
      await this.renameFromNote(hash, text);
      void this.readWhole();
      session.editor.message = `Saved “${this.name}”.`;
      session.editor.changed();
      await this.place.refresh();
      return true;
    } finally {
      this.saving = false;
    }
  }

  /** A save on its way: pressed again meanwhile (Ctrl+S held, pressed fast), it is the same save; with changes made since, one more follows it, once. */
  private pending: Promise<boolean> | null = null;
  private followUp = false;
  /** Save the note. Whether it was saved. */
  save(): Promise<boolean> {
    if (this.pending && (this.followUp || !this.dirty)) return this.pending;
    const before = this.pending;
    this.followUp = !!before;
    const run: Promise<boolean> = before
      ? before.catch(() => false).then((ok) => {
          this.followUp = false;
          return this.dirty ? this.saveNow() : ok;
        })
      : this.saveNow();
    const mine: Promise<boolean> = run.finally(() => {
      if (this.pending === mine) this.pending = null;
    });
    this.pending = mine;
    return mine;
  }
  private async saveNow(): Promise<boolean> {
    const editor = this.editor;
    if (!editor || this.deps.session.editor.blockEdit()) return false;
    return this.write(editor.text(), editor.current());
  }

  /** Before the note is left (another item, Back, Esc, the window closed): its changes are saved or let go, or it stays open. Whether to go on. */
  async leave(): Promise<boolean> {
    if (this.pending) await this.pending.catch(() => false); // (a save on its way ends first: what it saved is no unsaved change)
    if (!this.dirty) return true;
    if (this.deps.settings.get("notes.saveOnClose")) return this.save(); // (Settings > Notes; not saved, it stays open)
    let remember = false;
    const how = await chooseDialog({
      title: "Unsaved changes",
      lines: [`“${this.name}” has changes that are not saved.`],
      choices: [
        { value: "save", label: "Save them", help: "Then go on." },
        { value: "drop", label: "Don't save", help: "The note stays as it was last saved." },
      ],
      confirmLabel: "Go on",
      // (ticked with Save them: Settings > Notes > Save notes on close is on, and the question is not asked again)
      remember: { label: "Don't ask again", set: (on) => void (remember = on) },
    });
    if (how === "save" && remember) this.deps.settings.set("notes.saveOnClose", true);
    if (how === "drop") this.editor?.saved();
    return how === "save" ? this.save() : how === "drop";
  }

  /**
   * Close the note. Changes still unsaved (closed by something else than the person: the library shown elsewhere) are saved. `stillThere`: its item is still in the library.
   */
  close(stillThere: boolean): void {
    const editor = this.editor;
    if (!editor || !open.delete(this)) return;
    if (editor.dirty && stillThere) void this.write(editor.text(), editor.current());
    editor.destroy();
  }
}

/** A note open anywhere has changes not saved. */
export const anyNoteDirty = (): boolean => [...open].some((n) => n.dirty);
/** Each open note's words as its file keeps them: tests and the debug hook. */
export const openNotesAsText = (): Array<{ name: string; text: string }> => [...open].flatMap((n) => (n.editorNow ? [{ name: n.name, text: n.editorNow.text() }] : []));
/** Ask about every open note with changes not saved (the window is closing): false when the person chose to stay. */
export async function leaveAllNotes(): Promise<boolean> {
  for (const n of [...open]) if (!(await n.leave())) return false;
  return true;
}
// (the browser build: leaving the page with a note's changes unsaved asks first; the desktop app asks in its own close, main.ts)
if (typeof window !== "undefined" && !desktopBridge()) window.addEventListener("beforeunload", (e) => void (anyNoteDirty() && e.preventDefault()));
