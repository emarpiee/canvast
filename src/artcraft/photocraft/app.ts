import * as D from "../../core/dyadic";
import { translate } from "../../doc/edit-ops";
import { newObjectId } from "../../doc/model";
import type { ImageObject } from "../../doc/model";
import type { DocumentStore } from "../../doc/document-store";
import type { AssetLibrary, AssetRecord } from "../../assets/asset-library";
import { meta } from "../../assets/asset-catalog";
import type { SettingsStore } from "../../settings/settings";
import type { EditorState } from "../../app/editor-state";
import type { Session } from "../../app/session";
import { editedName } from "../../app/frames";
import { fileInLibrary } from "../../app/library-filing";
import { parseTags } from "../../app/screenshot";
import { PHOTOCRAFT_FEATURES } from "./features";
import { photoCraftPayload } from "./payload";
import { startPhotoCraft } from "./frame";
import type { PhotoCraftFrame } from "./frame";
import { mountPhotoCraftView } from "./view";
import type { PhotoCraftView } from "./view";
import { chooseDialog, confirmDialog } from "../../ui/confirm";
import { openLibraryPicker } from "../../ui/library-picker";
import { plural } from "../../doc/plural";

/**
 * PhotoCraft in canvast (Settings > ArtCraft > PhotoCraft): the photo editor's own released build in a view over the app
 * (src/artcraft/photocraft/), opened on what is selected on a canvas, on a library item, or blank. What it saves comes back: a picture from a
 * canvas replaces it there or goes beside it (asked, unless Settings says which), anything else becomes a new library item. The original
 * file is never written over.
 */

/** Where a document open in PhotoCraft came from, by the name it was given. */
type Origin =
  | { kind: "canvas"; objectId: string; hash: string; name: string }
  | { kind: "library"; hash: string; name: string };

export interface PhotoCraftDeps {
  doc: DocumentStore;
  editor: EditorState;
  assets: AssetLibrary;
  session: Session;
  settings: SettingsStore;
  /** The library's fonts, loaded (their family and style as their own names say). */
  fonts(): Promise<Array<{ hash: string; family: string; style: string; ext: string }>>;
  /** Go to the canvas view (a picture was placed there). */
  showCanvas(): void;
}

export interface PhotoCraftApp {
  /** Whether this build has PhotoCraft. */
  readonly available: boolean;
  /** Edit the selected still pictures of the canvas, each in a tab of its own. */
  editSelection(): Promise<void>;
  /** Edit a library item. */
  editItem(hash: string): Promise<void>;
  /** A blank PhotoCraft. */
  openBlank(): Promise<void>;
  /** For the debug hook: whether it is open and running, and what came back from it. */
  state(): { open: boolean; ready: boolean; saved: number; failed: string };
}

/** Whether a library item or picture is a still picture PhotoCraft can open (its own formats it opens from the library chooser). */
export const editableInPhotoCraft = (type: string, card?: boolean): boolean => type.startsWith("image/") && !card && type !== "image/gif" && type !== "image/svg+xml";

export function createPhotoCraft(deps: PhotoCraftDeps): PhotoCraftApp {
  const { doc, editor, assets, session, settings } = deps;
  const say = (text: string): void => {
    editor.message = text;
    editor.changed();
  };
  let view: PhotoCraftView | null = null;
  let frame: PhotoCraftFrame | null = null;
  let ready = false;
  let savedCount = 0;
  let failed = "";
  const origins = new Map<string, Origin>();
  const stem = (name: string): string => name.replace(/\.[^.]*$/, "").toLowerCase();

  /** A file it saved: into the library, and back on the canvas when it came from there. */
  async function saved(name: string, blob: Blob): Promise<void> {
    savedCount++;
    // (by the name it opened with; renamed in its Save As, it is still the one file open, when only one is)
    const origin = origins.get(stem(name)) ?? (origins.size === 1 ? [...origins.values()][0] : undefined);
    const sameName = origin && name.toLowerCase() === origin.name.toLowerCase();
    const fileName = sameName ? `${editedName(session, settings, origin.name)}${/\.[^.]*$/.exec(name)?.[0] ?? ""}` : name;
    const { record } = await assets.importFileDetailed(new File([blob], fileName, { type: blob.type }), true);
    const tags: string[] = [];
    if (settings.get("edit.tagEdited")) tags.push("edited-picture");
    if (origin && settings.get("edit.tagInherit")) tags.push(...((await session.catalog?.entry(origin.hash).catch(() => undefined))?.tags ?? []));
    tags.push(...parseTags(settings.get("edit.tagsCustom")));
    const where = await fileInLibrary(session, record.hash, settings.get("edit.folder"), tags);
    if (origin?.kind !== "canvas") return say(`“${record.name}” saved from PhotoCraft to ${where}.`);
    const o = doc.get(origin.objectId);
    if (!o || o.kind !== "image" || !editableInPhotoCraft(record.type, record.card)) return say(`“${record.name}” saved from PhotoCraft to ${where}.`);
    let how = settings.get("photocraft.saveCanvas");
    if (how === "ask") {
      let remember = false;
      const answer = await chooseDialog({
        title: "Put the edited picture on the canvas",
        lines: [`“${record.name}” is in the library (${where}).`],
        choices: [
          { value: "replace", label: "Replace the picture", help: "The picture on the canvas shows the edited file. Undo brings the old one back; its file stays in the library." },
          { value: "beside", label: "Add it beside", help: "A new picture next to the old one, which stays as it was." },
        ],
        confirmLabel: "Put it on the canvas",
        remember: { label: "Don't ask again (Settings > ArtCraft > PhotoCraft)", set: (on) => { remember = on; } },
      });
      if (!answer) return say(`“${record.name}” saved to ${where}; the canvas is as it was.`);
      how = answer as "replace" | "beside";
      if (remember) settings.set("photocraft.saveCanvas", how);
    }
    putOnCanvas(o, record, how === "replace");
  }

  /** The edited picture on the canvas: in place of `o` (one step of undo) or beside it. */
  function putOnCanvas(o: ImageObject, record: AssetRecord, replace: boolean): void {
    const h = (o.w * record.pixelH) / Math.max(1, record.pixelW);
    if (replace) {
      const sameSize = record.pixelW === o.pixelW && record.pixelH === o.pixelH;
      const { crop, ...rest } = o;
      const next: ImageObject = { ...rest, ...(sameSize && crop ? { crop } : {}), assetId: record.hash, pixelW: record.pixelW, pixelH: record.pixelH, h: sameSize ? o.h : h };
      doc.commit(doc.transaction("Edit in PhotoCraft", [next]));
      editor.select([o.id]);
      say(`The picture now shows “${record.name}”, saved from PhotoCraft.`);
    } else {
      const { crop: _c, flipX: _fx, flipY: _fy, adjust: _a, groups: _g, hidden: _h, locked: _l, parent: _p, ...rest } = o;
      const copy: ImageObject = { ...rest, id: newObjectId(), assetId: record.hash, pixelW: record.pixelW, pixelH: record.pixelH, h, z: doc.topZ() + 1 };
      const placed = translate(copy, D.shift(D.fromNumber(o.w * 1.05), o.unit), D.ZERO) as ImageObject;
      doc.commit(doc.transaction("Edit in PhotoCraft", [placed]));
      editor.select([placed.id]);
      say(`“${record.name}”, saved from PhotoCraft, placed beside the picture.`);
    }
    editor.changed();
  }

  /** The library chooser for its File > Open and Place. */
  async function pick(accept: string): Promise<File[] | null> {
    const exts = accept.split(",").map((a) => a.trim().toLowerCase()).filter((a) => a.startsWith("."));
    const fits = (name: string): boolean => !exts.length || exts.some((x) => name.toLowerCase().endsWith(x));
    const list = (await session.catalog?.list().catch(() => undefined))?.entries ?? [];
    const items = list
      .filter((e) => e.present && !meta(e).hidden && fits(e.name))
      .sort((a, b) => b.importedAt - a.importedAt)
      .map((e) => ({ hash: e.hash, name: e.name, thumb: async () => (await session.catalog?.thumb(e.hash).catch(() => undefined))?.blob }));
    const hash = await openLibraryPicker(null, items, {
      noun: ["file", "files"],
      importFiles: { accept, run: async (files) => (await Promise.all(files.map((f) => assets.importFileDetailed(f, true)))).map((r) => r.record.hash) },
    });
    if (!hash) return null;
    const rec = await assets.record(hash).catch(() => undefined);
    if (!rec) return null;
    origins.set(stem(rec.name), { kind: "library", hash, name: rec.name });
    return [new File([rec.blob], rec.name, { type: rec.type })];
  }

  function close(): void {
    frame?.destroy();
    frame = null;
    ready = false;
    origins.clear();
    view?.hide();
  }

  async function askClose(): Promise<void> {
    if (frame?.unsaved() && !(await confirmDialog({ title: "Close PhotoCraft?", lines: ["A document in it has changes that were not saved. They are lost when PhotoCraft closes."], confirmLabel: "Close it", danger: true }))) return;
    close();
  }

  /** Opens PhotoCraft (or brings it back), then the files in it. */
  async function open(files: File[]): Promise<void> {
    if (!photoCraftPayload()) return say("PhotoCraft is not in this build.");
    view ??= mountPhotoCraftView(() => void askClose());
    view.show();
    if (!frame) {
      failed = "";
      const started = startPhotoCraft(view.body, {
        pick: (accept) => pick(accept),
        saved: (name, blob) => void saved(name, blob).catch((e: unknown) => say(`What PhotoCraft saved could not be kept: ${String(e)}`)),
        fonts: async () => (await deps.fonts()).map((f) => ({ family: f.family, style: f.style, ext: f.ext, blob: async () => (await assets.record(f.hash).catch(() => undefined))?.blob ?? null })),
        failed: (m) => {
          failed = m;
          view?.status(m);
        },
        reload: () => {
          close();
          void open([]);
        },
      });
      frame = started;
      view.status("Starting PhotoCraft…");
      started.ready.then(() => {
        ready = true;
        view?.status("");
      }, (e: unknown) => {
        failed = String((e as Error)?.message ?? e);
        view?.status(`PhotoCraft could not start: ${failed}`);
      });
    }
    if (files.length) await frame.open(files).catch(() => undefined);
  }

  return {
    available: !!photoCraftPayload(),
    async editSelection() {
      const pics = [...editor.selection].map((id) => doc.get(id)).filter((o): o is ImageObject => o?.kind === "image" && !o.media);
      const files: File[] = [];
      for (const o of pics) {
        const rec = await assets.record(o.assetId).catch(() => undefined);
        if (!rec || !editableInPhotoCraft(rec.type, rec.card)) continue;
        const entry = await session.catalog?.entry(o.assetId).catch(() => undefined);
        if (entry && meta(entry).hidden) continue; // (a hidden item's name would stay in PhotoCraft's own storage)
        origins.set(stem(rec.name), { kind: "canvas", objectId: o.id, hash: rec.hash, name: rec.name });
        files.push(new File([rec.blob], rec.name, { type: rec.type }));
      }
      if (!files.length) return say("PhotoCraft opens still pictures that are not hidden: none is selected.");
      if (files.length < pics.length) say(`${plural(pics.length - files.length, "picture")} left out: PhotoCraft opens still pictures that are not hidden.`);
      await open(files);
    },
    async editItem(hash) {
      const rec = await assets.record(hash).catch(() => undefined);
      const entry = await session.catalog?.entry(hash).catch(() => undefined);
      if (!rec) return say("That file could not be read.");
      if (entry && meta(entry).hidden) return say("Hidden items do not open in PhotoCraft (its own storage would keep their names).");
      origins.set(stem(rec.name), { kind: "library", hash, name: rec.name });
      await open([new File([rec.blob], rec.name, { type: rec.type })]);
    },
    openBlank: () => open([]),
    state: () => ({ open: !!frame, ready, saved: savedCount, failed }),
  };
}

export { PHOTOCRAFT_FEATURES };
