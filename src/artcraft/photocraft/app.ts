import * as D from "../../core/dyadic";
import { normalizeUnit, translate } from "../../doc/edit-ops";
import { homeObject, newObjectId } from "../../doc/model";
import type { ImageObject } from "../../doc/model";
import type { DocumentStore } from "../../doc/document-store";
import type { AssetLibrary, AssetRecord } from "../../assets/asset-library";
import { meta } from "../../assets/asset-catalog";
import type { SettingsStore } from "../../settings/settings";
import type { EditorState } from "../../app/editor-state";
import type { Session } from "../../app/session";
import type { ExportTarget, RenderDeps } from "../../app/export-render";
import { exportTarget } from "../../app/actions";
import { editedName } from "../../app/frames";
import { fileInLibrary } from "../../app/library-filing";
import { parseTags } from "../../app/screenshot";
import { cleanName, splitName } from "../../doc/file-names";
import { isContainer } from "../../doc/containers";
import { PHOTOCRAFT_FEATURES, PHOTOCRAFT_OPENS } from "./features";
import { photoCraftPayload } from "./payload";
import { startPhotoCraft } from "./frame";
import type { PhotoCraftFrame } from "./frame";
import { PREFS_KEY } from "./prefs";
import { createState } from "./state";
import { layeredProject } from "./layers";
import { chooseProjectSize } from "./size-dialog";
import { mountPhotoCraftView } from "./view";
import type { PhotoCraftView } from "./view";
import { chooseDialog, confirmDialog } from "../../ui/confirm";
import { openLibraryPicker } from "../../ui/library-picker";
import { openMoreMenu } from "../../ui/more-menu";
import { ICONS } from "../../ui/icons";
import { plural } from "../../doc/plural";

/**
 * PhotoCraft in canvast (Settings > ArtCraft > PhotoCraft): the photo editor's own released build, a view of its own beside Library
 * (src/artcraft/photocraft/), running while another view is shown. It opens on what is selected on a canvas (pictures, each in its own
 * document or as layers of one; a sheet as a layered project), on a library item of any kind it reads, or blank. What it saves comes back:
 * a new library item, and on the canvas in place of the picture it came from or beside it (asked), or beside the sheet or pictures a
 * project was made of. The original file is never written over. Its own preferences and presets are kept with the workspace (state.ts).
 */

/** Where a document open in PhotoCraft came from, by the name it was given. */
type Origin =
  | { kind: "canvas"; objectId: string; hash: string; name: string }
  | { kind: "library"; hash: string; name: string }
  /** A project made of a sheet or several pictures: what it saves is placed beside their box. */
  | { kind: "beside"; target: ExportTarget; name: string };

export interface PhotoCraftDeps {
  doc: DocumentStore;
  editor: EditorState;
  assets: AssetLibrary;
  session: Session;
  settings: SettingsStore;
  /** What Export draws with (a layered project's layers). */
  renderDeps(): RenderDeps;
  /** A library item's name, when known (synchronous: for whether the Actions bar offers PhotoCraft). */
  nameOf(hash: string): string | undefined;
  /** The library's fonts, loaded (their family and style as their own names say). */
  fonts(): Promise<Array<{ hash: string; family: string; style: string; ext: string }>>;
  /** Show PhotoCraft's view (the app's view switch then calls `show`). */
  enterView(): void;
  /** Back to the view it was opened from (its Close). */
  leaveView(): void;
  /** It started or stopped (its tab's ×, to close it, shows while it runs). */
  runningChanged(on: boolean): void;
}

export interface PhotoCraftApp {
  /** Whether this build has PhotoCraft. */
  readonly available: boolean;
  /** Whether the Actions bar offers Edit in PhotoCraft for what is selected: a sheet, or pictures of a kind it opens. */
  offered(): boolean;
  /** Edit what is selected (from the Actions bar's button, `anchor`, for the choice of several pictures). */
  editSelection(anchor: HTMLElement | null): Promise<void>;
  /** Edit a library item. */
  editItem(hash: string): Promise<void>;
  /** A blank PhotoCraft (the command list). */
  openBlank(): void;
  /** Its view is shown: started if it is not running. */
  show(): void;
  /** Another view is shown: it keeps running; what it keeps is taken into the workspace. */
  hide(): void;
  /** Close it (asked first when a document in it has unsaved changes), and go back to the view it came from. */
  close(): Promise<void>;
  /** For the debug hook: whether it is open and running, and what came back from it. */
  state(): { open: boolean; ready: boolean; saved: number; failed: string };
}

/** Whether PhotoCraft opens a file of this name and type (not a video or a sound). */
export const editableInPhotoCraft = (name: string, type = ""): boolean =>
  !type.startsWith("video/") && !type.startsWith("audio/") && PHOTOCRAFT_OPENS.includes(splitName(name).ext.replace(/^\./, "").toLowerCase());

export function createPhotoCraft(deps: PhotoCraftDeps): PhotoCraftApp {
  const { doc, editor, assets, session, settings } = deps;
  const F = PHOTOCRAFT_FEATURES;
  let view: PhotoCraftView | null = null;
  let frame: PhotoCraftFrame | null = null;
  let starting: Promise<PhotoCraftFrame> | null = null;
  let ready = false;
  let savedCount = 0;
  let failed = "";
  let keepTimer = 0;
  /** A layered project is being made: its line stays until it is open in PhotoCraft. */
  let making = false;
  const origins = new Map<string, Origin>();
  const stem = (name: string): string => splitName(name).stem.toLowerCase();
  const state = createState({ settings, session, assets });
  /** What happened, in the app's notices (shown over PhotoCraft's view too). */
  const say = (text: string): void => {
    editor.message = text;
    editor.changed();
  };

  // Its preferences as soon as it saves them (its frame writing the browser's storage tells this page).
  window.addEventListener("storage", (e) => {
    if (e.key === PREFS_KEY && frame) state.keepPrefs(e.newValue);
  });

  /** A file it saved: into the library, and back on the canvas when it came from there. */
  async function saved(name: string, blob: Blob): Promise<void> {
    savedCount++;
    // (by the name it opened with; renamed in its Save As, it is still the one file open, when only one is)
    const origin = origins.get(stem(name)) ?? (origins.size === 1 ? [...origins.values()][0] : undefined);
    const sameName = origin && origin.kind !== "beside" && name.toLowerCase() === origin.name.toLowerCase();
    const fileName = sameName ? `${editedName(session, settings, origin.name)}${splitName(name).ext}` : name;
    const { record } = await assets.importFileDetailed(new File([blob], fileName, { type: blob.type }), true);
    const tags: string[] = [];
    if (settings.get("edit.tagEdited")) tags.push("edited-picture");
    if (origin && origin.kind !== "beside" && settings.get("edit.tagInherit")) tags.push(...((await session.catalog?.entry(origin.hash).catch(() => undefined))?.tags ?? []));
    tags.push(...parseTags(settings.get("edit.tagsCustom")));
    const where = await fileInLibrary(session, record.hash, settings.get("edit.folder"), tags);
    const placeable = !record.type.startsWith("video/") && !record.type.startsWith("audio/");
    if (origin?.kind === "beside" && placeable) return placeBeside(origin.target, record, where);
    if (origin?.kind !== "canvas" || !placeable) return say(`“${record.name}” saved from PhotoCraft to ${where}.`);
    const o = doc.get(origin.objectId);
    if (!o || o.kind !== "image") return say(`“${record.name}” saved from PhotoCraft to ${where} (its picture is no longer on the canvas).`);
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

  /** The edited file on the canvas: in place of `o` (one step of undo) or beside it. */
  function putOnCanvas(o: ImageObject, record: AssetRecord, replace: boolean): void {
    const h = (o.w * record.pixelH) / Math.max(1, record.pixelW);
    if (replace) {
      const sameSize = record.pixelW === o.pixelW && record.pixelH === o.pixelH;
      // (a card's page or view belongs to the old file)
      const { crop, preview: _pv, ...rest } = o;
      const next: ImageObject = { ...rest, ...(sameSize && crop ? { crop } : {}), assetId: record.hash, pixelW: record.pixelW, pixelH: record.pixelH, h: sameSize ? o.h : h };
      doc.commit(doc.transaction("Edit in PhotoCraft", [next]));
      editor.select([o.id]);
      say(`The picture on the canvas now shows “${record.name}”, saved from PhotoCraft.`);
    } else {
      const { crop: _c, flipX: _fx, flipY: _fy, adjust: _a, groups: _g, hidden: _h, locked: _l, parent: _p, preview: _pv, ...rest } = o;
      const copy: ImageObject = { ...rest, id: newObjectId(), assetId: record.hash, pixelW: record.pixelW, pixelH: record.pixelH, h, z: doc.topZ() + 1 };
      const placed = translate(copy, D.shift(D.fromNumber(o.w * 1.05), o.unit), D.ZERO) as ImageObject;
      doc.commit(doc.transaction("Edit in PhotoCraft", [placed]));
      editor.select([placed.id]);
      say(`“${record.name}”, saved from PhotoCraft, placed beside the picture on the canvas.`);
    }
    editor.changed();
  }

  /** A saved project beside the sheet or pictures it was made of: as wide as their box, a twentieth of it apart. */
  function placeBeside(t: ExportTarget, record: AssetRecord, where: string): void {
    const unit = Math.floor(D.log2Abs(D.sub(t.max.x, t.min.x))) - 10;
    const w = D.diffToNumber(t.max.x, t.min.x, -unit);
    const img: ImageObject = {
      id: newObjectId(),
      kind: "image",
      ...(t.frame === doc.space.world ? {} : { frame: t.frame }),
      anchor: { x: D.add(t.max.x, D.shift(D.fromNumber(w * 0.05), unit)), y: t.min.y },
      unit,
      z: doc.topZ() + 1,
      opacity: 1,
      attachmentTargetId: null,
      assetId: record.hash,
      w,
      h: (w * record.pixelH) / Math.max(1, record.pixelW),
      pixelW: record.pixelW,
      pixelH: record.pixelH,
    };
    const placed = homeObject(normalizeUnit(img), doc.space);
    doc.commit(doc.transaction("Edit in PhotoCraft", [placed]));
    say(`“${record.name}”, saved from PhotoCraft to ${where}, placed beside the ${t.kind === "sheet" ? "sheet" : "pictures"} on the canvas.`);
  }

  /** The library chooser for its File > Open and Place: every item of a kind it opens (by its `accept`), hidden ones left out. */
  async function pick(accept: string): Promise<File[] | null> {
    const exts = accept.split(",").map((a) => a.trim().toLowerCase()).filter((a) => a.startsWith("."));
    const fits = (name: string): boolean => (exts.length ? exts.some((x) => name.toLowerCase().endsWith(x)) : editableInPhotoCraft(name));
    const list = (await session.catalog?.list().catch(() => undefined))?.entries ?? [];
    const items = list
      .filter((e) => e.present && !meta(e).hidden && fits(e.name))
      .sort((a, b) => b.importedAt - a.importedAt)
      .map((e) => ({ hash: e.hash, name: e.name, ...(e.type.startsWith("image/") && !e.card ? {} : { chip: splitName(e.name).ext.replace(/^\./, "").toUpperCase() }), thumb: async () => (await session.catalog?.thumb(e.hash).catch(() => undefined))?.blob }));
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

  /** PhotoCraft running in its view: the workspace's preferences and presets put back first (once per start). */
  function ensureStarted(): Promise<PhotoCraftFrame> {
    if (frame) return Promise.resolve(frame);
    starting ??= (async () => {
      const v = (view ??= mountPhotoCraftView());
      failed = "";
      v.status("Starting PhotoCraft…");
      await state.restore().catch(() => undefined);
      const started = startPhotoCraft(v.body, {
        pick: (accept) => pick(accept),
        saved: (name, blob) => void saved(name, blob).catch((e: unknown) => say(`What PhotoCraft saved could not be kept: ${String(e)}`)),
        fonts: async () => (await deps.fonts()).map((f) => ({ family: f.family, style: f.style, ext: f.ext, blob: async () => (await assets.record(f.hash).catch(() => undefined))?.blob ?? null })),
        failed: (m) => {
          failed = m;
          view?.status(m);
        },
        reload: () => {
          void stop().then(() => show());
        },
      });
      frame = started;
      deps.runningChanged(true);
      started.ready.then(() => {
        ready = true;
        if (!making) view?.status("");
      }, (e: unknown) => {
        failed = String((e as Error)?.message ?? e);
        view?.status(`PhotoCraft could not start: ${failed}`);
      });
      // (its presets while it runs: a change is taken into the workspace within a minute)
      keepTimer = window.setInterval(() => void state.keep(), 60_000);
      return started;
    })().finally(() => {
      starting = null;
    });
    return starting;
  }

  /** It stops: its frame goes, and what it kept is taken into the workspace. */
  async function stop(): Promise<void> {
    window.clearInterval(keepTimer);
    frame?.destroy();
    frame = null;
    ready = false;
    deps.runningChanged(false);
    origins.clear();
    await state.keep();
  }

  async function askClose(): Promise<void> {
    if (frame?.unsaved() && !(await confirmDialog({ title: "Close PhotoCraft?", lines: ["A document in it has changes that were not saved. They are lost when PhotoCraft closes."], confirmLabel: "Close it", danger: true }))) return;
    await stop();
    deps.leaveView();
  }

  function show(): void {
    if (!photoCraftPayload()) return say("PhotoCraft is not in this build.");
    view ??= mountPhotoCraftView();
    view.show();
    void ensureStarted();
  }

  /** Opens files in it (its view shown, started if need be). */
  async function open(files: readonly File[]): Promise<void> {
    if (!photoCraftPayload()) return say("PhotoCraft is not in this build.");
    deps.enterView();
    const f = await ensureStarted();
    if (files.length) await f.open(files).catch(() => undefined);
  }

  /** The selected pictures of a kind it opens, with their files (hidden items left out: their names would stay in its storage). */
  async function selectedPictures(): Promise<Array<{ o: ImageObject; rec: AssetRecord }>> {
    const out: Array<{ o: ImageObject; rec: AssetRecord }> = [];
    for (const id of editor.selection) {
      const o = doc.get(id);
      if (o?.kind !== "image" || o.media) continue;
      const rec = await assets.record(o.assetId).catch(() => undefined);
      if (!rec || !editableInPhotoCraft(rec.name, rec.type)) continue;
      const entry = await session.catalog?.entry(o.assetId).catch(() => undefined);
      if (entry && meta(entry).hidden) continue;
      out.push({ o, rec });
    }
    return out;
  }

  async function eachInItsOwn(pics: ReadonlyArray<{ o: ImageObject; rec: AssetRecord }>): Promise<void> {
    for (const { o, rec } of pics) origins.set(stem(rec.name), { kind: "canvas", objectId: o.id, hash: rec.hash, name: rec.name });
    await open(pics.map(({ rec }) => new File([rec.blob], rec.name, { type: rec.type })));
  }

  /** A sheet, or several pictures, as one layered project (its size asked as Export asks). */
  async function asProject(t: ExportTarget, name: string): Promise<void> {
    const layers = [...t.ids].filter((id) => {
      const o = doc.get(id);
      return o && !o.hidden && !o.isMask && !(o.kind === "path" && o.backdrop);
    }).length;
    // (the scale at which its sharpest picture keeps all its pixels)
    let sharpest: number | null = null;
    for (const id of t.ids) {
      const o = doc.get(id);
      if (o?.kind === "image" && o.w > 0) sharpest = Math.max(sharpest ?? 0, o.pixelW / (o.w * 2 ** o.unit));
    }
    const choice = await chooseProjectSize({ title: `Open ${t.kind === "sheet" ? `the sheet “${name}”` : "the pictures"} in PhotoCraft`, ratio: t.ratio, world: t.world ?? null, layers, rule: settings.get("photocraft.sizeRule"), value: settings.get("photocraft.sizeValue"), sharpest });
    if (!choice) return;
    settings.set("photocraft.sizeRule", choice.rule);
    settings.set("photocraft.sizeValue", choice.value);
    deps.enterView();
    making = true;
    view?.busy(true);
    view?.status(`Making ${plural(layers, "layer")}…`);
    try {
      const file = await layeredProject(deps.renderDeps(), t, choice.w, choice.h, cleanName(name, "clean", "project"), (done, total) => view?.status(`Making the layers: ${done} of ${total}…`));
      origins.set(stem(file.name), { kind: "beside", target: t, name: file.name });
      await open([file]);
      view?.status("");
    } catch (e) {
      view?.status(`The project could not be made: ${(e as Error).message}`);
    } finally {
      making = false;
      view?.busy(false);
    }
  }

  return {
    available: !!photoCraftPayload(),
    offered() {
      const sel = [...editor.selection].map((id) => doc.get(id));
      if (F.entry.sheets && sel.length >= 1 && isContainer(sel[0])) return true;
      return sel.some((o) => o?.kind === "image" && !o.media && editableInPhotoCraft(deps.nameOf(o.assetId) ?? ""));
    },
    async editSelection(anchor) {
      const t = exportTarget(doc, editor);
      if (t?.kind === "sheet" && F.entry.sheets) return asProject(t, t.name);
      const pics = await selectedPictures();
      const all = [...editor.selection].filter((id) => doc.get(id)?.kind === "image").length;
      if (!pics.length) return say("PhotoCraft opens pictures and art files that are not hidden: none is selected.");
      if (pics.length < all) say(`${plural(all - pics.length, "picture")} left out: PhotoCraft does not open ${all - pics.length === 1 ? "its" : "their"} kind of file, or ${all - pics.length === 1 ? "it is" : "they are"} hidden.`);
      if (pics.length === 1 || !F.entry.layers || !anchor || !t) return eachInItsOwn(pics);
      openMoreMenu(anchor, [
        { id: "photocraft-each", label: "Each in its own document", hint: "A tab for each picture", icon: ICONS.files, run: () => void eachInItsOwn(pics) },
        { id: "photocraft-layers", label: "As layers of one document", hint: "Placed as on the canvas", icon: ICONS.layers, run: () => void asProject({ ...t, ids: new Set(pics.map((p) => p.o.id)) }, "pictures") },
      ], "Edit in PhotoCraft");
    },
    close: askClose,
    async editItem(hash) {
      const rec = await assets.record(hash).catch(() => undefined);
      const entry = await session.catalog?.entry(hash).catch(() => undefined);
      if (!rec) return say("That file could not be read.");
      if (entry && meta(entry).hidden) return say("Hidden items do not open in PhotoCraft (its own storage would keep their names).");
      origins.set(stem(rec.name), { kind: "library", hash, name: rec.name });
      await open([new File([rec.blob], rec.name, { type: rec.type })]);
    },
    openBlank: () => void open([]),
    show,
    hide() {
      view?.hide();
      if (frame) void state.keep();
    },
    state: () => ({ open: !!frame, ready, saved: savedCount, failed }),
  };
}

export { PHOTOCRAFT_FEATURES };
