import type { Session } from "../app/session";
import type { AssetLibrary } from "../assets/asset-library";
import type { CatalogEntry } from "../assets/asset-catalog";
import { meta } from "../assets/asset-catalog";
import { chipOf } from "../assets/file-kind";
import type { SettingsStore } from "../settings/settings";
import { desktopBridge } from "../storage/desktop-bridge";
import { WIKI, linkTarget, noteKindOf, richNameOf, richNoteBody, wikiTarget } from "../notes/note-file";
import type { NoteKind } from "../notes/note-file";
import { splitFrontmatter, underProps, withFileMeta } from "../notes/frontmatter";
import { fontFor } from "../text/fonts";
import { chooseDialog, confirmDialog } from "./confirm";
import { openLibraryPicker } from "./library-picker";
import { mountNoteEditor } from "./note-editor";
import type { AttachKind, NoteEditor, NoteHost, NoteItem } from "./note-editor";

// A note open in the notes editor: the same for the library's viewer and for the canvas's note panel. Whoever shows it gives a
// `NotePlace` (how it imports files, shows another item, follows a new version); everything else (links, pictures, fonts,
// templates, saving, the questions asked) is here once.

/** What the place showing a note does for it. */
export interface NotePlace {
  /** The setting of the editor's style here (the library's when absent; the Note panel on a canvas has its own). */
  styleKey?: "notes.style" | "notes.panelStyle";
  /** The whole place the note is shown in: a press inside it is at the note, so the keyboard's Undo and Save are the note's. */
  root?(): HTMLElement | null;
  /** Files into the library: their hashes. */
  importFiles(files: File[]): Promise<string[]>;
  /** Show another item (a link followed, a rich text note just made). */
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
  /** The fonts of the library, loaded. */
  fonts: () => Promise<Array<{ hash: string; name: string; unusable: string }>>;
}

/** A note with this tag is a template: offered in Insert ▸ Template of every note. */
const TEMPLATE_TAG = "template";
const NOUNS: Record<AttachKind | "any", readonly [string, string]> = { image: ["picture", "pictures"], video: ["video", "videos"], audio: ["sound", "sounds"], file: ["file", "files"], any: ["item", "items"] };
/** A note file's words: without its properties (they are the library's too) and, for a rich text note, without its head. */
const wordsOf = (kind: NoteKind, file: string): string => (kind === "md" ? splitFrontmatter(file).body : kind === "rich" ? richNoteBody(file) : file).trim();
const titleOf = (name: string): string => name.replace(/\.(note\.html|md|markdown|txt)$/i, "");

/** The notes open now (the library's and the canvas's): a new version follows into them, and leaving the app asks about them. */
const open = new Set<OpenNote>();
const followed = new WeakSet<Session>();

/** A note open in the notes editor. */
export class OpenNote {
  private saving = false;
  private constructor(
    public hash: string,
    /** Its kind now: a note saved as rich text is one from then on. */
    public kind: NoteKind,
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
    note.editor = await mountNoteEditor(el, { kind, text, style: deps.settings.get(place.styleKey ?? "notes.style"), host, title: titleOf(name), root: place.root?.() ?? null });
    open.add(note);
    if (!followed.has(deps.session)) {
      followed.add(deps.session);
      // A new version of an open note (its properties written by a library change, the file saved elsewhere): it stays open.
      deps.session.onVersion((from, to) => {
        for (const n of open)
          if (n.hash === from && n.deps.session === deps.session) {
            n.hash = to;
            n.place.moved(from, to);
          }
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
    const { session, assets, fonts } = this.deps;
    const hash = this.hash;
    const listing = await session.catalog?.list().catch(() => null);
    const folders = listing?.folders ?? [];
    const all: CatalogEntry[] = (listing?.entries ?? []).filter((x) => x.present && (this.place.hidden() || !meta(x).hidden));
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
    const self = all.find((x) => x.hash === hash);
    const dir = (await pathOf(self ?? { hash, name: this.name, folderIds: [] })).slice(0, -1);
    const host: NoteHost = {
      dir,
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
        const list = all.filter((x) => fits(kind, x)).sort((a, b) => b.importedAt - a.importedAt);
        const chosen = await openLibraryPicker(
          null,
          list.map((x) => ({ hash: x.hash, name: x.name, ...(x.type.startsWith("image/") && !x.card ? {} : { chip: chipOf(x.name, x.type) }), thumb: () => session.thumbBlob(x.hash) })),
          { noun: NOUNS[kind], importFiles: { accept: kind === "file" || kind === "any" ? "" : `${kind}/*`, run: async (files) => (await take(files)).map((i) => i.hash) } },
        );
        const x = chosen ? all.find((y) => y.hash === chosen) : undefined;
        return x ? item(x) : null;
      },
      importFiles: take,
      async fonts() {
        const list = (await fonts()).filter((f) => !f.unusable && fontFor(f.hash).names.family);
        return [...new Set(["Inter", ...list.map((f) => fontFor(f.hash).names.family)])];
      },
      async linkables() {
        // A note by its name without `.md`, any other file by its whole name; a name two items share gets its folders in front.
        const keyOf = (x: CatalogEntry): string => (noteKindOf(x.name) === "md" ? x.name.replace(/\.(md|markdown)$/i, "") : x.name);
        const count = new Map<string, number>();
        for (const x of all) count.set(keyOf(x).toLowerCase(), (count.get(keyOf(x).toLowerCase()) ?? 0) + 1);
        const canvases = (session.tree?.boards ?? []).flatMap(({ board, canvases }) => canvases.map((c) => ({ key: `canvas:${c.name}`, name: c.name, hash: board.id })));
        return Promise.all([
          ...canvases,
          ...all.filter((x) => x.hash !== hash).map(async (x) => {
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
      tags: async () => [...new Set(all.flatMap((x) => x.tags ?? []))].sort((a, b) => a.localeCompare(b)),
      async findWiki(target) {
        const t = wikiTarget(target);
        const named = all.filter((x) => x.name.toLowerCase() === t.name || x.name.toLowerCase().replace(/\.(md|markdown|txt|note\.html)$/, "") === t.name);
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
    };
    return host;
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
      if (e && this.kind !== "txt") text = withFileMeta(this.kind, text, { tags: e.tags ?? [], note: e.note ?? "", fields: e.fields ?? [] });
      if (e?.name) this.name = e.name;
      const was = this.hash;
      const hash = await session.saveVersion(was, new File([text], this.name, { type: this.type }));
      if (!hash) return false;
      if (open.has(this)) editor.saved(as); // (closed meanwhile: there is no editor left to tell; what was typed while it was being saved stays a change)
      this.base = wordsOf(this.kind, text);
      if (open.has(this) && this.hash === was) {
        this.hash = hash;
        this.place.moved(was, hash);
      }
      session.editor.message = `Saved “${this.name}”.`;
      session.editor.changed();
      await this.place.refresh();
      return true;
    } finally {
      this.saving = false;
    }
  }

  /**
   * The note's formatting does not fit its markdown or text file: the note becomes a rich text note in its place (`plan.md` → `plan.note.html`,
   * renamed as the library renames, so links to it follow), saved as its new version: its folder, tags and cards on canvases follow it.
   */
  private async saveRich(show = true): Promise<boolean> {
    const { session, assets } = this.deps;
    // (read before anything is waited for: the note may be closing, and its editor gone by then)
    const editor = this.editor!;
    const body = editor.asRich("");
    const as = editor.current();
    this.saving = true;
    try {
      const e = await session.catalog?.entry(this.hash).catch(() => undefined);
      if (e?.name) this.name = e.name;
      const was = this.name;
      if (!(await this.keepsOther((await (await assets.record(this.hash).catch(() => undefined))?.blob.text()) ?? ""))) return false;
      // (a free name: another note may have this one already)
      const names = new Set(((await session.catalog?.list().catch(() => null))?.entries ?? []).filter((x) => x.hash !== this.hash).map((x) => x.name.toLowerCase()));
      const stem = richNameOf(this.name).slice(0, -".note.html".length);
      let name = `${stem}.note.html`;
      for (let n = 2; names.has(name.toLowerCase()); n++) name = `${stem} ${n}.note.html`;
      const rich = withFileMeta("rich", body.replace("<title></title>", () => `<title>${titleOf(name).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</title>`), { tags: e?.tags ?? [], note: e?.note ?? "", fields: e?.fields ?? [] }); // (its properties go with it)
      if (!(await session.renameAssets([{ hash: this.hash, name }]))) return false;
      const hash = await session.saveVersion(this.hash, new File([rich], name, { type: "text/html" }));
      if (!hash) {
        await session.renameAssets([{ hash: this.hash, name: was }]); // (not saved: it stays what its file is)
        return false;
      }
      this.name = name;
      this.kind = "rich";
      this.base = wordsOf("rich", rich);
      if (open.has(this)) editor.saved(as);
      session.editor.message = `“${was}” is now the rich text note “${name}”.`;
      session.editor.changed();
      // (opened again as what it is now, once this save has ended: showing it leaves this note, which waits for a save on its way)
      if (show) setTimeout(() => void this.place.show(hash));
      return true;
    } finally {
      this.saving = false;
    }
  }

  /** A save on its way: pressed again meanwhile (Ctrl+S held, pressed fast), it is the same save, not a second one. */
  private pending: Promise<boolean> | null = null;
  /** Save: a markdown or text note asks first when part of its formatting would be lost. Whether it was saved. */
  save(leaving = false): Promise<boolean> {
    this.pending ??= this.saveNow(leaving).finally(() => (this.pending = null));
    return this.pending;
  }
  /** `leaving`: the note is being left, so a note made rich text is not opened again. */
  private async saveNow(leaving: boolean): Promise<boolean> {
    const editor = this.editor;
    if (!editor || this.deps.session.editor.blockEdit()) return false;
    if (this.kind === "rich") {
      const text = editor.asRich(titleOf(this.name));
      return this.write(text, editor.current());
    }
    const { text, keepsAll } = editor.asText(this.kind);
    const as = editor.current();
    if (keepsAll) return this.write(text, as);
    const plain = this.kind === "md" ? "markdown" : "plain text";
    const how = await chooseDialog({
      title: "Save the note",
      lines: [`Part of the formatting of “${this.name}” cannot be kept in a ${plain} file: fonts, sizes, colours, alignment or the page layout.`],
      choices: [
        { value: "rich", label: "Save as a rich text note", help: `Keeps everything: “${this.name}” becomes “${richNameOf(this.name)}” (its folder, tags, links and cards on canvases follow it).` },
        { value: "text", label: `Save as plain ${plain}`, help: this.kind === "md" ? "Keeps the text, headings, lists, links, tables and pictures; the rest of the formatting is dropped." : "Keeps the words only." },
      ],
      confirmLabel: "Save",
    });
    return how === "rich" ? this.saveRich(!leaving) : how === "text" ? this.write(text, as) : false;
  }

  /** Before the note is left (another item, Back, Esc, the window closed): its changes are saved or let go, or it stays open. Whether to go on. */
  async leave(): Promise<boolean> {
    if (this.pending) await this.pending.catch(() => false); // (a save on its way ends first: what it saved is no unsaved change)
    if (!this.dirty) return true;
    const how = await chooseDialog({
      title: "Unsaved changes",
      lines: [`“${this.name}” has changes that are not saved.`],
      choices: [
        { value: "save", label: "Save them", help: "Then go on." },
        { value: "drop", label: "Don't save", help: "The note stays as it was last saved." },
      ],
      confirmLabel: "Go on",
    });
    if (how === "drop") this.editor?.saved();
    return how === "save" ? this.save(true) : how === "drop";
  }

  /**
   * Close the note. Changes still unsaved (closed by something else than the person: the library shown elsewhere) are saved without
   * losing anything: as its own file when that keeps all, else as a rich text note in its place. `stillThere`: its item is still in the library.
   */
  close(stillThere: boolean): void {
    const editor = this.editor;
    if (!editor || !open.delete(this)) return;
    if (editor.dirty && stillThere) {
      const kept = this.kind === "rich" ? null : editor.asText(this.kind);
      if (!kept || kept.keepsAll) void this.write(kept ? kept.text : editor.asRich(titleOf(this.name)), editor.current());
      else void this.saveRich(false);
    }
    editor.destroy();
  }
}

/** A note open anywhere has changes not saved. */
export const anyNoteDirty = (): boolean => [...open].some((n) => n.dirty);
/** Each open note as its own kind's text, and whether that text keeps all of it (what Save would ask about): tests and the debug hook. */
export const openNotesAsText = (): Array<{ name: string; text: string; keepsAll: boolean }> =>
  [...open].flatMap((n) => (n.kind === "rich" || !n.editorNow ? [] : [{ name: n.name, ...n.editorNow.asText(n.kind) }]));
/** Ask about every open note with changes not saved (the window is closing): false when the person chose to stay. */
export async function leaveAllNotes(): Promise<boolean> {
  for (const n of [...open]) if (!(await n.leave())) return false;
  return true;
}
// (the browser build: leaving the page with a note's changes unsaved asks first; the desktop app asks in its own close, main.ts)
if (typeof window !== "undefined" && !desktopBridge()) window.addEventListener("beforeunload", (e) => void (anyNoteDirty() && e.preventDefault()));
