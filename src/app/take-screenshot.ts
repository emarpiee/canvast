import type { DocumentStore } from "../doc/document-store";
import { pressCommand } from "../commands/registry";
import { visibleObjects } from "../render/scene-view";
import type { FrameIndex } from "../scene/frame-index";
import type { SettingsStore } from "../settings/settings";
import type { AssetLibrary } from "../assets/asset-library";
import { forgetCopiedPicture } from "./actions";
import type { EditorState } from "./editor-state";
import { fileInLibrary } from "./library-filing";
import { SHOT_FORMATS, encodeShot, nameWords, shotFileName, shotTags, withInterface } from "./screenshot";
import type { Session } from "./session";
import { writeSystemClipboard } from "./system-clipboard";
import type { ViewState } from "./view-state";

/** What a screenshot needs of the main view: its canvas, document, camera, the frame drawn clean, the library to save into. */
export interface ScreenshotDeps {
  session: Session;
  settings: SettingsStore;
  assets: AssetLibrary;
  doc: DocumentStore;
  editor: EditorState;
  view: ViewState;
  index: FrameIndex;
  canvas: HTMLCanvasElement;
  host: HTMLElement;
  appView(): string;
  dpr(): number;
  /** Draw it now with these choices (no overlays: no selection outlines). */
  renderNow(o: { pattern: boolean; overlays: boolean; transparent: boolean }): unknown;
  invalidate(): void;
  /** Hidden pictures drawn as padlocks while `capture` runs. */
  padlocked<T>(capture: () => T): T;
}

/**
 * Screenshot (ADR 0080): what the canvas shows, without the selection outlines, saved to the library with the name, folder and tags of
 * Settings > Screenshot (and copied, when it says so).
 */
export function makeTakeScreenshot(d: ScreenshotDeps): () => Promise<void> {
  const { session, settings, assets, doc, editor, view, index, canvas, host, renderNow, invalidate, padlocked } = d;
  return async (): Promise<void> => {
    if (d.appView() !== "canvas") return;
    if (!session.catalog) {
      editor.message = "Could not save a screenshot: the library is not available in this tab.";
      editor.changed();
      return;
    }
    const cfg = {
      format: settings.get("shot.format"),
      quality: settings.get("shot.quality"),
      pattern: settings.get("shot.pattern"),
      transparent: settings.get("shot.transparent"),
      ui: settings.get("shot.interface"),
      folder: settings.get("shot.folder").trim(),
      name: settings.get("shot.name"),
      style: settings.get("shot.nameStyle"),
      copy: settings.get("shot.copy"),
    };
    try {
      // A clean frame: the pattern as chosen, no selection outlines, and a background or not.
      let pic = document.createElement("canvas");
      padlocked(() => {
        renderNow({ pattern: cfg.pattern, overlays: false, transparent: cfg.transparent });
        pic.width = canvas.width;
        pic.height = canvas.height;
        pic.getContext("2d")!.drawImage(canvas, 0, 0);
      });
      invalidate(); // the screen goes back to normal (selection outlines and all)
      const vp = view.viewport;
      const visible = visibleObjects(doc, index, null, view.frameCamera, vp);
      const picked = editor.selection.size ? visible.filter((po) => editor.selection.has(po.obj.id)) : [];
      const inShot = picked.length ? picked : visible; // the selection, or the whole view when nothing is picked
      if (cfg.ui) {
        try {
          pic = await withInterface(pic, host, document.getElementById("nav")!, vp.width, vp.height);
        } catch {
          editor.message = "The interface could not be included in this browser; the screenshot has the canvas only.";
          editor.changed();
        }
      }
      if (picked.length) {
        const x0 = Math.max(0, Math.min(...picked.map((po) => po.box.minX)) - 12);
        const y0 = Math.max(0, Math.min(...picked.map((po) => po.box.minY)) - 12);
        const x1 = Math.min(vp.width, Math.max(...picked.map((po) => po.box.maxX)) + 12);
        const y1 = Math.min(vp.height, Math.max(...picked.map((po) => po.box.maxY)) + 12);
        if (x1 - x0 >= 2 && y1 - y0 >= 2) {
          const crop = document.createElement("canvas");
          crop.width = Math.round((x1 - x0) * d.dpr());
          crop.height = Math.round((y1 - y0) * d.dpr());
          crop.getContext("2d")!.drawImage(pic, Math.round(x0 * d.dpr()), Math.round(y0 * d.dpr()), crop.width, crop.height, 0, 0, crop.width, crop.height);
          pic = crop;
        }
      }
      if (cfg.format === "jpeg") {
        // JPEG has no transparency: fill with white behind the picture.
        const flat = document.createElement("canvas");
        flat.width = pic.width;
        flat.height = pic.height;
        const fx = flat.getContext("2d")!;
        fx.fillStyle = "#fff";
        fx.fillRect(0, 0, flat.width, flat.height);
        fx.drawImage(pic, 0, 0);
        pic = flat;
      }
      const { blob, format } = await encodeShot(pic, cfg.format, cfg.quality);
      const words = nameWords(session);
      const board = words.board;
      const canvasName = words.canvas;
      const fileName = `${shotFileName(cfg.name, { ...words, at: new Date() }, cfg.style)}.${SHOT_FORMATS[format].ext}`;
      const itemTags = [...new Set(inShot.flatMap((po) => po.obj.tags ?? []))];
      const tags = shotTags({ screenshot: settings.get("shot.tagShot"), board: settings.get("shot.tagBoard"), canvas: settings.get("shot.tagCanvas"), items: settings.get("shot.tagItems"), custom: settings.get("shot.tagsCustom") }, board, canvasName, itemTags);
      const { record } = await assets.importFileDetailed(new File([blob], fileName, { type: SHOT_FORMATS[format].mime }), false);
      const where = await fileInLibrary(session, record.hash, cfg.folder, tags);
      if (cfg.copy) {
        // (the clipboard may refuse: the screenshot is saved anyway)
        const png = format === "png" ? blob : await new Promise<Blob | null>((r) => pic.toBlob(r, "image/png"));
        if (png && (await writeSystemClipboard({ image: png })) === "image") forgetCopiedPicture();
      }
      editor.message = `Screenshot saved: “${fileName}” in ${where}.`;
      editor.messageAction = { label: "View", command: "library.reveal", run: () => void pressCommand("library.reveal", { hashes: [record.hash] }) };
      editor.changed();
    } catch (e) {
      editor.message = `Could not save the screenshot: ${(e as Error).message}`;
      editor.changed();
    }
  };

}
