import { setSnapPx } from "../interaction/snap";
import { followHost, sendView } from "./follow";
import { readOnlyLine, readOnlyWhy } from "../storage/guest-page";
import { guestBridge } from "./guest";
import { installShareAsk, installShareFolder } from "../ui/share-panel";
import { deleteEverywhere } from "../ui/delete-everywhere";
import type { CatalogEntry } from "../assets/asset-catalog";
import { copyItemsAsFiles, copyItemsToClipboard, filesOf, hiddenFine, sayingProgress, type CopyDeps } from "./copy-items";
import { clipboardFor } from "../assets/clipboard-kinds";
import { externalFolder } from "../storage/external-folder";
import { askHiddenPassword } from "../ui/hidden-access";
import { noteKindOf, tooBigForNote } from "../notes/note-file";
import { AUTO_NOTE_SETTINGS, setAutoDates } from "../notes/note-dates";
import { setPropTypes } from "../notes/prop-types";
import { CARD_SCALE, notePageHeight, setNoteItemMeta, setNoteLook, setNotePictures, setShownProps } from "../notes/note-preview";
import { anyNoteDirty, leaveAllNotes } from "../ui/note-session";
import { mountFilePanel } from "../ui/file-panel";
import type { FilePanelDeps } from "../ui/file-panel";
import { viewKindNamed } from "../ui/file-views";
import type { CardActions } from "../ui/file-views";
import { ViewState } from "./view-state";
import { newNoteFile } from "../notes/note-file";
import { cleanFileName } from "../doc/rename-rules";
import { fileInLibrary } from "./library-filing";
import { newNoteName, storeFrame } from "./frames";
import { newObjectId, rasterKey } from "../doc/model";
import type { CanvasObject, ImageObject, ObjectId, TextObject } from "../doc/model";
import { screenToWorld, type ScreenPoint } from "../core/camera";
import type { AssetRecord } from "../assets/asset-library";
import type { Gradient, GradientStop } from "../doc/paint";
import type { PathObject } from "../doc/model";
import type { JoinChoice } from "../doc/stroke-look";
import { SHOT_FORMATS, encodeShot, shotFileName, shotTags, withInterface } from "./screenshot";
import { isCard, isFontFile, isPdfFile } from "../assets/file-kind";
import { FILE_CARD_H, FILE_CARD_W } from "../assets/card";
import { pdfCardShape } from "../assets/pdf-engine";
import { setFontCardLook } from "../assets/adapters";
import { downloadOriginal, fileActionsOf, openOriginalInTab, saveFile } from "../ui/file-actions";
import { FrameStats } from "./frame-stats";
import type { FrameBreakdown } from "./frame-stats";
import { mountHud } from "./hud";
import { installDebugHook } from "./debug-hook";
import { EditorState } from "./editor-state";
import type { LayoutCommand } from "./actions";
import { applyBalloonStyle, balloonStyle, balloonsToPaths, canConnectBalloons, connectBalloons, selectedBalloon, selectedLink, selectedShapeText, setBalloonLink, setShapeText } from "./actions";
import { canSplitPaths, splitPaths, placeCardViews, placeLinesBeside, imageAt, pasteCssPaint, copiedText, setCopiedText, renderedStill, isPlaceholderText, markCopiedPicture, isCopiedPicture, forgetCopiedPicture, applyRotation, showReplaced, arrangeSelection, copySelection, cutSelection, duplicateSelection, pasteObjects, layoutSelection, clearFlag, deleteSelection, groupSelection, importImages, moveAbove, moveLayers, setStackOrder, tagObjects, resetRotation, resetProportions, resettable, resetSize, sizeResets, recolourOldInk, svgWarningOfTargets, svgWarningOfSelection, extractFrame, pruneSelection, redo, setFlag, setMedia, setFlagOn, setOpacityOn, setBlendOn, renameLayer, ungroupSelection, undo, selectedPaint, previewPaint, commitPaint, combineSelection, canCombine, selectedOutline, commitOutline, selectedDashNumbers, commitDashNumbers, selectedArrows, commitArrows, selectedMiterAngle, commitMiterAngle, selectedShape, commitShape, selectedCorners, commitCorners, selectedSmoothing, commitSmoothing, selectionPaints, recolour, initialShapeState, setInitialShape, resetToInitialShape, groupJoinMode, addToBooleanGroup, takeOutOfBooleanGroup, convertTextToPath, simplifySelection, canSimplify, outlineStroke, setWidthProfile, canOutlineStroke, makeMask, makeClippingMask, canMakeMask, changeMask, selectTheMask, canReleaseMask, selectedMask, startBrushMask, paintMask, divide, startShapeBuilder, finishShapeBuilder, canDivide, canFillGaps, fillAllGaps, startGapFill, finishGapFill, makeNetwork, releaseNetwork, canMakeNetwork, canReleaseNetwork, strokeToPath, canStrokeToPath, setTextOnPath, canSetOnPath, canSetInShape, setTextInShape, takeTextOffPath, canTakeOffPath, canOutline, booleanSelection, releaseBoolean, flattenBoolean, canExportSvg, exportTarget, buildTarget, exportTargets, exportEachTargets, canSheetEach, sheetEach, svgOfTarget, pdfVectorOfTarget, svgOfSelection, importSvg, setSheetClip, sheetSelection, releaseSheets, selectedPin, setPin, canFitSheet, fitSheet, sheetRatio, ratioOfSheet, setSheetRatio, sheetScalesContents, setSheetScale, boxOnSheet, moveOnSheet, resizeOnSheet, canDetach, detachSelection, selectedTextStyle, setTextStyle, croppablePicture, isCropped, uncropPicture, selectedFlip, flipPictures, unflipPictures, selectedAdjust, pictureCount, applyGradientMap, paintTargetCount, selectionColours, previewAdjust, commitAdjust, copyAdjustments, pasteAdjustments, canPasteAdjustments, copyRenderedPicture, bakePicture, sizeResetBlock, matchSize, sizable } from "./actions";
import { attachNavigation } from "../interaction/navigation";
import { attachTools } from "../interaction/tools";
import { createFocusCycle, focusObjects, stepToNeighbour } from "../interaction/item-navigation";
import { renderFrame, gridStep, setGridLook } from "../render/canvas2d-renderer";
import type { Theme } from "../render/canvas2d-renderer";
import { batchRuns, drawObjects, drawOverlays, drawCropGhost } from "../render/scene-renderer";
import { strokeLineWidth } from "../render/draw-objects";
import type { ProjectedObject } from "../render/projection";
import { coverObject, projectObject } from "../render/projection";
import { TileCache } from "../render/tile-cache";
import { adjustReach } from "../render/adjust-shape";
import { DensityLayer } from "../render/density";
import type { SceneTheme } from "../render/scene-renderer";
import { hiddenInView, visibleObjects } from "../render/scene-view";
import { setTextureHost } from "../render/texture";
import { isTexture } from "../doc/texture";
import { createTextureHost } from "./texture-host";
import { pickAll } from "../render/hit-test";
import { dimHits, revealHits, scrollReveal, type RevealWhy } from "../interaction/reveal";
import { ownerOf } from "../doc/belongs";
import { syncScroll } from "../ui/bar";
import { parseHex, rgbToOklch } from "../colour-picker/colour";
import { canvasItems, mountContextMenu } from "../ui/context-menu";
import { openBatchRename } from "../ui/batch-rename";
import { HIDDEN_LOCKED, askCurrentPassword, askPassword, forgetHiddenPassword, hiddenModeOn, hiddenRemembered, lockHidden, onHiddenRemembered } from "../ui/hidden-access";
import { typeOfName } from "../storage/workspace-names";
import { openLockScreen } from "../ui/lock-screen";
import { renderedPicture } from "../render/adjust-image";
import { freeNameIn } from "../doc/file-names";
import { MAX_COPIED_SVG, onHiddenCopyNotice, onePerPicture, setHiddenCopySeconds, svgCopy, writeSystemClipboard, type ClipboardFiles } from "./system-clipboard";
import { LANDMARKS } from "../scene/landmarks";
import { DocumentStore } from "../doc/document-store";
import { syncIndex } from "../scene/spatial-index";
import { FrameIndex, cameraIn, isCoarse, worldBackdrop } from "../scene/frame-index";
import type { Frame } from "../core/frames";
import { depthOf, localCamera, normalize } from "../core/frames";
import { AssetLibrary, MAX_IMPORT_BYTES } from "../assets/asset-library";
import { openBrowserStorage } from "../storage/idb-storage";
import { openDesktopStorage } from "../storage/desktop-storage";
import { desktopBridge } from "../storage/desktop-bridge";
import { meta } from "../assets/asset-catalog";
import type { OpenHooks, Storage } from "../storage/store";
import type { SaveState } from "../storage/canvas-persistence";
import { Session } from "./session";
import { mountNavigator } from "../ui/navigator";
import { checkLock } from "../assets/hidden-lock";
import { onStartStep, startStep } from "./startup-log";
import { mountLibraryFolderCard } from "../ui/library-folder-card";
import { confirmReset } from "../ui/reset-dialog";
import { beginProgress, type Progress } from "./progress";
import { be, plural } from "../doc/plural";
import { installAutoIndex } from "../storage/auto-index";
import { fmtBytes } from "../ui/format";
import { runSaveLibraryFile } from "../ui/archive-ui";
import { mountToolbar, toolIcon } from "../ui/toolbar";
import { initColourPopover, openColourPopover } from "../ui/colour-popover";
import { toolCursor } from "../ui/tool-cursor";
import { groupLabel, labelOf, mountLayersPanel } from "../ui/layers-panel";
import { mountMediaPlayer } from "../ui/media-player";
import { mountBookmarksPanel } from "../ui/bookmarks-panel";
import { DENSE_MS, DPR_CAP, QualityGovernor } from "./quality";
import type { QualityLevel } from "./quality";
import { startErrorLog } from "./diagnostics";
import { BookmarkList, captureThumb } from "./bookmarks";
import { updateThumbs } from "./bookmark-thumbs";
import { mountDevPanel } from "../ui/dev-panel";
import { mountAssetsView } from "../ui/assets-view";
import { SETTINGS_TABS, mountSettingsView } from "../ui/settings-view";
import { goHome, zoomByStep } from "../interaction/navigation";
import { mountHintLine } from "../ui/hint-line";
import { closeMoreMenu, openMoreMenu, setMenuAvoid } from "../ui/more-menu";
import type { MenuItem } from "../ui/more-menu";
import { ICONS } from "../ui/icons";
import { mountContextBar } from "../ui/context-bar";
import { installMenuKeys } from "../ui/more-menu";
import { chooseDialog, confirmDialog, promptDialog } from "../ui/confirm";
import { busyProgress, currentBusy, openBusyScreen, openStartScreen } from "../ui/busy-screen";
import { canSwitchWorkspace, openWorkspaceSwitcher } from "../ui/workspace-switch";
import type { BusyScreen } from "../ui/busy-screen";
import { extractPalette } from "../assets/extract-palette";
import { mountTagsPanel } from "../ui/tags-panel";
import { mountStylesPanel } from "../ui/styles-panel";
import { linkedUpdates } from "./style-sync";
import { PanelDock } from "../ui/panel-dock";
import { mountAdjustPanel } from "../ui/adjust-panel";
import { mountPatternPanel } from "../ui/pattern-panel";
import { balloonLook, rememberBalloonLook, validLook } from "../doc/balloon-geometry";
import { mountBalloonPanel } from "../ui/balloon-panel";
import { makePattern, makePatternEach, newPatternSession, patternBox, patternTargetLabel, patternTargets, foundPattern, sessionPattern } from "./pattern";
import { cleanValues, generatorById } from "../gen";
import { mountCanvasSearch } from "../ui/canvas-search";
import { mountNotices } from "../ui/notices";
import { FIXED_SHORTCUTS, TOOL_COMMAND, TOOL_NAME, TOOL_ORDER, navForKey, toolForKey } from "../settings/shortcuts";
import { KEY_COMMANDS, Keymap, comboOfEvent, displayCombo, installKeymap } from "../settings/keymap";
import { randomEmptyView, viewIsEmpty } from "../interaction/random-view";
import { renderExport } from "./export-render";
import type { ExportTarget } from "./export-render";
import * as D from "../core/dyadic";
import { openExportDialog, exportAgain, exportedBefore, exportPresetSummary, type ExportPreset } from "../ui/export-dialog";
import { mountViewSwitch } from "../ui/view-switch";
import { followFrameSetting, mountWindowRow } from "../ui/window-frame";
import { followScrolling } from "../ui/scrollbars";
import type { AppView } from "../ui/view-switch";
import { entriesOfDrop, fileByFolders, filesOfEntries, hasFolder } from "./directory";
import { isArchiveFile, runExport, runExportChanges, runAdvancedExport, runExportFiles, runImport, takeAfterReload, takeStayUnlocked } from "../ui/archive-ui";
import { copyText, mountTextEditor } from "../ui/text-editor";
import { FontLoader, whyNotFont } from "./font-loader";
import { onFontsChange } from "../text/fonts";
import { describeFile } from "../assets/file-kind";
import { styleOf, toolLook } from "../text/text-style";
import { installTextFont } from "../text/inter";
import { descendantsOf, isContainer, rootsOf } from "../doc/containers";
import { isResult } from "../doc/boolean-group";
import { CameraHistory } from "./camera-history";
import { mountTour } from "./tour";
import { ADJUSTMENT_KIND, EXPORT_KIND, RATIO_KIND } from "../assets/styles";
import { formatRatio, parseRatio } from "./export-size";
import { setColourStyles } from "../ui/colour-popover";
import { setTextureHooks } from "../ui/texture-editor";
import { createTextureHooks } from "./texture-actions";
import { hasShadow, needsNeighbours } from "../doc/adjust";
import type { Adjust } from "../doc/adjust";
import { downloadSelection, pickedFiles } from "./download";
import { mountCommandPalette } from "../ui/command-palette";
import { CommandRegistry } from "../commands/registry";
import { Macros } from "../commands/macros";
import { barCommands } from "../commands/from-bars";
import { settingCommands } from "../commands/settings-commands";
import type { Command } from "../ui/command-palette";
import { AssetNames } from "./asset-names";
import { isLabelled, itemLabels, itemName } from "../render/item-label";
import { drawReveal, drawRevealOutlines, revealWords } from "../render/reveal";
import type { ItemLabel } from "../render/item-label";
import { PRIVACY_KEYS, SETTINGS, SettingsStore } from "../settings/settings";
import { DEFAULT_INK, newInk, setCanvasInk } from "../render/ink";
import { paintFromText, paintToText } from "../doc/paint";

/** A write of this many files into the workspace folder (an import's) shows the busy screen and asks before closing; fewer go by quietly. */
const BUSY_FILES = 20;
/** From this many files encrypted at once (hiding them), the busy screen shows how far it is. */
const BUSY_SEALS = 5;

declare const __CANVAST_VERSION__: string;

function readTheme(el: HTMLElement): Theme & SceneTheme & { ink: string } {
  // A token may hold var() and calc() (the hue and colourfulness dials); a probe element resolves it to the plain colour the canvas can draw with.
  const probe = document.createElement("span");
  probe.style.display = "none";
  el.appendChild(probe);
  const v = (name: string): string => {
    probe.style.color = "";
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  const theme = {
    background: v("--canvas-bg"),
    grid: v("--canvas-grid"),
    axis: v("--canvas-axis"),
    landmark: v("--canvas-landmark"),
    landmarkLabel: v("--canvas-landmark-label"),
    selection: v("--canvas-selection"),
    handleFill: v("--canvas-handle-fill"),
    sharp: el.dataset["corners"] === "sharp",
    lasso: v("--canvas-lasso"),
    imagePlaceholder: v("--canvas-image-placeholder"),
    imageLocked: v("--canvas-image-locked"),
    ink: v("--canvas-ink"),
    danger: v("--canvas-danger"),
    dangerWash: v("--canvas-danger-wash"),
    builderOn: v("--canvas-builder-on"),
    builderSoft: v("--canvas-builder-soft"),
    builderOff: v("--canvas-builder-off"),
    guide: v("--canvas-guide"),
  };
  probe.remove();
  return theme;
}

const SAVE_TEXT: Record<SaveState, string> = {
  verified: "Saved (verified)",
  committed: "Saved",
  queued: "Unsaved changes…",
  saving: "Saving…",
  readonly: `Read-only (${readOnlyWhy()})`,
  conflict: "Not saved — changed in another tab; reload to continue",
  error: "Save failed — changes are only in memory",
  unavailable: "Storage unavailable — changes are only in memory",
};

async function start(): Promise<void> {
  const host = document.getElementById("canvas-host")!;
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    host.textContent = "canvast could not create a 2D drawing surface in this browser.";
    return;
  }

  const doc = new DocumentStore();
  const view = new ViewState(() => doc.space);
  const stats = new FrameStats();
  /** A startup mark (read by the startup benchmark, `startupMarks` in the debug hook): defined first, the frame loop may run before the canvas is loaded. */
  const mark = (name: string): void => void performance.mark(`canvast:${name}`);
  // The spatial index mirrors the document incrementally (changed ids only).
  const index = new FrameIndex(() => doc.space);
  const indexSync = syncIndex(doc, index, {
    onProgress: (done, total) => {
      if (done >= total) editor.progressDone.add("index");
      editor.message = done < total ? `Indexing ${total.toLocaleString()} objects… ${Math.round((100 * done) / total)}%` : "";
      editor.changed();
      invalidate();
    },
  });
  // Committed objects are drawn through a raster tile cache (ADR 0009).
  const tiles = new TileCache(
    (id) => doc.get(id),
    () => invalidate(),
  );
  // Content too small to draw individually is shown as a density preview (ADR 0010).
  const density = new DensityLayer();
  /** Which objects are sheets (kept up to date from the changes), and the names drawn above them as last painted. */
  const labelIds = new Set<string>(); // the items that can carry a name above them (item-label.ts)
  let labels: ItemLabel[] = [];
  doc.subscribe((_source, changed) => {
    if (!changed) {
      labelIds.clear();
      for (const o of doc.all()) if (isLabelled(o)) labelIds.add(o.id);
    } else for (const id of changed) {
      const o = doc.get(id);
      if (o && isLabelled(o)) labelIds.add(id);
      else labelIds.delete(id);
    }
  });
  // Shapes filled with objects of the canvas (ADR 0154) look different when those objects change.
  const objectsUsers = new Map<string, readonly string[]>();
  const sourcesOf = (o: CanvasObject | undefined): readonly string[] | null => (o?.kind === "path" && isTexture(o.fill) && o.fill.src.kind === "objects" ? o.fill.src.ids : null);
  doc.subscribe((_source, changed) => {
    if (!changed) {
      objectsUsers.clear();
      for (const o of doc.all()) if (sourcesOf(o)) objectsUsers.set(o.id, sourcesOf(o)!);
    } else for (const id of changed) {
      const ids = sourcesOf(doc.get(id));
      if (ids) objectsUsers.set(id, ids);
      else objectsUsers.delete(id);
    }
  });
  /** The shapes whose objects fill shows any of `ids` (an objects fill of an objects fill too, down the chain; a cycle ends because an id is added once). */
  const fillUsersOf = (ids: ReadonlySet<string>): string[] => {
    const hit = new Set(ids);
    for (let grew = objectsUsers.size > 0; grew; ) {
      grew = false;
      for (const [id, src] of objectsUsers) if (!hit.has(id) && src.some((i) => hit.has(i))) (hit.add(id), (grew = true));
    }
    return [...hit].filter((id) => !ids.has(id));
  };
  doc.subscribe((_source, changed) => {
    // What a sheet holds is cut by it: when a sheet changes, so does the look of everything on it (ADR 0108).
    const sheets = changed ? [...changed].filter((id) => isContainer(doc.get(id))) : [];
    const more = changed ? fillUsersOf(changed) : [];
    // (a pattern is replaced in one step, its pieces and sheet together: every tile is drawn again, so none keeps a piece of what was there)
    const pattern = changed !== null && (sheets.length > 0 || [...changed].some((id) => doc.get(id)?.gen !== undefined));
    tiles.invalidate(pattern ? null : more.length ? new Set([...changed!, ...more]) : changed);
  });
  // Objects with a blend mode (ADR 0047): tiles hold paint without its backdrop, so a view that shows one is drawn directly.
  // So is one with a blur, sharpen or grain on a shape or text: it needs what lies beyond a tile's edge, so a tile would show seams.
  const needsDirect = (o: CanvasObject | undefined): boolean => !!o && (!!o.blend || (o.kind !== "image" && needsNeighbours(o.adjust)) || hasShadow(o.adjust));
  const blended = new Set<string>();
  doc.subscribe((_source, changed) => {
    if (changed === null) {
      blended.clear();
      for (const o of doc.all()) if (needsDirect(o)) blended.add(o.id);
      return;
    }
    for (const id of changed) {
      if (needsDirect(doc.get(id))) blended.add(id);
      else blended.delete(id);
    }
  });
  const editor = new EditorState();
  const notices = mountNotices(document.body, editor);
  // Device settings (ADR 0017): pen and select options come back after a reload.
  const settings = new SettingsStore();
  initColourPopover(settings);
  // Every shortcut is a command of the keymap (ADR 0158): the layer that turns the keys the person chose into the keys the handlers hear goes in before any handler.
  const keymap = new Keymap(settings);
  installKeymap(keymap);
  // Developer tools (the panel, the diagnostics, the test hook): on for a session with #debug at the end of the address (the tests use
  // this), or always once switched on in Settings > Develop (applies after a reload). There is no separate debug build.
  const debug = location.hash.includes("debug") || settings.get("dev.tools");
  editor.penColor = settings.get("pen.color");
  editor.penWidthPx = settings.get("pen.widthPx");
  editor.penKind = settings.get("pen.kind");
  editor.shapeKind = settings.get("shape.kind");
  editor.shapeFill = paintFromText(settings.get("shape.fill")) ?? null;
  editor.shapeWidthPx = settings.get("shape.widthPx");
  editor.shapeJoin = settings.get("shape.join") === "default" ? null : settings.get("shape.join") as JoinChoice;
  editor.shapeCap = settings.get("shape.cap");
  editor.shapeAlign = settings.get("shape.align");
  editor.shapeDash = settings.get("shape.dash");
  editor.lockRadius = settings.get("shape.lockRadius");
  editor.shapeSides = settings.get("shape.sides");
  editor.shapeTips = settings.get("shape.tips");
  editor.stabilizer = { on: settings.get("pen.stabilizer.on"), strength: settings.get("pen.stabilizer.strength") };
  editor.followZoom = settings.get("pen.followZoom");
  editor.ignoreFilling = settings.get("select.ignoreFilling");
  editor.lassoFilter = settings.get("lasso.filter");
  editor.snap = settings.get("snap.enabled");
  editor.gridStep = (cam) => (settings.get("snap.grid") ? gridStep(cam, settings.get("ui.pattern")) : null);
  const applyGridLook = (): void => setGridLook({ min: { fine: 16, normal: 32, coarse: 64 }[settings.get("grid.size")], major: { none: 0, "2": 1, "4": 2, "8": 3 }[settings.get("grid.major")], opacity: settings.get("grid.opacity") / 100 });
  applyGridLook();
  setSnapPx(settings.get("snap.reachPx"));
  setHiddenCopySeconds(settings.get("library.hiddenCopySeconds"));
  onHiddenCopyNotice((text) => {
    editor.message = text;
    editor.changed();
  });
  editor.alignBox = settings.get("select.alignBox");
  editor.layersOpen = settings.get("ui.layersOpen");
  editor.bookmarksOpen = settings.get("ui.bookmarksOpen");
  editor.tagsOpen = settings.get("ui.tagsOpen");
  editor.stylesOpen = settings.get("ui.stylesOpen");
  editor.eraserPx = settings.get("eraser.diameterPx");
  editor.eraseWholeGroups = settings.get("eraser.wholeGroups");
  editor.eraseParts = settings.get("eraser.parts");
  editor.subscribe(() => {
    settings.set("pen.color", editor.penColor);
    settings.set("pen.widthPx", editor.penWidthPx);
    settings.set("pen.kind", editor.penKind);
    settings.set("shape.kind", editor.shapeKind);
    settings.set("shape.fill", paintToText(editor.shapeFill));
    settings.set("shape.widthPx", editor.shapeWidthPx);
    settings.set("shape.join", editor.shapeJoin ?? "default");
    settings.set("shape.cap", editor.shapeCap);
    settings.set("shape.align", editor.shapeAlign);
    settings.set("shape.dash", editor.shapeDash);
    settings.set("shape.lockRadius", editor.lockRadius);
    settings.set("shape.sides", editor.shapeSides);
    settings.set("shape.tips", editor.shapeTips);
    settings.set("pen.stabilizer.on", editor.stabilizer.on);
    settings.set("pen.stabilizer.strength", editor.stabilizer.strength);
    settings.set("pen.followZoom", editor.followZoom);
    settings.set("select.ignoreFilling", editor.ignoreFilling);
    settings.set("lasso.filter", editor.lassoFilter);
    settings.set("snap.enabled", editor.snap);
    settings.set("select.alignBox", editor.alignBox);
    settings.set("ui.layersOpen", editor.layersOpen);
    settings.set("ui.bookmarksOpen", editor.bookmarksOpen);
    settings.set("ui.tagsOpen", editor.tagsOpen);
    settings.set("ui.stylesOpen", editor.stylesOpen);
    settings.set("eraser.diameterPx", editor.eraserPx);
    settings.set("eraser.wholeGroups", editor.eraseWholeGroups);
    settings.set("eraser.parts", editor.eraseParts);
  });
  // Theme chosen in Settings (ui.theme): "system" leaves the attribute off so the operating system decides.
  const applyThemeAttribute = (): void => {
    const t = settings.get("ui.theme");
    if (t === "system") {
      delete document.documentElement.dataset["theme"];
      delete document.documentElement.dataset["cpTheme"];
    } else {
      document.documentElement.dataset["theme"] = t;
      document.documentElement.dataset["cpTheme"] = t; // (the colour picker's own theme switch: its native controls and colours follow the app, not the system)
    }
  };
  // Appearance (Settings > Appearance): attributes and variables on the root, read by the stylesheet.
  // Zen mode (ui.zen): an attribute on the root, read by the stylesheet, and the pressed state of the button beside Home.
  const applyZen = (): void => {
    const on = settings.get("ui.zen");
    if (on) document.documentElement.dataset["zen"] = "on";
    else delete document.documentElement.dataset["zen"];
    document.querySelector('[data-action="zen"]')?.setAttribute("aria-pressed", String(on));
  };
  const applyAppearance = (): void => {
    const root = document.documentElement;
    const bg = settings.get("ui.background");
    // Adaptive theme colour: the hue of the canvas background colour (a grey one has none: the hue set by hand stays). --hue-adaptive is that hue
    // whether or not it is on, for the chip in Settings.
    const bgLch = bg ? rgbToOklch(parseHex(bg) ?? [0, 0, 0]) : null;
    const adaptive = bgLch && bgLch.C > 0.01 ? Math.round(bgLch.h) : settings.get("ui.hue");
    root.style.setProperty("--hue-adaptive", String(adaptive));
    root.style.setProperty("--hue", String(settings.get("ui.hueAdaptive") ? adaptive : settings.get("ui.hue")));
    if (bg) {
      root.style.setProperty("--canvas-bg", bg);
      root.dataset["customBg"] = ""; // the lines and marks on it are made from it (styles.css)
    } else {
      root.style.removeProperty("--canvas-bg"); // the app's own, from the theme
      delete root.dataset["customBg"];
    }
    root.style.setProperty("--vivid", String(settings.get("ui.vivid") / 100));
    if (settings.get("ui.corners") === "sharp") root.dataset["corners"] = "sharp";
    else delete root.dataset["corners"]; // round is the default
    const density = settings.get("ui.density");
    if (density !== "compact") root.dataset["density"] = density;
    else delete root.dataset["density"]; // compact is the default
    const m = settings.get("ui.motion");
    if (m === "system") delete root.dataset["motion"];
    else root.dataset["motion"] = m;
    // How long animations take: the speed choice, and shorter again for "subtle".
    const speed = { slow: 1.6, normal: 1, fast: 0.6 }[settings.get("ui.animSpeed")];
    root.style.setProperty("--anim-speed", String(m === "subtle" ? speed * 0.6 : speed));
    // Gliding between views (ADR 0116): off for reduced motion, and in the test session (a test reads the camera the moment it asks).
    const still = m === "reduce" || (m === "system" && settings.get("nav.respectMotion") && matchMedia("(prefers-reduced-motion: reduce)").matches);
    view.glideMs = debug || still ? 0 : Math.round(settings.get("nav.baseSeconds") * 1000);
    // Said once, when a trip cuts only because of the motion settings (so a cut is never a mystery).
    view.cutReason = debug || !still ? "" : m === "reduce" ? "Animation is set to None" : "your system asks for reduced motion";
    view.travel = settings.get("nav.travel");
    view.distanceAware = settings.get("nav.speed") === "distance";
    view.maxGlideMs = settings.get("nav.maxSeconds") * 1000;
    view.ease = settings.get("nav.ease");
    view.fade = settings.get("nav.fade") ? (o) => void (canvas.style.opacity = o >= 1 ? "" : String(o)) : null;
  };
  let cutTold = false;
  view.onCut = (why) => {
    if (cutTold) return;
    cutTold = true;
    editor.message = `The view jumped because ${why}. Settings → Navigation (Camera travel) and Performance (Animation) change it.`;
    editor.changed();
  };
  applyAppearance();
  applyZen();
  applyThemeAttribute();
  let theme = readTheme(document.documentElement);
  setCanvasInk(theme.ink);
  let dpr = window.devicePixelRatio || 1;
  // Adaptive quality (ADR 0028): slow frames lower the canvas resolution and make zoom previews more eager.
  const quality = new QualityGovernor((level) => {
    tiles.denseMs = DENSE_MS[level];
    tiles.idleBuild = level === 0;
    resize();
  });
  // In debug mode (the tests) the level changes only when asked to, so a slow machine cannot change what a test measures.
  quality.pinned = !settings.get("quality.auto") || debug;
  const heldLevel = (): QualityLevel => ({ full: 0, balanced: 1, fast: 2 })[settings.get("quality.level")] as QualityLevel;
  const applyHeldQuality = (): void => {
    if (!debug && !settings.get("quality.auto")) quality.force(heldLevel()); // (off: held at the level asked for)
  };
  const effectiveDpr = (): number => Math.min(window.devicePixelRatio || 1, DPR_CAP[quality.level]);
  let scheduled = false;
  let frameWaiters: Array<() => void> = [];

  let storage: Storage | null = null;
  let storageError = "";
  // Until the workspace is open, a start screen stands in front of the app (nothing can be used half-loaded); it says each step.
  let opening: BusyScreen | null = openStartScreen("");
  void mountWindowRow(); // (in front of the start and lock screens too)
  const NEXT: Record<string, string> = {
    "storage opened": "Reading the workspace",
    "writer lease": "Reading the workspace",
    "tags checked": "Reading the workspace folder",
    "workspace read (and its folder)": "Loading the canvas",
    "canvas loaded": "Checking the library",
    "library checked": "Tidying up unused files",
  };
  const stopSteps = onStartStep((step) => NEXT[step] && opening?.update(null, NEXT[step]));
  try {
    const desktop = desktopBridge();
    const opts: OpenHooks = {
      onBlocked: () => {
        editor.message = "Upgrading storage: close other canvast tabs to continue.";
        editor.changed();
      },
      onVersionChange: () => {
        editor.message = "canvast was upgraded in another tab. Reload this tab to keep working.";
        editor.readOnly = true;
        editor.changed();
      },
      onNotice: (text) => {
        editor.message = text;
        editor.changed();
      },
      onOpening: (detail, fraction) => opening?.update(fraction, detail),
      deleteTo: () => settings.get("storage.deleteTo"),
      hiddenNamesOff: () => settings.get("library.hiddenNamesOff"),
      trashDays: () => Number(settings.get("storage.trashDays")),
      keepFileNames: () => settings.get("library.keepFileNames"),
      sortFiles: () => settings.get("library.sortFiles"),
      noteFileKeep: () => (settings.get("notes.renameOnSave") ? settings.get("notes.nameStyle") === "kept" : null),
      onFileRules: (changed) => void settings.subscribe((key) => (key === "library.keepFileNames" || key === "library.sortFiles") && changed()),
    };
    // (a page a host serves reads the host's workspace through it: ADR 0184)
    const guest = desktop ? null : await guestBridge();
    storage = desktop ? await openDesktopStorage(desktop, opts) : guest ? await openDesktopStorage(guest, opts) : await openBrowserStorage(opts);
    startStep("storage opened");
    // (the library folder's link is loaded too, before anything is drawn: an await later in this function lets a frame run early)
  } catch (e) {
    storageError = (e as Error).message;
  }

  const invalidate = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(draw);
  };
  // Before any document loads: text bounds come from the bundled font's metrics.
  installTextFont(() => {
    tiles.clear(); // text drawn before the font was ready used the interim fallback
    invalidate();
  });
  const assets = new AssetLibrary(storage?.originals ?? null, () => {
    tiles.dropPending(); // an original finished loading: redraw tiles that showed its placeholder
    invalidate();
  });
  // The library folder (ADR 0159): a restart asks permission again, which needs a click in the storage panel.
  externalFolder.subscribe(() => assets.retryAll());
  // Encrypted hidden items (desktop build, ADR 0177): opened, their pictures are read again; locked, they leave memory, every tile
  // that may show one is drawn again (with a padlock), and the Hidden list asks for the password again.
  storage?.hidden?.subscribe(() => {
    if (storage.hidden!.isOpen()) return assets.retryAll();
    forgetHiddenPassword();
    void desktopBridge()?.dropOpened(); // (readable copies of hidden items opened in other apps)
    void assets.dropLocked().then(() => {
      tiles.clear();
      invalidate();
    });
  });
  if (storage?.libraryFolder && externalFolder.state === "needs-permission") {
    void storage.libraryFolder.keptHashes().then((h) => {
      if (!h.length) return;
      editor.message = "The library folder needs your permission again: open the storage panel and press Reconnect folder.";
      editor.changed();
    });
  }
  assets.onNotice = (text) => { editor.message = text; editor.changed(); };
  // How much of a long note its card shows (Settings > Notes), for the cards made from now on.
  // Notes' previews on light or dark paper (Settings > Notes > Preview look; Auto follows the app's theme): a change draws their cards again.
  const darkNow = (): boolean => (settings.get("ui.theme") === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : settings.get("ui.theme") === "dark");
  const noteLookNow = () => (settings.get("notes.look") === "auto" ? (darkNow() ? "dark" : "light") : settings.get("notes.look") as "light" | "dark");
  setNoteLook(noteLookNow());
  let redrawNoteCards = (): void => undefined; // (set once the canvas and the library are there)
  const applyNoteLook = (): void => void (setNoteLook(noteLookNow()) && redrawNoteCards());
  settings.subscribe((key) => (key === "notes.look" || key === "ui.theme") && applyNoteLook());
  setShownProps(settings.get("notes.cardProps"));
  settings.subscribe((key) => {
    if (key === "notes.cardProps" && setShownProps(settings.get("notes.cardProps"))) redrawNoteCards();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyNoteLook);
  const autoDatesNow = (): void => setAutoDates({ on: settings.get("notes.autoDates"), created: settings.get("notes.createdKey"), modified: settings.get("notes.modifiedKey"), format: settings.get("notes.dateFormat"), title: settings.get("notes.titleKey"), titleFrom: settings.get("notes.titleFrom"), rename: settings.get("notes.renameOnSave"), nameFrom: settings.get("notes.nameFrom"), nameStyle: settings.get("notes.nameStyle") });
  autoDatesNow();
  settings.subscribe((key) => AUTO_NOTE_SETTINGS.includes(key) && autoDatesNow());
  setPropTypes(settings.get("library.propTypes"));
  settings.subscribe((key) => key === "library.propTypes" && setPropTypes(settings.get("library.propTypes")));
  // A card's labels say what the details panel says, written into the note's file or not.
  setNoteItemMeta(async (hash) => {
    const e = await session.catalog?.entry(hash).catch(() => undefined);
    return e ? { tags: e.tags ?? [], note: e.note ?? "", fields: e.fields ?? [] } : null;
  });
  // A note's preview (its card, its thumbnail) shows the pictures, videos and sounds it links to: a picture's own file, else the
  // item's library thumbnail (a video's picture, a sound's waveform). Never a hidden item's (a preview is kept as a thumbnail).
  setNotePictures(async (noteHash, link) => {
    const e = await session.linkedItem(noteHash, link);
    if (!e || e.hidden || !(e as { present?: boolean }).present) return null;
    const still = e.type.startsWith("image/") && e.type !== "image/gif" && !e.card;
    const blob = still ? (await assets.record(e.hash).catch(() => undefined))?.blob : (await session.catalog?.thumb(e.hash).catch(() => undefined))?.blob;
    return blob ? { blob, type: e.type } : null;
  });
  // The desktop build: files that appear in library/ outside the app are imported where they lie (ADR 0177).
  if (storage?.folderSync) assets.bigImport = (file) => storage!.folderSync!.importBig(file);
  // (a single file saved again says its result only: a bar is for a batch)
  const OUTSIDE_BATCH = 10;
  let lookingAt: Progress | null = null;
  storage?.folderSync?.start({
    looking: (done, total) => {
      if (total < OUTSIDE_BATCH) return;
      lookingAt ??= beginProgress(editor, "outside-look", "Looking at new files in the workspace folder");
      lookingAt.update(done / total, `${done} of ${total}`);
      if (done < total) return;
      lookingAt.done();
      lookingAt = null;
    },
    importFiles: async (files) => {
      let n = 0;
      const followed: string[] = [];
      const adding = files.length >= OUTSIDE_BATCH ? beginProgress(editor, "outside-add", "Adding new files to the library") : null;
      for (const [i, f] of files.entries()) {
        adding?.update(i / files.length, `${i} of ${files.length}`);
        try {
          // Too big to read into the page: taken in from its hash alone, as a card.
          const hash = f.size !== undefined && f.size > MAX_IMPORT_BYTES && f.hash ? await f.hash() : null;
          const blob = hash ? null : await f.read();
          if (!hash && !blob) continue;
          const { record } = hash ? await assets.importLargeFound(f.name, typeOfName(f.name), f.size!, hash, f.path) : await assets.importFileDetailed(new File([blob!], f.name, { type: typeOfName(f.name) }), false, f.path);
          if (f.folderId) await storage.catalog.updateMeta(record.hash, { addFolders: [f.folderId] });
          if (f.hidden) await storage.catalog.updateMeta(record.hash, { hidden: true });
          if (f.meta) await storage.catalog.updateMeta(record.hash, { addTags: f.meta.tags, favorite: f.meta.favorite, note: f.meta.note, fields: f.meta.fields });
          // (an item's file saved again by the program it is worked on in: what was placed of it follows the new version)
          if (!f.follows && noteKindOf(f.name)) await session.adoptNoteProps(record.hash); // (a note's YAML: its tags, note and fields)
          if (f.follows) {
            await session.followAsset(f.follows, record.hash, { w: record.pixelW, h: record.pixelH });
            if (!f.savedInApp) followed.push(f.name);
            continue;
          }
          n++;
        } catch (e) {
          console.warn(`canvast: ${f.path} could not be taken into the library: ${(e as Error).message}`); // (left where it is)
        }
      }
      adding?.done();
      if (followed.length) {
        editor.message = followed.length === 1 ? `“${followed[0]}” was changed outside the app: the library and the canvases show the new version.` : `${plural(followed.length, "file")} were changed outside the app: the library and the canvases show the new versions.`;
        editor.changed();
      }
      if (!n) return;
      editor.message = `${n === 1 ? "A new file" : `${n} new files`} in the workspace folder ${n === 1 ? "was" : "were"} added to the library.`;
      editor.changed();
    },
    libraryChanged: () => {
      assets.retryAll(); // (a relinked file: its pictures are read again)
      session.libraryChanged();
    },
    itemMoved: (m) => session.movedOutside(m),
    beforeCheck: () => session.persistence.flush(),
    // A readable file put in .hidden/ while the hidden items are locked: their password is asked at once, and the file is encrypted then.
    hiddenNeedsKey: (names) => {
      if (document.querySelector("dialog[open]")) return; // (another question is open: the next change asks)
      void askHiddenPassword(session, `${names.length === 1 ? `“${names[0]}” was` : `${names.length} files were`} put in the hidden folder (.hidden/) and ${names.length === 1 ? "is" : "are"} still readable there. Enter the password of the Hidden items to encrypt ${names.length === 1 ? "it" : "them"} now.`);
    },
    canvasesChanged: (ids) => session.outsideChanged(ids),
  });
  assets.setBudget(Number(settings.get("cache.decodedMb")) * 2 ** 20);
  /** The library for what makes a file or a copy: hidden items always a padlock there (see `syncReveal`). */
  const filesAssets = assets.forFiles();
  const textureHost = createTextureHost({ doc, index, assets: filesAssets, theme: () => theme, editor });
  setTextureHost(textureHost); // (texture fills, ADR 0154)
  // A gesture on a source of an objects fill (moving, turning, resizing, recolouring it): the fill follows at each step, not on release.
  let livePreview: EditorState["preview"] | null = null;
  let liveUsers: string[] = [];
  editor.subscribe(() => {
    const p = editor.preview;
    if (p === livePreview) return;
    livePreview = p;
    const users = p.kind === "none" || p.kind === "edit" || !objectsUsers.size ? [] : fillUsersOf(editor.previewIds());
    if (users.length) textureHost.live(true);
    else if (liveUsers.length) textureHost.live(false);
    if (users.length || liveUsers.length) tiles.invalidate(new Set([...users, ...liveUsers]));
    liveUsers = users;
  });
  applyHeldQuality();
  // The fonts texts are set in (ADR 0127): read from the library when a text names one; when one arrives, text made without it is drawn and measured again.
  const fontLoader = new FontLoader(async (hash) => (await assets.record(hash))?.blob);
  const wantFonts = (objs: Iterable<CanvasObject | undefined>): void => {
    for (const o of objs) {
      if (o?.kind !== "text") continue;
      if (o.assetId && fontLoader.state(o.assetId) === undefined) void fontLoader.ensure(o.assetId);
      for (const m of o.md.matchAll(/font-family:([0-9a-f]{64})/gi)) if (fontLoader.state(m[1]!.toLowerCase()) === undefined) void fontLoader.ensure(m[1]!.toLowerCase());
    }
  };
  doc.subscribe((_source, changed) => wantFonts(changed ? [...changed].map((id) => doc.get(id)) : doc.all()));
  onFontsChange(() => {
    doc.refresh(new Set([...doc.all()].filter((o) => o.kind === "text" && (o.assetId || o.md.includes("font-family:"))).map((o) => o.id)));
    tiles.clear();
    invalidate();
  });
  // Decoded images nothing has asked for lately are released when over budget, even if nothing is drawn (ADR 0027).
  setInterval(() => assets.evict(), 2000);

  let backdrop: ({ f: Frame } & ReturnType<typeof worldBackdrop>) | null = null;
  /** Render synchronously and return the timing breakdown. */
  const renderNow = (shot?: { pattern: boolean; overlays: boolean; transparent: boolean }): FrameBreakdown => {
    const t0 = performance.now();
    const cam = view.camera;
    const fc = view.frameCamera;
    const vp = view.viewport;
    // Axes and landmarks are world-frame content, re-expressed in the camera frame (once per frame change).
    if (backdrop?.f !== fc.f) backdrop = { f: fc.f, ...worldBackdrop(fc.f, LANDMARKS) };
    renderFrame(ctx, cam, vp, dpr, theme, backdrop.landmarks, backdrop.origin, shot && !shot.pattern ? "none" : settings.get("ui.pattern"), !shot?.transparent);
    density.draw(ctx, index.views(fc), index.dots(fc), vp, doc.revision);
    const t1 = performance.now();
    // Previews (move/resize in progress) change committed objects' appearance: draw directly.
    let runs: Map<ProjectedObject, number> | undefined;
    let blendShown = false;
    for (const id of blended) {
      const o = doc.get(id);
      if (!o || o.hidden) continue;
      const oc = cameraIn(fc, o.frame ?? doc.space.world);
      if (isCoarse(fc, o.frame ?? doc.space.world) || (oc && projectObject(o, oc, vp, { keepTiny: true }))) {
        blendShown = true;
        break;
      }
    }
    /** Extra CSS px round an object's box for antialiasing, line width and adjustments. */
    const reach = (po: ProjectedObject): number => (po.obj.kind === "stroke" ? strokeLineWidth(po) / 2 + 2 : 2) + adjustReach(po);
    const tiled =
      editor.preview.kind === "none" && !blendShown
        ? tiles.draw(
            ctx,
            cam,
            fc.f.id,
            vp,
            dpr,
            (infl) => visibleObjects(doc, index, null, fc, infl),
            (c, list, all, infl) => drawObjects(c, list, assets, infl, dpr, theme, (runs ??= batchRuns(all))),
            reach,
            (o, infl) => {
              // A changed coarse object may cover any tile: drop them all.
              if (isCoarse(fc, o.frame ?? doc.space.world)) return coverObject(o, infl, {});
              const oc = cameraIn(fc, o.frame ?? doc.space.world);
              return oc && projectObject(o, oc, infl, { keepTiny: true });
            },
            // Idle-time prebuild of the zoom levels around this one (ADR 0033), in the same frame.
            (dz) => {
              const fc2 = normalize(fc.f.space, { ...fc, z: fc.z + dz });
              if (fc2.f !== fc.f) return null;
              let lastAll: readonly ProjectedObject[] | null = null;
              let lastRuns: Map<ProjectedObject, number> | undefined;
              return {
                cam: localCamera(fc2),
                query: (infl) => visibleObjects(doc, index, null, fc2, infl),
                draw: (c, list, all, infl) => {
                  if (all !== lastAll) lastRuns = batchRuns((lastAll = all));
                  return drawObjects(c, list, assets, infl, dpr, theme, lastRuns);
                },
              };
            },
            // Zooming out with no set that covers the view: what lies outside the scaled tiles is drawn directly, clipped to that border.
            (c, hole) => {
              const all = visibleObjects(doc, index, null, fc, vp);
              const out = all.filter((po) => {
                const e = reach(po);
                return po.box.minX - e < hole.l || po.box.minY - e < hole.t || po.box.maxX + e > hole.r || po.box.maxY + e > hole.b;
              });
              if (!out.length) return;
              c.save();
              c.beginPath();
              c.rect(0, 0, vp.width, vp.height);
              c.rect(hole.l, hole.t, hole.r - hole.l, hole.b - hole.t);
              c.clip("evenodd");
              drawObjects(c, out, assets, vp, dpr, theme, batchRuns(all));
              c.restore();
            },
          )
        : null;
    let visible: ReturnType<typeof visibleObjects> | null = null;
    let t2 = performance.now();
    if (!tiled) {
      visible = visibleObjects(doc, index, editor, fc, vp);
      t2 = performance.now();
      drawObjects(ctx, visible, assets, vp, dpr, theme);
    }
    // Selection outlines need the visible selected objects; query only when something is selected.
    // Inside a boolean group (ADR 0103) its members are drawn as outlines over its result, and are what can be selected.
    // The names above the items (ADR 0108, 0125): only looked for when the canvas has an item that can carry one.
    const labelList = labelIds.size && settings.get("ui.names") !== "off" ? (visible ??= visibleObjects(doc, index, editor, fc, vp)) : [];
    labels = itemLabels(labelList, editor.selection, vp, (h) => assetNames.get(h), settings.get("ui.names"));
    const members = editor.entered.length ? visibleObjects(doc, index, editor, fc, vp, undefined, { entered: editor.entered, mode: "members" }) : [];
    const selected = editor.selection.size
      ? [...(visible ?? visibleObjects(doc, index, editor, fc, vp)).filter((po) => editor.selection.has(po.obj.id)), ...members.filter((po) => editor.selection.has(po.obj.id))]
      : [];
    const cropping = editor.cropId ? selected.find((po) => po.obj.id === editor.cropId && po.obj.kind === "image") : undefined;
    if (cropping && (!shot || shot.overlays)) drawCropGhost(ctx, cropping, assets.get(rasterKey(cropping.obj as ImageObject)), vp);
    if (!shot || shot.overlays) {
      const words = selected.length === 1 && selected[0]!.obj.kind === "text" ? (selected[0]!.obj as TextObject).inShape?.shape : undefined;
      const owner = words !== undefined && (doc.get(words) as PathObject | undefined)?.params?.balloon ? visibleObjects(doc, index, null, fc, vp).find((p) => p.obj.id === words) : undefined;
      drawOverlays(ctx, selected, editor, fc, vp, theme, members, labels, owner);
    }
    if ((editor.revealAt || editor.revealIds) && (!shot || shot.overlays)) {
      const all = (visible ??= visibleObjects(doc, index, editor, fc, vp));
      if (editor.revealIds) drawRevealOutlines(ctx, all.filter((po) => editor.revealIds!.has(po.obj.id)), theme, true);
    }
    if (editor.revealAt && (!shot || shot.overlays)) {
      const all = (visible ??= visibleObjects(doc, index, editor, fc, vp));
      const name0 = (po: ProjectedObject): string => labelOf(po.obj, assetNames.map).text; // (as Layers names it)
      let hits = revealHits(all, editor.revealAt.x, editor.revealAt.y);
      // Over nothing inside the selection's box: what the selection holds, the very rows of the list a click opens (choicesAt): a nested group
      // is one row, by its name, outlined whole, and picked whole.
      // Every item, nested groups' items indented under them, in the small list beside the pointer, which scrolls (the wheel, while Ctrl is held).
      const rows: Choice[] = hits.length ? [] : choicesAt(editor.revealAt).filter((c) => c.from === "selection");
      // (each row by its own key, a group's id for a group: shown by its first thing, so two rows never share one)
      const keyOf = (c: Choice): string => c.key ?? c.ids[0]!;
      if (rows.length) hits = rows.flatMap((c) => all.filter((po) => po.obj.id === c.ids[0]).map((po) => (keyOf(c) === po.obj.id ? po : { ...po, obj: { ...po.obj, id: keyOf(c) } as CanvasObject })));
      editor.revealRows = rows.length ? new Map(rows.map((c) => [keyOf(c), { ids: c.ids, enter: c.enter }])) : null;
      const rowName = new Map(rows.map((c) => [keyOf(c), c.label]));
      const name = (po: ProjectedObject): string => rowName.get(po.obj.id) ?? name0(po);
      // (the row under the pointer outlines all it stands for, strongly; the other rows only by the one thing that shows them)
      const hotRow = rows.find((c) => keyOf(c) === editor.revealHot);
      if (hotRow) drawRevealOutlines(ctx, all.filter((po) => hotRow.ids.includes(po.obj.id)), theme, true);
      const dim = dimHits(all, hiddenInView(doc, fc, vp), editor.revealAt.x, editor.revealAt.y);
      const shownPicked = rows.length ? new Set([...editor.selection, ...rows.filter((c) => c.ids.every((id) => editor.selection.has(id))).map(keyOf)]) : editor.selection;
      const rowDepth = new Map(rows.map((c) => [keyOf(c), c.depth ?? 0]));
      editor.revealList = drawReveal(ctx, hits, editor.revealAt, theme, name, dim, shownPicked, editor.revealHot, { ...(rows.length ? { depth: (id: string) => rowDepth.get(id) ?? 0 } : {}), scroll: editor.revealScroll });
      // (a screen reader hears the same words through the hint line, once for each change)
      const said = hits.length || dim.length ? `Under the pointer: ${[...hits.map((po) => revealWords(name(po))), ...dim.map((d) => revealWords(name(d.po), d.why))].join(", ")}` : null;
      if (said !== editor.revealText) {
        editor.revealText = said;
        hintLine.current?.refresh();
      }
    } else if (editor.revealText !== null) {
      editor.revealText = null;
      hintLine.current?.refresh();
    }
    const t3 = performance.now();
    const b: FrameBreakdown = {
      totalMs: t3 - t0,
      baseMs: t1 - t0,
      visibleMs: tiled ? 0 : t2 - t1,
      drawMs: tiled ? t3 - t1 : t3 - t2,
      visibleCount: tiled ? tiled.visible : visible!.length,
      tiles: tiled,
    };
    stats.last = b;
    return b;
  };

  let appView: AppView = "canvas";
  let contextUpdate: () => void = () => undefined;
  let drawCount = 0;
  const draw = (): void => {
    drawCount++;
    scheduled = false;
    // Assets view covers the canvas: rendering is suspended (frame waiters still resolve).
    if (appView === "canvas") {
      const ms = renderNow().totalMs;
      if (!performance.getEntriesByName("canvast:first-frame").length) mark("first-frame");
      stats.record(ms);
      quality.record(ms);
      contextUpdate();
    }
    const waiters = frameWaiters;
    frameWaiters = [];
    for (const w of waiters) w();
  };

  const session = new Session(storage, doc, view, editor, assets);
  session.settingsHook = { snapshot: (withPrivacy) => Object.fromEntries(Object.entries(settings.snapshot()).filter(([k]) => (withPrivacy || !PRIVACY_KEYS.includes(k)))), privacySet: () => PRIVACY_KEYS.some((k) => settings.isSet(k as never)), restore: (s) => settings.restore(s), restorable: (s) => settings.restorable(s), getAuto: () => settings.get("storage.autoIndex"), setAuto: (on) => void settings.set("storage.autoIndex", on), workspace: () => settings.workspaceValues(), adopt: (from) => void settings.adoptWorkspace(from), localAt: () => settings.workspaceAt() };
  // A workspace setting changed here (not one just taken from the workspace) is kept in the workspace: once for many at a time (an import).
  let wsSettingsDue = false;
  settings.subscribe((key) => {
    if (SETTINGS[key].scope !== "workspace" || settings.adopting || wsSettingsDue) return;
    wsSettingsDue = true;
    queueMicrotask(() => {
      wsSettingsDue = false;
      void session.saveWorkspaceSettings(settings.workspaceValues());
    });
  });
  // A file card on a canvas shows its custom thumbnail (a shown library item's, or an uploaded normal one): never a hidden one.
  assets.customPicture = async (hash) => {
    const e = await session.catalog?.entry(hash);
    const t = e && !meta(e).hidden ? meta(e).thumb : null;
    if (!t) return null;
    const target = await session.catalog?.entry(t);
    const own = target && !meta(target).hidden ? (await session.catalog?.thumb(t).catch(() => undefined))?.blob : undefined;
    return own ?? (await storage?.customThumbs.get(t).catch(() => null)) ?? null;
  };
  // (desktop only: the browser has no trash to send a file to, so the setting does nothing there even when a backup brought it)
  session.writeNoteFiles = () => settings.get("notes.writeProps");
  session.deleteAtOnce = () => !!desktopBridge(); // (the desktop app: a deleted item's file goes into .trash at once, the trash being the way back)
  // The desktop build: before its window closes, the last edits reach the workspace folder (ADR 0177).
  // While files are still being written into the folder (an import's), closing asks first: the rest are written at the next start.
  let opened = false; // (the workspace is open: past the lock screen, its session started)
  // A device asking to see this workspace (Settings > Sharing) is answered from anywhere in the app.
  const share = desktopBridge()?.share;
  if (share) installShareAsk(share);
  if (share) sendView(view, session, share); // (for guests that follow: ADR 0184)
  if (share && storage?.hiddenFiles && storage.sharedThumb) installShareFolder(share, storage.hiddenFiles, storage.sharedThumb.bind(storage));
  desktopBridge()?.onClosing(async () => {
    if (!opened) return; // (still locked or starting: nothing was changed, so nothing waits to be written)
    // A note open with changes not saved: Save them, Don't save, or Cancel (the window stays).
    if (anyNoteDirty()) {
      await desktopBridge()!.holdClose();
      if (!(await leaveAllNotes())) return false;
    }
    const writing = storage?.folderWriting?.now();
    if (writing && writing.total >= BUSY_FILES) {
      await desktopBridge()!.holdClose();
      const close = await confirmDialog({
        title: "Files are still being written",
        lines: [
          `${writing.done} of ${plural(writing.total, "file")} ${writing.done === 1 ? "is" : "are"} in the workspace folder so far.`,
          "Closing now stops it: your work is safe in the app, and the rest are written the next time you open this workspace. Keep the app open until it ends to have every file in the folder.",
        ],
        confirmLabel: "Close anyway",
      });
      if (!close) return false;
      await session.persistence.flush();
      await session.persistence.saveCamera();
      return; // (not waiting for the files)
    }
    await session.persistence.flush();
    await session.persistence.saveCamera();
    await storage?.flush();
  });
  // A long write of files into the workspace folder (an import's) keeps the app waiting, so nothing is changed half-way.
  let busy: BusyScreen | null = null;
  storage?.folderWriting?.subscribe((done, total, encrypting) => {
    if (!total) {
      busy?.close();
      busy = null;
      return;
    }
    const doing = encrypting === "placing" ? "Renaming hidden files into their encrypted folders" : encrypting ? "Encrypting hidden files" : "Writing the files into the workspace folder";
    const shown = currentBusy();
    if (shown && shown !== busy) return shown.update(done / total, `${doing}: ${done} of ${total}`); // (a task's own screen, as an import's: one bar)
    // (Encrypting reads each file back and opens it to prove it, so a few already take a while: shown from BUSY_SEALS on.)
    if (!busy && total < (encrypting === true ? BUSY_SEALS : BUSY_FILES)) return;
    busy ??=
      encrypting === "placing"
        ? openBusyScreen("Updating hidden items", ["Hidden files are renamed into encrypted folders and names, once, after this update. Nothing is encrypted again, so your sync tool sees renames. Keep the app open until it ends."])
        : encrypting
          ? openBusyScreen("Encrypting hidden items", ["Each file is encrypted into .hidden/, read back to prove it, and only then is the readable one deleted. Keep the app open until it ends."])
          : openBusyScreen("Writing the workspace to its folder", ["The files are copied into the workspace folder, so other programs and devices see them. Keep the app open until it ends."]);
    busy.update(done / total, `${encrypting === "placing" ? "Renaming" : encrypting ? "Encrypting" : "Writing"} ${done} of ${plural(total, "file")}`);
  });
  // Objects that follow a saved colour or gradient (ADR 0157) are brought in step when the style changes and when a canvas is opened: one undo
  // step while there is history; right after opening there is none, so the change is quiet.
  const followStyles = (): void => {
    const next = linkedUpdates(doc, session.styles.items);
    if (!next.length || editor.blockEdit()) return;
    if (doc.canUndo || doc.canRedo) doc.commit(doc.transaction("Update from the saved style", next));
    else doc.refit(next);
  };
  session.styles.subscribe(followStyles);
  doc.subscribe((source, changed) => {
    if (source === "load" && changed === null) followStyles();
  });
  // Hidden library items are drawn as a padlock on every canvas, whatever the password state, until they are shown again.
  const namesForgotten = new Set<string>();
  const syncHidden = async (): Promise<void> => {
    const hidden = await session.catalog?.hiddenHashes().catch(() => null);
    if (hidden) {
      // (newly hidden: at the start every hidden item, a batch at a time, for an item hidden on another device)
      const fresh = [...hidden].filter((h) => !namesForgotten.has(h));
      for (const h of fresh) namesForgotten.add(h);
      for (let at = 0; at < fresh.length; at += 1000) void session.forgetPlacedNames(fresh.slice(at, at + 1000)).catch(() => undefined);
    }
    if (hidden && assets.setHidden(hidden)) {
      assetNames.clear();
      tiles.clear();
      invalidate();
    }
  };
  session.subscribeAssets((_meta, usageOnly) => void (usageOnly || syncHidden()));
  // Hidden items' pictures on the canvas (the screen only): while Settings > Privacy remembers the Hidden password and it was given
  // here, or while hidden mode is on outside the library (Stay in hidden mode); and, in the desktop app, while their key is open. What makes a file uses `filesAssets`, and a capture of the screen is drawn with
  // padlocks first (`padlocked`), so nothing readable of them leaves the app.
  // The file panel (file-panel.ts): made once the library view is, which it imports through.
  let notePanel: { open(hash: string, card?: CardActions): Promise<boolean>; close(): Promise<boolean>; closeHidden(): void } = { open: async () => false, close: async () => true, closeHidden: () => undefined };
  const syncReveal = (): void => {
    const on = ((settings.get("library.hiddenRemember") && hiddenRemembered()) || hiddenModeOn()) && (storage?.hidden ? storage.hidden.isOpen() : true);
    if (on === assets.revealing) return;
    if (!on) notePanel.closeHidden(); // (nothing hidden stays open on a canvas once hidden items are no longer shown)
    assets.reveal(on);
    assetNames.clear();
    tiles.clear();
    invalidate();
  };
  onHiddenRemembered(syncReveal);
  /** Run a capture of the screen with hidden items drawn as padlocks (the tiles are drawn again before and after). */
  const padlocked = <T>(capture: () => T): T => {
    if (!assets.revealing) return capture();
    assets.revealing = false;
    tiles.clear();
    try {
      return capture();
    } finally {
      assets.revealing = true;
      tiles.clear();
      invalidate();
    }
  };
  storage?.hidden?.subscribe(syncReveal);
  settings.subscribe((key) => key === "library.hiddenRemember" && syncReveal());
  // A hidden item drawn as a padlock is named "Hidden item" on canvases (its label, the Layers panel): its name is shown only with its picture.
  const assetNames = new AssetNames(async (hash) => {
    const e = await session.catalog?.entry(hash).catch(() => undefined);
    if (!e) return "";
    return e.hidden && !assets.revealing ? `Hidden item${/\.[A-Za-z0-9]{1,8}$/.exec(e.name)?.[0] ?? ""}` : e.name;
  });
  assetNames.subscribe(() => invalidate());
  if (storage) {
    try {
      // A workspace password: nothing of the workspace is read or drawn until it is given.
      const lock = await session.catalog?.lock("workspace").catch(() => null);
      // (checked against the password read here, so the check never waits for the storage, busy right after an import)
      startStep("lock read");
      // (not on the start right after an import: the password was given before it, in this same window)
      const afterImport = takeStayUnlocked(); // (taken in any case, so it never outlives this start)
      if (lock && !afterImport) {
        opening?.close(); // (the lock screen in its place)
        await openLockScreen((typed) => checkLock(lock, typed));
        opening = openStartScreen("");
      }
      await syncHidden(); // (before the first canvas is drawn)
      await session.start();
      opened = true;
      if (session.startup?.kind === "migrated") {
        const m = session.startup.migration;
        editor.message = m.verified
          ? `Upgraded your canvas to the new storage format (${m.copied} objects, verified). The old data was kept.`
          : `Upgrade could not be verified (${m.verifyError ?? "unknown"}). The old data was kept unchanged.`;
      }
      const after = takeAfterReload(); // (an import's result, from before the app started again)
      if (after) editor.message = after;
    } catch (e) {
      editor.message = `Could not open the workspace: ${(e as Error).message}`;
    }
  } else {
    editor.message = `Storage unavailable (${storageError}); work will not be saved.`;
  }
  stopSteps();
  opening?.close();
  opening = null;
  const persistence = session.persistence;
  // Startup marks (docs/testing/phase-8.md): the canvas is loaded, the index is complete (the first frame is marked where it is drawn).
  mark("loaded");
  void indexSync.ready().then(() => mark("indexed"));
  const selectedPictures = (): ImageObject[] => [...editor.selection].flatMap((id) => { const o = doc.get(id); return o?.kind === "image" ? [o] : []; });
  /** Rename the file of the picked pictures in the library with the library's own dialog; a layer with a name of its own takes the new name too. */
  const renamePictures = async (): Promise<void> => {
    const pics = selectedPictures();
    const hashes = [...new Set(pics.map((o) => o.assetId))];
    const items = (await Promise.all(hashes.map(async (h) => ({ id: h, name: (await session.catalog?.entry(h).catch(() => undefined))?.name ?? "" })))).filter((i) => i.name);
    if (!items.length) return;
    const result = await openBatchRename(items, { noun: items.length === 1 ? "item" : "items" });
    if (!result) return;
    if (!(await session.renameAssets(result.map((r) => ({ hash: r.id, name: r.name }))))) return;
    for (const r of result) assetNames.set(r.id, r.name);
    const newName = new Map(result.map((r) => [r.id, r.name]));
    for (const o of pics) if (o.name && newName.has(o.assetId)) renameLayer(doc, editor, o.id, newName.get(o.assetId)!);
    editor.message = result.length === 1 ? `Renamed to “${result[0]!.name}”.` : `Renamed ${result.length} items.`;
  };
  session.onAssetsRenamed = () => {
    tiles.clear(); // cards drawn with the old name
    invalidate();
  };

  const resize = (): void => {
    const r = host.getBoundingClientRect();
    dpr = effectiveDpr();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    view.setViewport({ width: r.width, height: r.height });
    invalidate();
  };
  new ResizeObserver(resize).observe(host);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    theme = readTheme(document.documentElement);
    setCanvasInk(theme.ink);
    tiles.clear();
    invalidate();
  });

  view.subscribe(invalidate);
  // Backend recovery (ADR 0023): if the browser takes the 2D drawing surface away (a GPU reset, memory pressure), keep the
  // document and the camera, drop every cached raster (tiles are canvases of their own and may be lost with it), and redraw.
  canvas.addEventListener("contextlost", (e) => {
    e.preventDefault(); // allows the browser to restore the context
    editor.message = "The browser reset the drawing surface; redrawing.";
    editor.changed();
  });
  canvas.addEventListener("contextrestored", () => {
    tiles.clear();
    editor.message = "";
    editor.changed();
    invalidate();
  });
  doc.subscribe(invalidate);
  // The cursor of the tool in use: its own icon beside a crosshair (ui/tool-cursor.ts), made again only when the tool or its kind changes.
  let cursorFor = "";
  const showTool = (): void => {
    canvas.dataset["tool"] = editor.tool;
    const key = `${editor.tool}|${editor.shapeKind}|${editor.penKind}`;
    if (key === cursorFor) return;
    cursorFor = key;
    const icon = toolIcon(editor.tool, editor.shapeKind, editor.penKind);
    if (icon) canvas.style.setProperty("--tool-cursor", toolCursor(icon));
    else canvas.style.removeProperty("--tool-cursor");
  };
  editor.subscribe(() => {
    showTool();
    invalidate();
  });
  editor.subscribeRedraw(invalidate);
  showTool();

  const importFiles = (files: File[]): Promise<unknown> => importImages(files, assets, doc, view, editor);
  attachNavigation(canvas, view);
  /** The fonts in the library, loaded: for the font choices of the toolbar and of the words selected in a text. */
  const libraryFonts = async (): Promise<Array<{ hash: string; name: string; unusable: string }>> => {
    const list = (await session.catalog?.list())?.entries ?? [];
    const fonts = list.filter((e) => e.present && !e.hidden && describeFile(e.name, e.type).category === "Font").sort((a, b) => a.name.localeCompare(b.name));
    await Promise.all(fonts.map((e) => fontLoader.ensure(e.hash)));
    return fonts.map((e) => ({ hash: e.hash, name: e.name.replace(/\.[A-Za-z0-9]{1,5}$/, ""), unusable: fontLoader.state(e.hash) === "failed" ? fontLoader.reason(e.hash) : "" }));
  };
  const textEditor = mountTextEditor(host, view, doc, editor, libraryFonts);
  const copySelectedMarkdown = (): void => {
    const md = doc.ordered().flatMap((o) => (o.kind === "text" && editor.selection.has(o.id) ? [o.md] : []));
    if (!md.length) return;
    void copyText(md.join("\n\n")).then(() => {
      editor.message = "Copied Markdown";
      editor.changed();
    });
  };
  /** Screen px per local unit of a text at this view (0 when it is not on screen). */
  const textPpu = (id: string): number => {
    const po = visibleObjects(doc, index, null, view.frameCamera, view.viewport).find((p) => p.obj.id === id);
    return po && !po.cover ? po.proj.ppu : 0;
  };
  const bookmarkList = new BookmarkList(session, view, doc);
  installMenuKeys();
  const focusCycle = createFocusCycle(doc, view, editor, () => true);
  const canvasSearch = mountCanvasSearch(host, {
    doc,
    editor,
    bookmarks: bookmarkList,
    entry: async (hash) => {
      const e = await session.catalog?.entry(hash);
      return e ? { name: e.name, tags: e.tags ?? [] } : undefined;
    },
    focus: (ids) => focusObjects(doc, view, ids, settings.get("nav.arrive") === "focus"),
    saved: { get: () => settings.get("search.saved.canvas"), set: (v) => void settings.set("search.saved.canvas", v) },
    onScreen: (o) => {
      const fc = view.frameCamera;
      const oc = cameraIn(fc, o.frame ?? doc.space.world);
      return isCoarse(fc, o.frame ?? doc.space.world) || !!(oc && projectObject(o, oc, view.viewport, { keepTiny: true }));
    },
  });
  // (a panel of the dock: floating at first, as wide as a page, its own width also when docked)
  const notePanelEl = document.createElement("section");
  notePanelEl.className = "layers-panel note-dock"; // (a dock panel like the others: their look, header and width)
  notePanelEl.dataset["testid"] = "note-panel";
  notePanelEl.hidden = true;
  // The other host (Settings > Notes > Note editor on a canvas: Window): the same panel, centred over a scrim; a press on the scrim closes it.
  const noteWindow = document.createElement("div");
  noteWindow.className = "note-window";
  const noteWindowEl = document.createElement("section");
  noteWindowEl.className = "layers-panel note-dock";
  noteWindowEl.dataset["testid"] = "note-window";
  noteWindowEl.setAttribute("role", "dialog");
  noteWindowEl.hidden = true;
  noteWindow.append(noteWindowEl);
  document.body.append(noteWindow);
  noteWindow.addEventListener("pointerdown", (e) => void (e.target === noteWindow && notePanel.close()));
  const notePanelReady = (d: FilePanelDeps): void => void (notePanel = mountFilePanel({ panel: notePanelEl, window: noteWindowEl }, d, () => settings.get("notes.panelMode")));
  let newNoteAt: (at: ScreenPoint, widthPx?: number) => Promise<void> = async () => undefined;
  let makeNoteFiles: () => Promise<void> = async () => undefined;
  /**
   * What the list to choose from holds at a point (one rule for Ctrl+click and a long press): what is under it, top first, with the hidden,
   * locked and mask parts there; then, when it is inside the selection's box, what the selection holds: a lone group's items one level in,
   * or each selected thing (a group or a sheet as one row). Words and connectors say whose they are.
   */
  interface Choice { /** The row's own key: a group's id, else its thing's. */ key?: string; /** How deep under a group of the selection (0: the selection's own items). */ depth?: number; ids: ObjectId[]; enter: string[]; label: string; icon: string; why?: RevealWhy; from: "here" | "selection"; sep?: boolean }
  const choicesAt = (at: ScreenPoint): Choice[] => {
    const fc = view.frameCamera, vp = view.viewport;
    const all = visibleObjects(doc, index, editor, fc, vp);
    const named = (o: CanvasObject): { label: string; icon: string } => {
      const l = labelOf(o, assetNames.map);
      const owner = ownerOf(o);
      const of = owner !== undefined ? doc.get(owner) : undefined;
      return { icon: l.icon, label: of ? `${o.kind === "text" ? "Words" : "Connector"} of ${labelOf(of, assetNames.map).text}` : l.text };
    };
    const one = (o: CanvasObject, from: Choice["from"], why?: RevealWhy): Choice => ({ ids: [o.id], enter: [...(o.groups ?? [])], ...named(o), from, ...(why ? { why } : {}) });
    const out: Choice[] = [
      ...revealHits(all, at.x, at.y).map((po) => one(po.obj, "here")),
      ...dimHits(all, hiddenInView(doc, fc, vp), at.x, at.y).map((d) => one(d.po.obj, "here", d.why)),
    ];
    // (the selection's box from where its things are on screen: the drawn box is not there while Ctrl is held)
    const boxes = all.filter((po) => editor.selection.has(po.obj.id)).map((po) => po.box);
    const inBox = boxes.length > 0 && at.x >= Math.min(...boxes.map((b) => b.minX)) && at.x <= Math.max(...boxes.map((b) => b.maxX)) && at.y >= Math.min(...boxes.map((b) => b.minY)) && at.y <= Math.max(...boxes.map((b) => b.maxY));
    if (!inBox) return out;
    const level = editor.entered.length;
    const sel = rootsOf(doc.ordered().filter((o) => editor.selection.has(o.id) && ownerOf(o) === undefined && !isResult(o))).reverse();
    const unitsAt = (lv: number): Map<string, CanvasObject[]> => {
      const m = new Map<string, CanvasObject[]>();
      for (const o of sel) (m.get(o.groups?.[lv] ?? o.id) ?? m.set(o.groups?.[lv] ?? o.id, []).get(o.groups?.[lv] ?? o.id)!).push(o);
      return m;
    };
    let lv = level;
    let units = unitsAt(lv);
    if (units.size === 1 && sel[0]?.groups?.[lv] !== undefined) units = unitsAt(++lv); // (a lone group: its items)
    const listed = new Set(out.map((c) => c.ids.join()));
    let first = true;
    // A row for each item, and under a group its own items, indented (as deep as groups go): any one of them can be picked from the list.
    const addRows = (objs: readonly CanvasObject[], at: number, depth: number): void => {
      const m = new Map<string, CanvasObject[]>();
      for (const o of objs) (m.get(o.groups?.[at] ?? o.id) ?? m.set(o.groups?.[at] ?? o.id, []).get(o.groups?.[at] ?? o.id)!).push(o);
      for (const [key, items] of m) {
        const head = items[0]!;
        const group = key !== head.id;
        const ids = items.map((o) => o.id);
        if (depth === 0 && listed.has(ids.join())) continue;
        // (the names Layers shows: groupLabel and labelOf, never a list's own)
        const g = group ? groupLabel(head, key, ids.length) : null;
        out.push({ key, depth, ids, enter: [...(head.groups ?? []).slice(0, at)], icon: g ? g.icon : named(head).icon, label: g ? g.text : named(head).label, from: "selection", ...(first && out.length ? { sep: true } : {}) });
        first = false;
        if (group) addRows(items, at + 1, depth + 1);
      }
    };
    addRows([...units.values()].flat(), lv, 0);
    return out;
  };
  const openChoiceList = (at: ScreenPoint, pick: (ids: readonly ObjectId[], enter: readonly string[], additive: boolean) => void, opts: { onlyIfChoice: boolean; onOpen(): void; add?: boolean; touch?: boolean }): boolean => {
      const rows = choicesAt(at);
      // (Ctrl+click on something that can be picked picks it at once, as ever: the list is for where nothing pickable is under the pointer)
      if (!rows.length || (opts.onlyIfChoice && rows.some((r) => r.from === "here" && !r.why))) return false;
      opts.onOpen();
      const box = canvas.getBoundingClientRect();
      const anchor = document.createElement("div");
      anchor.style.cssText = `position:fixed;left:${box.left + at.x}px;top:${box.top + at.y}px;width:0;height:0;pointer-events:none`;
      document.body.appendChild(anchor);
      let add = opts.add ?? false;
      const HINT: Record<RevealWhy, string> = { hidden: "Hidden: press to show it", locked: "Locked: press to unlock it", mask: "Part of a mask" };
      const items = (): MenuItem[] => [
        { id: "reveal-add", label: "Add to the selection", hint: "Press to add or remove; press outside to end", icon: ICONS.listChecks, checked: add, run: () => { add = !add; } },
        ...rows.map((r, i): MenuItem => {
          const on = r.ids.every((id) => editor.selection.has(id));
          return { id: `reveal:${r.key ?? r.ids[0]}`, label: `${"\u2003".repeat(r.depth ?? 0)}${r.label}`, hint: r.why ? HINT[r.why] : r.from === "selection" ? "In the selection: select this one" : "Select this one", icon: r.icon, checked: on, disabled: r.why === "mask", ...(r.sep && i > 0 ? { sep: true } : {}), run: () => {
            if (r.why === "hidden" || r.why === "locked") {
              setFlagOn(doc, editor, r.ids, r.why, false);
              return void closeMoreMenu();
            }
            if (add && on) editor.select([...editor.selection].filter((x) => !r.ids.includes(x)));
            else pick(r.ids, r.enter, add);
            if (!add) closeMoreMenu();
          } };
        }),
        ...(opts.touch ? canvasItems(registry, true).map((it, i): MenuItem => ({ ...it, ...(i === 0 ? { sep: true } : {}), run: () => { closeMoreMenu(); it.run(); } })) : []),
      ];
      openMoreMenu(anchor, items(), opts.touch ? "Under your finger" : "Choose what to select", {
        keepOpen: true,
        consumeOutside: true,
        needPress: true,
        refresh: items,
        onActive: (i) => { const r = i === null || i < 1 ? undefined : rows[i - 1]; editor.revealIds = r ? new Set(r.ids) : null; editor.redraw(); },
        onClose: () => { anchor.remove(); editor.revealIds = null; editor.redraw(); },
      });
      // (once: what the list is, for whoever meets it for the first time)
      try {
        if (!localStorage.getItem("canvast.hint.pickList")) {
          localStorage.setItem("canvast.hint.pickList", "1");
          editor.message = "Choose what to select: what is here, hidden and locked things too, and what the selection holds. Shift adds; Alt goes on to the one below.";
          editor.changed();
        }
      } catch { /* (a browser that keeps nothing says it each time it would: nothing) */ }
      return true;
  };
  // The wheel scrolls the list beside the pointer while it is open and longer than it shows (Ctrl+wheel zooms again once Ctrl is let go).
  window.addEventListener("wheel", (e) => {
    if (e.target !== canvas || !scrollReveal(editor, Math.sign(e.deltaY) * (Math.abs(e.deltaY) > 150 ? 3 : 1))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true, passive: false });
  attachTools(canvas, view, doc, index, editor, { listAutoScroll: () => settings.get("select.listAutoScroll"), edgePanSpeed: () => (settings.get("nav.edgePanOn") ? settings.get("nav.edgePan") / 100 : 0), editText: (t, at, box) => textEditor.open(t, at, box), openItem: (h, id) => {
        const o = doc.get(id);
        void notePanel.open(h, o?.kind === "image" ? cardActions(o) : undefined);
      }, newNote: (at, w) => void newNoteAt(at, w), toolForKey: (k) => toolForKey(k), navForKey: (k) => navForKey(k),
    navigate: (dir) =>
      void stepToNeighbour(doc, view, editor, dir, settings.get("nav.mode"), settings.get("nav.arrive") === "focus", (o, unit) => {
        // the name the Layers list shows: a group's own, else the item's
        const gid = unit.length > 1 ? o.groups?.[editor.entered.length] : undefined;
        return gid ? (o.groupNames?.[gid] ?? "Group") : labelOf(o, assetNames.map).text;
      }),
    focusSelection: () => focusCycle.tap(),
    labels: () => labels,
    openSearch: (prefix) => canvasSearch.open(prefix),
    // The list to choose from (ADR 0151), one for a long press and Ctrl+click: what is under the pointer (hidden and locked things too, which a
    // press shows or unlocks), then, inside the selection's box, what the selection holds (a group's items, or each selected thing). A row
    // outlines its thing while touched and picks it when pressed; "Add to the selection" keeps what is picked; on touch the right-click menu follows.
    revealList: (at, pick, opts) => openChoiceList(at, pick, opts),
  });
  const side = document.createElement("div");
  side.id = "side-panels";
  host.appendChild(side);
  // The panels that are not the Layers go to a second stack on the left (beside the tools), so the right side is not crowded;
  // on a narrow screen they all share the one stack.
  const sideLeft = document.createElement("div");
  sideLeft.id = "side-panels-left";
  host.appendChild(sideLeft);
  const narrow = window.matchMedia("(max-width: 640px)");
  const dock = new PanelDock(sideLeft, side, { initial: settings.get("ui.dock"), persist: (json) => void settings.set("ui.dock", json), narrow: () => narrow.matches, autoFold: () => ({ mode: settings.get("panel.autoFold"), keep: settings.get("panel.keep") }) });
  settings.subscribe((key) => {
    if (key === "panel.autoFold" || key === "panel.keep") dock.apply();
  });
  const bookmarkTour = mountTour(document.body, view, bookmarkList, settings);
  mountBookmarksPanel(side, editor, bookmarkList, () => (assets.revealing ? padlocked(() => (renderNow(), captureThumb(canvas))) : captureThumb(canvas)), () => bookmarkTour.start(), { update: (ids) => void refreshThumbs(ids) }, () => void bookmarkPicked());
  mountMediaPlayer(host, view, doc, editor, assets, settings, { setMedia: (id, patch, label) => setMedia(doc, editor, id, patch, label), extract: (id, png, label) => void extractFrame(doc, editor, assets, id, png, label, (shot) => storeFrame(assets, session, settings, shot)), repaint: (id) => { tiles.invalidate(new Set([id])); invalidate(); } });
  mountLayersPanel(side, editor, doc, {
    setFlagOn: (ids, flag, on) => setFlagOn(doc, editor, ids, flag, on),
    setClip: (id, clip) => setSheetClip(doc, editor, id, clip),
    moveAbove: (ids, above) => moveAbove(doc, editor, ids, above),
    moveLayers: (keys, target, place) => moveLayers(doc, editor, keys, target, place),
    setOrder: (order, label) => setStackOrder(doc, editor, order, label),
    setOpacity: (ids, opacity, final) => setOpacityOn(doc, editor, ids, opacity, final),
    setBlend: (ids, blend) => setBlendOn(doc, editor, ids, blend),
    rename: (key, name) => renameLayer(doc, editor, key, name),
    names: assetNames,
  });
  /** A ratio typed (16:9, 1.5, A4) or a size in px (1920 x 1080), as the Ratio field reads it; null when cancelled or not a ratio (said). */
  const askRatio = async (title: string, value: number | null): Promise<{ ratio: number; typed: string } | null> => {
    const typed = await promptDialog({ title, lines: ["A ratio (16:9, 3/2, 1.5, A4) or a size in px (1920 x 1080), which becomes its ratio."], value: value === null ? "" : formatRatio(value), confirmLabel: "OK" });
    if (typed === null || !typed.trim()) return null;
    const ratio = parseRatio(typed);
    if (ratio === null || !(ratio > 0.01 && ratio < 100)) {
      editor.message = `“${typed}” is not a shape. Try 16:9, 3/2, 1.5, A4 or 1920 x 1080.`;
      editor.changed();
      return null;
    }
    return { ratio, typed: typed.trim() };
  };
  /** Save a custom ratio (a saved style of its own kind, so it is kept in the workspace and goes with every backup), then its name. */
  const saveCustomRatio = async (): Promise<void> => {
    const got = await askRatio("Save a custom ratio", sheetRatio(doc, editor));
    if (!got) return;
    const name = await promptDialog({ title: "Name the ratio", lines: ["It is listed under Custom in the Shapes… list."], value: got.typed, confirmLabel: "Save" });
    if (name === null) return;
    const made = await session.styles.add(RATIO_KIND.id, name, got.ratio);
    editor.message = made ? `Saved the ratio “${made.name}”.` : "Could not save the ratio.";
    editor.changed();
  };
  mountStylesPanel(side, editor, session.styles, {
    ratio: {
      say: (text) => { editor.message = text; editor.changed(); },
      current: () => sheetRatio(doc, editor),
      apply: (r, label) => {
        setSheetRatio(doc, editor, r, true);
        editor.message = `Gave it the ratio “${label}”.`;
        editor.changed();
      },
      ask: async (title, value) => (await askRatio(title, value))?.ratio ?? null,
    },
    balloon: { can: () => selectedBalloon(doc, editor) !== null, apply: (look) => applyBalloonStyle(doc, editor, look) },
    pattern: {
      current: () => patternPanel.current(),
      apply: (d, label) => {
        editor.patternOpen = true;
        editor.changed();
        patternPanel.use(d.id, d.v, d.seed);
        // Several sheets or shapes picked: the pattern is made on each of them (one undo step each), the panel holding its settings
        const g = generatorById(d.id);
        if (!g || makePatternEach(doc, editor, view, g, cleanValues(g, d.v), d.seed) === null) editor.message = `Pattern style “${label}”.`;
        editor.changed();
      },
    },
    text: {
      count: () => [...editor.selection].filter((id) => doc.get(id)?.kind === "text").length,
      current: () => {
        const l = selectedTextStyle(doc, editor, textPpu);
        return l ? styleOf(l) : null;
      },
      apply: (look, label) => {
        setTextStyle(doc, editor, { gradient: null, outline: null, caps: null, maxLines: null, kerning: false, features: [], axes: null, ...look }, textPpu); // (a style without a gradient or an outline takes them away)
        editor.message = `Applied the text style “${label}”.`;
        editor.changed();
      },
    },
    adjustment: {
      can: () => !!selectedAdjust(doc, editor),
      apply: (s) => commitAdjust(doc, editor, s.data as Adjust, `Apply the adjustment “${s.name}”`, s.id),
      current: () => selectedAdjust(doc, editor)?.adjust ?? null,
    },
    paint: {
      count: () => paintTargetCount(doc, editor),
      apply: (paint, label, target, ask, styleId) =>
        void (async () => {
          let where: "fill" | "stroke" | "both" = target;
          const n = paintTargetCount(doc, editor);
          if (ask && n > 1) {
            const all = [
              { value: "fill", label: "Fill", help: "The inside of each shape" },
              { value: "stroke", label: "Outline", help: "The line round each shape" },
              { value: "both", label: "Fill and outline", help: "Both parts" },
            ];
            const choice = await chooseDialog({
              title: `Apply “${label}” to ${n} shapes`,
              lines: ["Which part of the selected shapes should take it?"],
              choices: [...all.filter((c) => c.value === target), ...all.filter((c) => c.value !== target)],
              confirmLabel: "Apply",
            });
            if (!choice) return;
            where = choice as typeof where;
          }
          const link = styleId === undefined ? undefined : where === "both" ? { fill: styleId, stroke: styleId } : where === "stroke" ? { stroke: styleId } : { fill: styleId };
          commitPaint(doc, editor, where === "both" ? { fill: paint, stroke: paint } : where === "stroke" ? { stroke: paint } : { fill: paint }, link);
        })(),
    },
    map: { count: () => pictureCount(doc, editor), apply: (stops, label) => applyGradientMap(doc, editor, stops, `Gradient map “${label}”`) },
    selectionColours: () => selectionColours(doc, editor),
    picturePalette: async () => {
      const pics = pickedFiles(doc, editor);
      const src = pics.length === 1 ? assets.get(rasterKey(pics[0]!)) : null;
      if (!src) return null;
      const c = document.createElement("canvas");
      const k = Math.min(1, 96 / Math.max(src.pixelW, src.pixelH));
      c.width = Math.max(1, Math.round(src.pixelW * k));
      c.height = Math.max(1, Math.round(src.pixelH * k));
      const x = c.getContext("2d");
      if (!x) return null;
      x.drawImage(src.source, 0, 0, c.width, c.height);
      return extractPalette(x.getImageData(0, 0, c.width, c.height).data, 6);
    },
    notify: (text) => {
      editor.message = text;
      editor.changed();
    },
  });
  const tagsPanel = mountTagsPanel(side, editor, doc, {
    tag: (ids, change) => void tagObjects(doc, editor, ids, change),
    renameTag: (from, to) => void session.changeCanvasTag(from, to),
    deleteTag: (tag) =>
      void confirmDialog({
        title: `Delete the tag “${tag}” from every canvas?`,
        lines: ["The items stay. On this canvas Undo brings it back; on the other canvases it cannot be undone."],
        confirmLabel: "Delete tag",
      }).then((ok) => (ok ? session.changeCanvasTag(tag, null) : 0)),
  });
  const adjustStylesApi = () => ({
      gradients: () => session.styles.of("gradient").map((s) => ({ name: s.name, stops: (s.data as Gradient).stops })),
      save: async (name: string, a: Adjust) => {
        if (!(await session.styles.add("adjustment", name, a))) {
          editor.message = session.readOnly ? readOnlyLine() : "Nothing to save: no adjustment is set.";
          editor.changed();
        }
      },
  });
  // Every floating panel lives in the dock (ADR 0123): stacked on a side, or floating, folded by its title bar.
  const panelEl = (testid: string): HTMLElement => side.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!;
  dock.add(panelEl("layers-panel"), { id: "layers", title: "Layers", side: "right" });
  side.append(notePanelEl);
  dock.add(notePanelEl, { id: "note", title: "File", side: "float", width: 760, ownWidth: true, maxWidth: 1400, noFold: true });
  dock.add(panelEl("bookmarks-panel"), { id: "bookmarks", title: "Bookmarks", side: "left" });
  dock.add(panelEl("styles-panel"), { id: "styles", title: "Styles", side: "left" });
  dock.add(panelEl("tags-panel"), { id: "tags", title: "Tags", side: "left" });
  mountAdjustPanel(side, editor, {
    selectedAdjust: () => selectedAdjust(doc, editor),
    previewAdjust: (a) => previewAdjust(doc, editor, a),
    commitAdjust: (a, label) => commitAdjust(doc, editor, a, label),
    adjustStyles: adjustStylesApi,
  });
  dock.add(panelEl("adjust-panel"), { id: "adjust", title: "Adjust", side: "right" });
  const patternSession = newPatternSession();
  const patternPanel = mountPatternPanel(side, editor, {
    make: (g, values, seed) => (makePatternEach(doc, editor, view, g, values, seed) === null ? makePattern(doc, editor, view, patternSession, g, values, seed) : false),
    box: () => patternBox(doc, editor, patternSession),
    tab: () => settings.get("ui.patternTab"),
    setTab: (t) => settings.set("ui.patternTab", t),
    history: (forward) => (forward ? redo : undo)(doc, editor),
    live: () => (patternSession.top !== null && doc.lastTransaction === patternSession.top) || foundPattern(doc, editor) !== null || sessionPattern(doc, editor, patternSession) !== null,
    found: () => { const f = foundPattern(doc, editor)?.info ?? sessionPattern(doc, editor, patternSession); return f ? { id: f.id, gid: f.gid, seed: f.seed, v: f.v } : null; },
    end: () => { patternSession.top = null; patternSession.sheet = null; patternSession.gid = null; },
    target: () => patternTargetLabel(doc, editor, patternSession),
    hasTarget: () => patternTargetLabel(doc, editor, patternSession) !== "A new sheet" && patternTargets(doc, editor).length < 2,
    saveStyle: (g, values, seed) => {
      void session.styles.add("pattern", "", { id: g.id, seed, v: values }).then((made) => {
        editor.message = made ? `Saved the pattern style “${made.name}”. It is in the Styles panel.` : session.readOnly ? readOnlyLine() : "The pattern could not be saved as a style.";
        editor.changed();
      });
    },
  });
  dock.add(panelEl("pattern-panel"), { id: "pattern", title: "Pattern", side: "right" });
  const balloonPanel = mountBalloonPanel(side, editor, {
    selected: () => selectedBalloon(doc, editor),
    change: (f, final) => {
      commitShape(doc, editor, { balloon: f }, final);
      const cur = final ? selectedBalloon(doc, editor) : null;
      if (cur) {
        const look = balloonLook(cur.spec);
        rememberBalloonLook(look);
        settings.set("balloon.look", JSON.stringify(look));
      }
    },
    saveStyle: () => {
      const look = balloonStyle(doc, editor);
      if (look) void session.styles.add("balloon", "", look).then((made) => {
        editor.message = made ? `Saved the balloon style “${made.name}”. It is in the Styles panel.` : "The balloon could not be saved as a style.";
        editor.changed();
      });
    },
    text: () => selectedShapeText(doc, editor),
    setText: (look, final) => setShapeText(doc, editor, look, final),
    link: () => selectedLink(doc, editor),
    setLink: (p) => setBalloonLink(doc, editor, p),
    canConnect: () => canConnectBalloons(doc, editor),
    connect: () => connectBalloons(doc, editor),
    toPath: () => {
      void confirmDialog({ title: "Convert to path?", lines: ["The balloon becomes an ordinary path: its nodes can be edited, and its body, tails and connectors can no longer be set."], confirmLabel: "Convert" }).then((yes) => { if (yes) balloonsToPaths(doc, editor); });
    },
  });
  try {
    rememberBalloonLook(validLook(JSON.parse(settings.get("balloon.look") || "null")));
  } catch { /* (an old or broken value: the usual balloon) */ }
  dock.add(panelEl("balloon-panel"), { id: "balloon", title: "Speech balloon", side: "right" });
const runLayout = async (cmd: LayoutCommand): Promise<void> => {
    // Sorting by name needs the file names of the selected images (the document only has their hashes).
    const names = new Map<string, { name: string; date: number }>();
    if ("grid" in cmd && (cmd.grid.startsWith("name") || cmd.grid === "date") && session.catalog) {
      for (const o of doc.ordered()) {
        if (o.kind !== "image" || !editor.selection.has(o.id) || names.has(o.assetId)) continue;
        const e = await session.catalog.entry(o.assetId).catch(() => undefined);
        names.set(o.assetId, { name: e?.name ?? "", date: e?.importedAt ?? 0 });
      }
    }
    // The grid is laid out with the chosen space between items; the last grid is kept so a new spacing can lay it out again.
    const full: LayoutCommand = "grid" in cmd ? { grid: cmd.grid, gap: settings.get("arrange.gap") } : cmd;
    if ("grid" in full) lastGrid = { cmd: full, ids: [...editor.selection].sort().join() };
    layoutSelection(doc, editor, full, names);
  };
  let lastGrid: { cmd: Extract<LayoutCommand, { grid: unknown }>; ids: string } | null = null;
  const hintLine = { current: null as null | { refresh(): void } };
  mountToolbar(document.getElementById("toolbar")!, editor, doc, {
    importFiles,
    openSearch: (prefix) => canvasSearch.open(prefix),
    screenshot: () => void takeScreenshot(),
    undo: () => undo(doc, editor),
    redo: () => redo(doc, editor),
    clearFlag: (flag) => clearFlag(doc, editor, flag),
    depth: () => depthOf(view.frameCamera),
    setSelectedWidth: (px, final = true) => {
      // Width in the stroke's own units: screen px / (screen px per local unit). Strokes and paths out of double range are skipped.
      const next = visibleObjects(doc, index, null, view.frameCamera, view.viewport).flatMap((po): CanvasObject[] => {
        const ppu = po.cover ? 0 : po.proj.ppu;
        if (!((po.obj.kind === "stroke" || po.obj.kind === "path" || po.obj.kind === "image") && editor.selection.has(po.obj.id) && !po.obj.locked && ppu > 0 && ppu < Infinity)) return [];
        // A picture's outline works as a shape's: 0 takes it away (the width is kept), a width turns one on (white, as a first outline).
        if (po.obj.kind === "image") {
          const { stroke: _s, ...bare } = po.obj;
          return px > 0 ? [{ ...bare, stroke: po.obj.stroke ?? "#ffffff", width: px / ppu }] : po.obj.stroke === undefined ? [] : [bare];
        }
        // A shape's outline of 0 is no outline (its width is kept for when it is turned on again); a width on one without an outline turns one on.
        if (po.obj.kind === "path") return px > 0 ? [{ ...po.obj, width: px / ppu, ...(po.obj.stroke === null ? { stroke: newInk("#1f2329") } : {}) }] : po.obj.stroke === null ? [] : [{ ...po.obj, stroke: null }];
        return px > 0 ? [{ ...po.obj, width: px / ppu }] : [];
      });
      if (!final) return showReplaced(editor, next);
      editor.preview = { kind: "none" };
      if (next.length) doc.commit(doc.transaction(next.length === 1 ? "Line thickness" : `Thickness of ${next.length} lines`, next));
      editor.changed();
    },
    selectedPaint: () => selectedPaint(doc, editor),
    selectedOutline: () => {
      const o = selectedOutline(doc, editor);
      if (!o) return null;
      const first = [...editor.selection].map((id) => doc.get(id)).find((x) => x?.kind === "path" || x?.kind === "image") as PathObject | ImageObject | undefined;
      const po = first && visibleObjects(doc, index, null, view.frameCamera, view.viewport).find((p) => p.obj.id === first.id);
      const ppu = po && !po.cover ? po.proj.ppu : 0;
      // No outline reads 0 (what typing 0 does), not the width kept for when one is turned on.
      const wLocal = first?.kind === "image" ? (first.stroke === undefined ? 0 : (first.width ?? 0)) : first && (first.stroke === null ? 0 : first.width);
      return { ...o, widthPx: ppu > 0 && ppu < Infinity && wLocal !== undefined ? wLocal * ppu : null };
    },
    outlineSelected: (patch) => commitOutline(doc, editor, patch),
    selectedDashNumbers: () => selectedDashNumbers(doc, editor),
    setDashNumbers: (n) => commitDashNumbers(doc, editor, n),
    paintMask: (ink) => paintMask(editor, ink),
    selectedMiterAngle: () => selectedMiterAngle(doc, editor),
    setMiterAngle: (deg) => commitMiterAngle(doc, editor, deg),
    selectedArrows: () => selectedArrows(doc, editor),
    setArrows: (patch) => commitArrows(doc, editor, patch),
    selectionPaints: () => selectionPaints(doc, editor),
    recolourSelected: (from, to, final) => recolour(doc, editor, from, to, final),
    hasBalloon: () => selectedBalloon(doc, editor) !== null || selectedShapeText(doc, editor) !== null || selectedLink(doc, editor) !== null,
    toggleBalloonPanel: () => balloonPanel.toggle(),
    selectedPin: () => selectedPin(doc, editor),
    fonts: libraryFonts,
    importFont: async (file) => {
      const why = await whyNotFont(new Uint8Array(await file.arrayBuffer()));
      if (why) {
        editor.message = `Could not use “${file.name}”: ${why}`;
        editor.changed();
        return null;
      }
      const { record } = await assets.importFileDetailed(file, false);
      await fontLoader.ensure(record.hash);
      return record.hash;
    },
    selectedTextStyle: () => (textEditor.isOpen ? textEditor.look() : editor.tool === "text" ? toolLook(editor.textLook, newInk(editor.penColor)) : selectedTextStyle(doc, editor, textPpu)),
    setTextStyle: (look, final = true) => {
      if (editor.tool === "text") editor.textLook = { ...editor.textLook, ...look };
      if (textEditor.isOpen) textEditor.restyle(look);
      else if (editor.tool !== "text") setTextStyle(doc, editor, look, textPpu, final);
      else editor.changed();
    },
    setPin: (patch) => setPin(doc, editor, patch as { h?: "left"; v?: "top" }),
    sheetRatio: () => sheetRatio(doc, editor),
    customRatios: () => session.styles.of(RATIO_KIND.id).map((c) => ({ name: c.name, ratio: c.data as number })),
    saveRatio: () => void saveCustomRatio(),
    manageRatios: () => {
      editor.stylesTab = RATIO_KIND.id;
      editor.stylesOpen = true;
      editor.changed();
    },
    ratioOfSheet: () => ratioOfSheet(doc, editor),
    setSheetRatio: (r, final) => setSheetRatio(doc, editor, r, final),
    boxOnSheet: () => boxOnSheet(doc, editor),
    moveOnSheet: (x, y, final) => moveOnSheet(doc, editor, x, y, final),
    resizeOnSheet: (w, h, final) => resizeOnSheet(doc, editor, w, h, final),
    sheetScale: () => sheetScalesContents(doc, editor),
    setSheetScale: (on) => setSheetScale(doc, editor, on),
    croppable: () => croppablePicture(doc, editor) !== null,
    cropped: () => isCropped(doc, editor),
    uncrop: () => uncropPicture(doc, editor),
    selectedFlip: () => selectedFlip(doc, editor),
    flip: (axis) => flipPictures(doc, editor, axis),
    unflip: () => unflipPictures(doc, editor),
    selectedAdjust: () => selectedAdjust(doc, editor),
    adjustStyles: adjustStylesApi,
    previewAdjust: (a) => previewAdjust(doc, editor, a),
    commitAdjust: (a, label) => commitAdjust(doc, editor, a, label),
    copyAdjust: () => void copyAdjustments(doc, editor),
    pasteAdjust: () => pasteAdjustments(doc, editor),
    canPasteAdjust: () => canPasteAdjustments(),
    copyRendered: () => void copyAsShown(),
    bake: () => void bakePicture(doc, editor, filesAssets, (shot) => storeFrame(assets, session, settings, shot)),
    selectedShape: () => {
      const o = selectedShape(doc, editor);
      return o ? { shape: o.shape, sides: o.sides, tips: o.tips, inner: o.inner } : null;
    },
    shapeSelected: (change, final = true) => commitShape(doc, editor, change, final),
    selectedSmoothing: () => selectedSmoothing(doc, editor),
    setSmoothing: (pct, final = true) => commitSmoothing(doc, editor, pct, final),
    selectedCorners: () => {
      const o = selectedCorners(doc, editor);
      if (!o) return null;
      const po = visibleObjects(doc, index, null, view.frameCamera, view.viewport).find((p) => p.obj.id === o.id);
      const ppu = po && !po.cover ? po.proj.ppu : 0;
      if (!(ppu > 0 && ppu < Infinity)) return { radiusPx: [0], nodes: o.nodes, mixed: false };
      return { radiusPx: typeof o.radius === "number" ? [o.radius * ppu] : o.radius.map((v) => v * ppu), nodes: o.nodes, mixed: o.mixed };
    },
    cornersSelected: (px, final = true) => {
      const visible = visibleObjects(doc, index, null, view.frameCamera, view.viewport);
      commitCorners(doc, editor, px, (id) => {
        const po = visible.find((p) => p.obj.id === id);
        return po && !po.cover ? po.proj.ppu : 0;
      }, final);
    },
    paintSelected: (patch, final) => (final ? commitPaint(doc, editor, patch) : previewPaint(doc, editor, patch)),
  });
  // File something just saved in the library in the folder and with the tags the settings give for its kind (what is saved from the canvas has its own).
  const fileInLibraryAs = (hash: string, kind: "export" | "pattern" | "svg"): Promise<string> =>
    fileInLibrary(session, hash, settings.get(`${kind}.folder`).trim(), shotTags({ screenshot: false, board: false, canvas: false, items: false, custom: settings.get(`${kind}.tags`) }, "", "", []));
  /** Whether these objects include a pattern made by the Pattern panel (its shapes keep how it was made). */
  const holdsPattern = (ids: Iterable<string>): boolean => [...ids].some((id) => doc.get(id)?.gen !== undefined);
  // Export… (ui/export-dialog.ts, ADR 0147): the picked sheet, picture or shapes as a picture file whose size is chosen there, from its shape.
  /** How big a target is on screen now, in CSS px: from an object of it in its frame, as the renderer projects it. */
  const screenSizeOf = (t: ExportTarget): { w: number; h: number } | null => {
    const po = visibleObjects(doc, index, null, view.frameCamera, view.viewport).find((p) => t.ids.has(p.obj.id) && (p.obj.frame ?? doc.space.world) === t.frame && !p.cover);
    if (!po || !(po.proj.ppu > 0)) return null;
    const w = D.toNumber(D.shift(D.sub(t.max.x, t.min.x), -po.obj.unit)) * po.proj.ppu;
    return Number.isFinite(w) && w > 0 ? { w, h: w / t.ratio } : null;
  };
  /** The canvas's background as #rrggbb, whatever notation the theme writes it in. */
  const canvasHex = (): string => {
    const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    c.fillStyle = theme.background;
    c.fillRect(0, 0, 1, 1);
    const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v!.toString(16).padStart(2, "0")).join("")}`;
  };
  const openExport = (again = false): void => {
    const targets = exportTargets(doc, editor);
    if (!targets.length || appView !== "canvas") {
      editor.message = "Select a sheet, a picture or some shapes to export.";
      editor.changed();
      return;
    }
    const each = targets.length === 1 && !again ? exportEachTargets(doc, editor) : [];
    (again ? exportAgain : openExportDialog)({
      screenSize: screenSizeOf,
      canvasColour: canvasHex,
      pickColour: (anchor, value, onInput) => openColourPopover(anchor, { name: "Background", value, onInput }),
      presets: {
        list: () => session.styles.of(EXPORT_KIND.id).map((s) => ({ id: s.id, name: s.name, data: s.data as ExportPreset })),
        save: async (data) => {
          const name = await promptDialog({ title: "Name the export preset", lines: [exportPresetSummary(data)], value: "", confirmLabel: "Save" });
          if (name === null) return null;
          const made = await session.styles.add(EXPORT_KIND.id, name, data);
          return made && { id: made.id, name: made.name };
        },
        update: (id, data) => session.styles.update(id, data),
        manage: () => {
          editor.stylesTab = EXPORT_KIND.id;
          editor.stylesOpen = true;
          editor.changed();
        },
      },
      targets,
      ...(each.length ? { each } : {}),
      render: (t, w, h, bg) => renderExport({ doc, index, assets: filesAssets, theme }, t, w, h, bg),
      svg: (t, size) => svgOfTarget(doc, t, size),
      svgWarning: (ts) => svgWarningOfTargets(ts),
      pdfVector: (t, wPt, hPt) => pdfVectorOfTarget(doc, t, wPt, hPt),
      say: (text) => { editor.message = text; editor.changed(); },
      toLibrary: async (file, targets) => {
        if (!session.catalog) throw new Error("the library is not available in this tab");
        const { record } = await assets.importFileDetailed(file, false);
        const where = await fileInLibraryAs(record.hash, targets.some((t) => holdsPattern(t.ids)) ? "pattern" : "export");
        editor.message = `Exported “${file.name}” in ${where}.`;
        editor.messageAction = { label: "View", run: () => { setView("assets"); void assetsView.reveal([record.hash]); } };
        editor.changed();
      },
    });
  };
  // The dice (interaction/random-view.ts): the camera goes to a random place and zoom with nothing of the canvas near.
  const goRandomView = (): void => {
    const fc = randomEmptyView(doc.space, viewIsEmpty(index, view.viewport));
    if (fc) view.flyTo(fc);
    else {
      editor.message = "No empty view turned up: the canvas fills every place the dice may choose.";
      editor.changed();
    }
  };
  // Screenshot (ADR 0080): what the canvas shows, without the selection outlines, saved to the library with the name, folder and tags of Settings > Screenshot.
  const takeScreenshot = async (): Promise<void> => {
    if (appView !== "canvas") return;
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
          crop.width = Math.round((x1 - x0) * dpr);
          crop.height = Math.round((y1 - y0) * dpr);
          crop.getContext("2d")!.drawImage(pic, Math.round(x0 * dpr), Math.round(y0 * dpr), crop.width, crop.height, 0, 0, crop.width, crop.height);
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
      const tree = session.tree;
      const cur = session.current;
      const boardRec = tree?.boards.find((b) => b.board.id === cur?.boardId);
      const canvasRec = boardRec?.canvases.find((c) => c.id === cur?.canvasId);
      const board = boardRec?.board.name ?? "board";
      const canvasName = canvasRec?.name ?? "canvas";
      const fileName = `${shotFileName(cfg.name, { workspace: tree?.workspace.displayName ?? "workspace", board, canvas: canvasName, at: new Date() }, cfg.style)}.${SHOT_FORMATS[format].ext}`;
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
      editor.messageAction = { label: "View", run: () => { setView("assets"); void assetsView.reveal([record.hash]); } };
      editor.changed();
    } catch (e) {
      editor.message = `Could not save the screenshot: ${(e as Error).message}`;
      editor.changed();
    }
  };

  // Texture fills (ADR 0154): the chooser's Image and Objects take their source from the canvas or a file.
  setTextureHooks(createTextureHooks({
    editor,
    host: textureHost,
    nameOf: (hash) => assetNames.get(hash),
    libraryPictures: async () => {
      const list = await session.catalog?.list().catch(() => undefined);
      return (list?.entries ?? [])
        .filter((e) => e.type.startsWith("image/") && !e.card && e.present && !e.hidden)
        .sort((a, b) => b.importedAt - a.importedAt)
        .map((e) => ({ hash: e.hash, name: e.name, thumb: async () => (await session.catalog?.thumb(e.hash).catch(() => undefined))?.blob }));
    },
    say: (text) => { editor.message = text; editor.changed(); },
    importPicture: async (file) => {
      try {
        const { record } = await assets.importFileDetailed(file, false);
        if (!record.type.startsWith("image/") || record.card) {
          editor.message = "That file is not a picture.";
          editor.changed();
          return null;
        }
        if (session.catalog) await fileInLibrary(session, record.hash, "Fills", ["fill"]);
        return record.hash;
      } catch (err) {
        editor.message = `Could not take that picture: ${err instanceof Error ? err.message : String(err)}`;
        editor.changed();
        return null;
      }
    },
  }));
  setColourStyles({
    gradients: () => session.styles.of("gradient").map((s) => ({ name: s.name, gradient: s.data as Gradient })),
    saveGradient: (g) => session.styles.add("gradient", "", g).then((made) => { if (made) { editor.message = "Saved the gradient to the Styles."; editor.changed(); } }),
    showGradients: () => {
      editor.stylesTab = "gradient";
      editor.stylesOpen = true;
      editor.changed();
    },
    colours: () => session.styles.of("colour").map((s) => String(s.data)),
    save: (hex) => session.styles.add("colour", "", hex).then((made) => { if (made) { editor.message = `Saved ${hex.toUpperCase()} to the Styles of the library.`; editor.changed(); } }),
  });
  const history = new CameraHistory(view);
  // A bookmark of the picked things: the view that brings them into the window, saved while the camera stays where it is; its picture follows.
  const bookmarkPicked = (): void => {
    if (!editor.selection.size) return;
    const before = view.frameCamera;
    focusObjects(doc, view, [...editor.selection], true);
    const saved = bookmarkList.add();
    view.setFrameCamera(before);
    void saved.then((b) => {
      if (!b) return void (editor.message = "The bookmark limit is reached.", editor.changed());
      void refreshThumbs([b.id]);
    });
  };
  // Fresh pictures for the bookmarks (ADR 0124): the canvas visits each place, one at a time, and comes back.
  let thumbsRunning = false;
  const refreshThumbs = async (ids?: readonly string[]): Promise<void> => {
    const list = ids ? bookmarkList.items.filter((b) => ids.includes(b.id)) : bookmarkList.items;
    if (thumbsRunning || !list.length || appView !== "canvas") return;
    thumbsRunning = true;
    const revealed = assets.revealing; // (the bookmarks' pictures are kept in the canvas files: drawn with padlocks)
    if (revealed) (assets.revealing = false), tiles.clear();
    try {
      await updateThumbs({
        bookmarks: list,
        space: doc.space,
        canvas,
        getCamera: () => view.frameCamera,
        setCamera: (fc) => view.setFrameCamera(fc),
        renderClean: () => void renderNow({ pattern: true, overlays: false, transparent: false }),
        assetsIdle: () => {
          const q = assets.decodeLoad();
          return q.running + q.queued === 0;
        },
        hold: (on) => history.hold(on),
        save: (thumbs) => bookmarkList.setThumbs(thumbs),
        say: (text) => {
          editor.message = text;
          editor.changed();
        },
        redraw: () => invalidate(),
      });
    } finally {
      thumbsRunning = false;
      if (revealed) (assets.revealing = true), tiles.clear(), invalidate(), syncReveal();
    }
  };
  editor.subscribe(() => {
    if (editor.cropId && !(editor.selection.size === 1 && editor.selection.has(editor.cropId))) editor.cropId = null; // (cropping ends when the picture is let go)
    document.body.classList.toggle("is-cropping", editor.cropId !== null); // (the floating bars and panels step aside, ADR 0118)
  });
  mountHud(document.getElementById("hud")!, view, stats, debug, {
    fit: (kind) => focusCycle.fit(kind),
    canCameraBack: () => history.canBack(),
    canCameraForward: () => history.canForward(),
    cameraBack: () => history.back(),
    cameraForward: () => history.forward(),
    subscribeCamera: (fn) => history.subscribe(fn),
    hasSelection: () => editor.selection.size > 0,
    toggleZen: () => void settings.set("ui.zen", !settings.get("ui.zen")),
    randomView: () => goRandomView(),
    subscribeSelection: (fn) => void editor.subscribe(fn),
    saveText: () => SAVE_TEXT[persistence.state] + (persistence.state === "error" && persistence.lastError ? ` (${persistence.lastError})` : ""),
    saveState: () => persistence.state,
    subscribe: (fn) => void persistence.subscribe(fn),
    itemNames: () => settings.get("ui.names"),
    setItemNames: (m) => void settings.set("ui.names", m),
    subscribeItemNames: (fn) => void settings.subscribe((key) => key === "ui.names" && fn()),
    pattern: () => settings.get("ui.pattern"),
    setPattern: (p) => void settings.set("ui.pattern", p),
    subscribePattern: (fn) => void settings.subscribe((key) => key === "ui.pattern" && fn()),
    background: () => settings.get("ui.background"),
    setBackground: (hex) => void settings.set("ui.background", hex),
    subscribeBackground: (fn) => void settings.subscribe((key) => key === "ui.background" && fn()),
    infoMode: () => settings.get("ui.info"),
    setInfoMode: (m) => void settings.set("ui.info", m),
    subscribeInfo: (fn) => void settings.subscribe((key) => key === "ui.info" && fn()),
    scene: () => ({ objects: doc.size, drawn: stats.last?.visibleCount ?? 0, indexing: indexSync.building() }),
    quality: () => quality.level,
    diagnostics: () => {
      const mem = assets.stats();
      const q = assets.decodeLoad();
      const tileMem = tiles.memory();
      const heap = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory; // (Chromium and the desktop app only)
      const mib = (b: number): string => (b / 2 ** 20).toFixed(0);
      return [
        `objects ${doc.size.toLocaleString()} · drawn ${stats.last?.visibleCount.toLocaleString() ?? 0}${indexSync.building() ? " · indexing…" : ""}`,
        `decoded ${mem.count} images · ${mib(mem.bytes)} / ${mib(mem.budget)} MiB · decoding ${q.running} · waiting ${q.queued}`,
        `tiles ${tileMem.tiles} · ${mib(tileMem.bytes)} MiB · undo ${doc.historySteps} steps · ${mib(doc.historyBytes())} MiB${heap ? ` · JS ${mib(heap.usedJSHeapSize)} / ${mib(heap.jsHeapSizeLimit)} MiB` : ""}`,
      ];
    },
    notify: (message) => {
      editor.message = message;
      editor.changed();
    },
  });
  applyZen(); // the button beside Home exists now
  if (debug) mountDevPanel(document.getElementById("hud")!, view, doc, () => pruneSelection(doc, editor), (n) => notices.push(n));
  const markNav = mountNavigator(document.getElementById("workspace")!, session, () => setView("canvas"));
  const followButton = document.querySelector<HTMLButtonElement>('[data-testid="follow-host"]');
  if (followButton) followHost(view, session, canvas, followButton);

  /** Save the picked paths as an SVG picture in the library (the same file "Save as SVG" writes). */
  const saveSvgToLibrary = async (): Promise<void> => {
    const text = svgOfSelection(doc, editor);
    if (text === null) {
      editor.message = "These shapes cannot be put in one drawing (too far apart in size).";
      editor.changed();
      return;
    }
    try {
      const name = "canvast-shapes.svg";
      const { record } = await assets.importFileDetailed(new File([text], name, { type: "image/svg+xml" }), false);
      const where = await fileInLibraryAs(record.hash, holdsPattern([...editor.selection, ...descendantsOf(doc.all(), editor.selection)]) ? "pattern" : "svg");
      editor.message = `Saved “${name}” in ${where}.${svgWarningOfSelection(doc, editor) ? ` ${svgWarningOfSelection(doc, editor)}` : ""}`;
      editor.messageAction = { label: "View", run: () => { setView("assets"); void assetsView.reveal([record.hash]); } };
    } catch (e) {
      editor.message = `Could not save to the library: ${(e as Error).message}`;
    }
    editor.changed();
  };
  /** Shows what is in a file's view on one card (doc/model.ts `preview`): its width kept, its height following the new picture; one step of undo. */
  function cardActions(from: ImageObject): CardActions {
    return {
      startAt: from.preview ?? "",
      setPreview: (preview, size) => {
        const o = doc.get(from.id);
        if (o?.kind !== "image" || editor.blockEdit()) return;
        const { crop: _crop, preview: _was, ...rest } = o;
        doc.commit(doc.transaction("Card preview", [{ ...rest, ...(preview && { preview }), pixelW: size.w, pixelH: size.h, h: (o.w * size.h) / size.w }])); // (none: its first page or view)
        editor.changed();
      },
      placeViews: (items) => {
        const o = doc.get(from.id);
        if (o?.kind !== "image" || editor.blockEdit()) return;
        editor.select(placeCardViews(doc, o, items).map((c) => c.id));
        editor.changed();
      },
      placeLines: (svg, size) => {
        const o = doc.get(from.id);
        if (o?.kind === "image") placeLinesBeside(doc, editor, view, o, svg, size);
      },
    };
  }
  const fileKinds = new Map<string, { card: boolean; open: boolean; svg: boolean; note: boolean; view: boolean }>();
  // (what the library says of an asset, read once: until it is read, nothing)
  const fileKindOf = (hash: string): { card: boolean; open: boolean; svg: boolean; note: boolean; view: boolean } => {
    if (!fileKinds.has(hash)) {
      fileKinds.set(hash, { card: false, open: false, svg: false, note: false, view: false });
      void session.catalog?.entry(hash).then((e) => {
        if (!e) return;
        fileKinds.set(hash, { card: isCard(e), open: desktopBridge() ? !meta(e).hidden : fileActionsOf(e.name, e.type).canOpen, svg: e.type === "image/svg+xml", note: !!noteKindOf(e.name), view: !!viewKindNamed(e.name) });
        contextBar.update();
      });
    }
    return fileKinds.get(hash)!;
  };
  /** A note card's size when placed (Settings > Notes, Note card size); null for any other picture. */
  const noteWidth = (o: ImageObject): number | null => (fileKindOf(o.assetId).note ? settings.get("notes.cardWidth") : null);
  // The selection action bar follows the selection box (updated after each drawn frame).
  // Menus and pickers keep off the selected items.
  setMenuAvoid(() => {
    const b = editor.selectionBoxOnScreen;
    if (!b || editor.selection.size === 0 || appView !== "canvas") return null; // (the canvas's selection is not on the screen in another view)
    const xs = b.frame.corners.map((c) => c[0]);
    const ys = b.frame.corners.map((c) => c[1]);
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  });
  hintLine.current = mountHintLine(editor, doc, () => settings.get("ui.hints"));
  const contextBar = mountContextBar(
    host,
    editor,
    doc,
    {
      duplicate: () => duplicateSelection(doc, editor, view),
      outline: () => convertTextToPath(doc, editor),
      setOnPath: () => setTextOnPath(doc, editor),
      canSetOnPath: () => canSetOnPath(doc, editor),
      setInShape: () => setTextInShape(doc, editor),
      canSetInShape: () => canSetInShape(doc, editor),
      takeOffPath: () => takeTextOffPath(doc, editor),
      canTakeOffPath: () => canTakeOffPath(doc, editor),
      canOutline: () => canOutline(doc, editor),
      splitPaths: () => splitPaths(doc, editor),
      canSplitPaths: () => canSplitPaths(doc, editor),
      simplify: () => simplifySelection(doc, editor),
      canSimplify: () => canSimplify(doc, editor),
      strokeToPath: () => strokeToPath(doc, editor),
      outlineStroke: (profile) => outlineStroke(doc, editor, profile),
      setWidthProfile: (profile) => setWidthProfile(doc, editor, profile),
      makeNetwork: () => makeNetwork(doc, editor),
      releaseNetwork: () => releaseNetwork(doc, editor),
      canMakeNetwork: () => canMakeNetwork(doc, editor),
      canReleaseNetwork: () => canReleaseNetwork(doc, editor),
      divide: () => divide(doc, editor),
      shapeBuilder: () => startShapeBuilder(doc, editor),
      finishBuilder: (apply) => (editor.gapFill ? finishGapFill(editor) : finishShapeBuilder(doc, editor, apply)),
      canFillGaps: () => canFillGaps(doc, editor),
      fillGaps: () => fillAllGaps(doc, editor, view, settings.get("shape.gapClosePx")),
      fillGap: () => startGapFill(doc, editor, view, settings.get("shape.gapClosePx")),
      canDivide: () => canDivide(doc, editor),
      makeMask: (mode) => makeMask(doc, editor, mode),
      makeClippingMask: () => makeClippingMask(doc, editor),
      canMakeMask: () => canMakeMask(doc, editor),
      changeMask: (change) => changeMask(doc, editor, change),
      selectMask: () => selectTheMask(doc, editor),
      canReleaseMask: () => canReleaseMask(doc, editor),
      selectedMask: () => selectedMask(doc, editor),
      canOutlineStroke: () => canOutlineStroke(doc, editor),
      canStrokeToPath: () => canStrokeToPath(doc, editor),
      combine: (op) => combineSelection(doc, editor, op),
      booleanState: () => booleanSelection(doc, editor)?.op ?? null,
      groupJoin: () => groupJoinMode(doc, editor),
      addToGroup: () => addToBooleanGroup(doc, editor),
      takeOutOfGroup: () => takeOutOfBooleanGroup(doc, editor),
      releaseBoolean: () => {
        const b = booleanSelection(doc, editor);
        if (b) releaseBoolean(doc, editor, b.gid);
      },
      flattenBoolean: () => {
        const b = booleanSelection(doc, editor);
        if (b) flattenBoolean(doc, editor, b.gid);
      },
      canCombine: () => canCombine(doc, editor),
      resetRotation: () => void resetRotation(doc, editor),
      applyRotation: () => void applyRotation(doc, editor),
      resetProportions: () => void resetProportions(doc, editor),
      resettable: () => resettable(doc, editor),
      resetSize: () => void resetSize(doc, editor, view, noteWidth),
      canResetSize: () => sizeResets(doc, editor, view, noteWidth).length > 0,
      resetSizeBlock: () => sizeResetBlock(doc, editor, view),
      matchSize: (axis, pick) => matchSize(doc, editor, view, axis, pick),
      isPicture: (id) => doc.get(id)?.kind === "image",
      isSizable: (id) => { const o = doc.get(id); return !!o && sizable(o); },
      tag: () => {
        editor.tagsOpen = true;
        editor.changed();
        requestAnimationFrame(() => tagsPanel.focusAdd());
      },
      fileSelection: () => {
        const ids = [...editor.selection];
        const o = ids.length === 1 ? doc.get(ids[0]!) : undefined;
        if (o?.kind !== "image") return null;
        const k = fileKindOf(o.assetId);
        return k.card ? { hash: o.assetId, open: k.open, note: k.note, view: k.view } : null;
      },
      pictureTools: () => {
        const sa = selectedAdjust(doc, editor);
        return sa ? { still: sa.stills && [...editor.selection].some((id) => doc.get(id)?.kind === "image"), canPaste: canPasteAdjustments() } : null;
      },
      copyAdjust: () => void copyAdjustments(doc, editor),
      pasteAdjust: () => pasteAdjustments(doc, editor),
      copyRendered: () => void copyAsShown(),
      bake: () => void bakePicture(doc, editor, filesAssets, (shot) => storeFrame(assets, session, settings, shot)),
      svgPicture: () => {
        const ids = [...editor.selection];
        const o = ids.length === 1 ? doc.get(ids[0]!) : undefined;
        if (o?.kind !== "image") return false;
        void session.catalog?.entry(o.assetId).then((e) => {
          if (e && !fileKinds.get(o.assetId)?.svg && e.type === "image/svg+xml") {
            fileKinds.set(o.assetId, { card: isCard(e), open: fileActionsOf(e.name, e.type).canOpen, svg: true, note: false, view: false });
            contextBar.update();
          }
        });
        return fileKinds.get(o.assetId)?.svg === true;
      },
      vectorise: () => {
        const o = [...editor.selection].map((id) => doc.get(id)).find((x) => x?.kind === "image");
        if (o?.kind !== "image") return;
        void assets.record(o.assetId).then(async (rec) => {
          if (rec) importSvg(doc, editor, view, await rec.blob.text(), o); // (in the picture's place; the file stays in the library)
        });
      },
      canExportSvg: () => canExportSvg(doc, editor),
      saveSvgToLibrary: () => void saveSvgToLibrary(),
      initialState: () => initialShapeState(doc, editor),
      setInitialState: (onlyMissing) => setInitialShape(doc, editor, onlyMissing, settings.get("shape.initialPaint")),
      resetInitialState: () => resetToInitialShape(doc, editor),
      canExport: () => exportTarget(doc, editor) !== null,
      exportPicture: () => openExport(),
      canExportAgain: () => exportedBefore(exportTargets(doc, editor)),
      exportAgain: () => openExport(true),
      canDownload: () => pickedFiles(doc, editor).length > 0,
      downloadFile: () => void downloadSelection(doc, editor, assets, session, settings),
      canMakeNoteFiles: () => [...editor.selection].some((id) => { const o = doc.get(id); return o?.kind === "text" && !!o.card; }),
      makeNoteFiles: () => void makeNoteFiles(),
      editNote: () => {
        const o = doc.get([...editor.selection][0] ?? "");
        if (o?.kind === "image") void notePanel.open(o.assetId, cardActions(o));
      },
      openFile: () => {
        const o = [...editor.selection].map((id) => doc.get(id)).find((x) => x?.kind === "image");
        if (o?.kind !== "image") return;
        const desktop = desktopBridge();
        if (!desktop) return void openOriginalInTab(assets, o.assetId);
        // The desktop app: the file in the workspace folder, in the system's app for its kind.
        void (async () => {
          const file = await session.storage?.originals.fileOf(o.assetId).catch(() => null);
          const problem = file ? await desktop.openFile(file) : "its file is not in the workspace folder yet; try again in a moment";
          if (problem) {
            editor.message = `Could not open it: ${problem}.`;
            editor.changed();
          }
        })();
      },
      hasLibraryItems: () => [...editor.selection].some((id) => doc.get(id)?.kind === "image"),
      showInLibrary: () => {
        const hashes = [...new Set([...editor.selection].map((id) => doc.get(id)).flatMap((o) => (o?.kind === "image" ? [o.assetId] : [])))];
        if (!hashes.length) return;
        setView("assets");
        void assetsView.reveal(hashes);
      },
      group: () => groupSelection(doc, editor),
      putOnSheet: () => sheetSelection(doc, editor),
      canSheetEach: () => canSheetEach(doc, editor),
      sheetEach: () => sheetEach(doc, editor),
      fitSheet: () => fitSheet(doc, editor),
      canFitSheet: () => canFitSheet(doc, editor),
      attach: () => {
        editor.attachMode = !editor.attachMode;
        editor.changed();
      },
      detach: () => detachSelection(doc, editor),
      canDetach: () => canDetach(doc, editor),
      copyMarkdown: () => copySelectedMarkdown(),
      releaseSheet: () => releaseSheets(doc, editor),
      canReleaseSheet: () => [...editor.selection].some((id) => isContainer(doc.get(id))),
      ungroup: () => ungroupSelection(doc, editor),
      arrange: (to) => arrangeSelection(doc, editor, to),
      layout: (cmd) => void runLayout(cmd),
      gap: () => settings.get("arrange.gap"),
      setGap: (gap) => {
        settings.set("arrange.gap", gap);
        // Choosing another space right after arranging the same items lays them out again with it (one more undo step).
        if (lastGrid && lastGrid.ids === [...editor.selection].sort().join()) void runLayout({ grid: lastGrid.cmd.grid });
      },
      setFlag: (flag) => setFlag(doc, editor, flag),
      deleteSelection: () => deleteSelection(doc, editor),
    },
    () => appView !== "canvas" || textEditor.isOpen,
    () => settings.get("ui.actions"),
  );
  contextUpdate = contextBar.update;

  // The tools start where the view tabs and the workspace menu end (stylesheet: --nav-w).
  const navBox = document.getElementById("nav")!;
  const barBox = document.getElementById("toolbar")!;
  const measureNav = (): void => {
    const root = document.documentElement.style;
    root.setProperty("--nav-w", `${Math.ceil(navBox.getBoundingClientRect().right)}px`);
    // The tool options sit between the view tabs and the dock (history, panels, import) at the top right.
    const dock = barBox.querySelector<HTMLElement>(".dock")?.getBoundingClientRect();
    root.setProperty("--dock-w", `${Math.ceil(dock ? dock.width : 0)}px`);
    // Side panels start below the toolbar, however many rows it wraps to.
    const opts = barBox.querySelector<HTMLElement>(".toolbar");
    const bottoms = [navBox.getBoundingClientRect().bottom, dock?.bottom ?? 0, opts && !opts.hidden ? opts.getBoundingClientRect().bottom : 0];
    // On a phone the three bars stack in rows. Their places come from measured heights (never from a guessed row height), so the gap between
    // the rows is the same everywhere: the rows are positioned by these (stylesheet: --nav-bottom, --dock-h), and the bottom of the last row follows.
    const near = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--near")) || 6;
    const navBottom = navBox.getBoundingClientRect().bottom;
    const dockH = dock?.height ?? 0;
    root.setProperty("--nav-bottom", `${Math.ceil(navBottom)}px`);
    root.setProperty("--rail-right", `${Math.ceil(barBox.querySelector<HTMLElement>(".rail")?.getBoundingClientRect().right ?? 0)}px`);
    root.setProperty("--dock-h", `${Math.ceil(dockH)}px`);
    if (window.matchMedia("(max-width: 640px)").matches) {
      const optsH = barBox.getBoundingClientRect().height; // the whole column: the Properties bar and the rows under it (colours of the selection)
      bottoms.push(navBottom + near + dockH + (optsH ? near + optsH : 0));
      bottoms.splice(0, 3, bottoms[3]!); // the rows' own places are not final until the stylesheet has used the numbers above
    }
    root.setProperty("--bar-bottom", `${Math.ceil(Math.max(...bottoms))}px`);
    for (const el of [barBox.querySelector<HTMLElement>(".dock"), document.querySelector<HTMLElement>(".hud-controls")]) if (el) syncScroll(el);
    // The hint line takes all the room the bottom-right controls leave (it was given a fixed width that they outgrew).
    const hc = document.querySelector<HTMLElement>(".hud-controls");
    root.setProperty("--controls-w", `${Math.ceil(hc?.getBoundingClientRect().width ?? 0)}px`);
    const hudBottom = document.querySelector<HTMLElement>(".hud-bottom");
    root.setProperty("--hud-bottom-h", `${Math.ceil(hudBottom?.getBoundingClientRect().height ?? 0)}px`);
    if (hc && !watchedControls) {
      watchedControls = true;
      new ResizeObserver(measureNav).observe(hc);
      if (hudBottom) new ResizeObserver(measureNav).observe(hudBottom);
    }
  };
  let watchedControls = false;
  new ResizeObserver(measureNav).observe(navBox);
  new ResizeObserver(measureNav).observe(barBox);
  const dockEl = barBox.querySelector<HTMLElement>(".dock");
  if (dockEl) new ResizeObserver(measureNav).observe(dockEl);
  const railEl = barBox.querySelector<HTMLElement>(".rail");
  if (railEl) new ResizeObserver(measureNav).observe(railEl);
  const optsEl = barBox.querySelector<HTMLElement>(".toolbar");
  if (optsEl) new ResizeObserver(measureNav).observe(optsEl);
  window.addEventListener("resize", measureNav);
  const controlsEl = document.querySelector<HTMLElement>(".hud-controls");
  if (controlsEl) new ResizeObserver(measureNav).observe(controlsEl);
  measureNav();

  // Top-level views. The canvas keeps its camera, selection and history while hidden.
  const assetsRoot = document.getElementById("assets-view")!;
  const setView = (v: AppView): void => {
    if (v === appView) return;
    const was = appView;
    appView = v;
    document.body.dataset["view"] = v;
    markTab(v);
    markNav(v);
    host.inert = v !== "canvas";
    closeMoreMenu(); // (a menu opened on the canvas, e.g. the long-press list, does not follow to another view)
    if (was === "assets") assetsView.hide();
    if (was === "settings") settingsView.hide();
    if (v === "assets") assetsView.show();
    else if (v === "settings") settingsView.show();
    else {
      invalidate();
      canvas.focus();
    }
    // The Settings view is not remembered: a reload opens the canvas or the Assets view.
    if (v !== "settings") settings.set("ui.view", v);
  };
  const markTab = mountViewSwitch(document.getElementById("view-switch")!, setView);
  void followFrameSetting(settings);
  followScrolling();
  markTab("canvas");
  markNav("canvas");
  const assetsView = mountAssetsView(assetsRoot, session, assets, () => setView("canvas"), notices, settings, libraryFonts);
  // A font's card on a canvas: the viewer's sample sentence, on its ground (a ground that follows the theme is drawn again with it).
  const fontCardsLook = (): void => {
    setFontCardLook({ sample: session.fontSample, ground: session.viewGround });
    for (const [h, n] of assetNames.map) if (isFontFile({ type: "", name: n })) assets.forget(h);
    tiles.clear();
    invalidate();
  };
  session.onFontLook = fontCardsLook;
  fontCardsLook();
  settings.subscribe((key) => key === "ui.theme" && fontCardsLook());
  // A note's card on a canvas opens in the note panel (a double-click, Edit note): the same editor and saving as in the library.
  /** Into the library as a note, filed in the Notes folder (Settings > Notes): its record, or undefined. */
  const storeNote = async (file: File): Promise<AssetRecord | undefined> => {
    const [hash] = await assetsView.importFiles([file]);
    const rec = hash ? await assets.record(hash).catch(() => undefined) : undefined;
    if (rec) await fileInLibrary(session, rec.hash, settings.get("notes.folder"), []);
    return rec;
  };
  // The Note tool (M): a new markdown note, its card placed where the canvas was clicked (as wide as a box dragged), opened in the note panel.
  newNoteAt = async (at, widthPx = settings.get("notes.cardWidth")) => {
    if (editor.blockEdit() || !session.catalog) return;
    const rec = await storeNote(newNoteFile(newNoteName(session, settings)));
    if (!rec) return;
    const o = imageAt(rec, doc, view, at.x, at.y, widthPx, (widthPx * rec.pixelH) / rec.pixelW, doc.topZ() + 1);
    doc.commit(doc.transaction("New note", [o]));
    editor.select([o.id]);
    editor.changed();
    void notePanel.open(rec.hash);
  };
  // Note cards, whatever placed them and whenever: each is laid out at its own size (one stretched before keeps its look, on a page of that shape), and
  // with "Whole note" as tall as its note. No undo step: `remap` keeps the undo history in step, as for a new version of a file.
  const noteTexts = new Map<string, { name: string; text: string }>(); // (by hash, so what is read is the version's own)
  const otherAssets = new Set<string>();
  const pageHeights = new Map<string, number>();
  let notesSyncing = false;
  let notesAgain = false;
  let notesTimer = 0;
  const syncNoteCards = async (): Promise<void> => {
    if (notesSyncing) return void (notesAgain = true);
    if (session.readOnly || !session.catalog) return;
    notesSyncing = true;
    try {
      const whole = settings.get("notes.cardShows") === "whole";
      for (const o of [...doc.all()]) {
        if (o.kind !== "image" || o.media || otherAssets.has(o.assetId)) continue;
        if (!noteTexts.has(o.assetId)) {
          const e = await session.catalog.entry(o.assetId).catch(() => undefined);
          if (!e) continue; // (not listed yet, or gone: looked at again on the next pass)
          if (!noteKindOf(e.name) || tooBigForNote(e.name, e.size)) {
            otherAssets.add(o.assetId);
            continue;
          }
          const rec = await assets.record(o.assetId).catch(() => undefined);
          if (!rec) continue; // (a hidden note while locked)
          noteTexts.set(o.assetId, { name: e.name, text: await rec.blob.text() });
        }
        const key = `${o.assetId}|${o.pixelW}`;
        if (whole && !pageHeights.has(key)) {
          const n = noteTexts.get(o.assetId)!;
          pageHeights.set(key, Math.max(8, Math.ceil(((await notePageHeight(n.name, n.text, o.pixelW / CARD_SCALE, o.assetId)) * CARD_SCALE) / 8) * 8));
        }
      }
      let changed = false;
      doc.remap((o) => {
        if (o.kind !== "image" || !noteTexts.has(o.assetId)) return o;
        const pixelH = (whole && pageHeights.get(`${o.assetId}|${o.pixelW}`)) || (o.page ? o.pixelH : Math.max(8, Math.round((o.pixelW * o.h) / o.w / 8) * 8));
        if (o.page && pixelH === o.pixelH) return o;
        changed = true;
        const { crop: _crop, ...rest } = o; // shortcut: a turned card grows from its top left, not its middle; compensate if turned notes matter.
        return { ...rest, page: true, pixelH, h: (o.w / o.pixelW) * pixelH };
      });
      if (changed) editor.changed();
    } finally {
      notesSyncing = false;
      if (notesAgain) (notesAgain = false, wantNoteSync());
    }
  };
  const wantNoteSync = (): void => {
    clearTimeout(notesTimer);
    notesTimer = window.setTimeout(() => void (syncNoteCards(), syncOldPdfCards()), 120);
  };
  // A PDF imported before its pages were drawn has a card of the plain card's shape: its cards on a canvas take the shape of the first page. No undo step (as above).
  const pdfShapes = new Map<string, { w: number; h: number } | null>();
  let pdfSyncing = false;
  const syncOldPdfCards = async (): Promise<void> => {
    if (!session.catalog || session.readOnly || pdfSyncing) return;
    pdfSyncing = true;
    try {
      await syncPdfCardsNow();
    } finally {
      pdfSyncing = false;
    }
  };
  const syncPdfCardsNow = async (): Promise<void> => {
    if (!session.catalog) return;
    let changed = false;
    for (const o of [...doc.all()]) {
      if (o.kind !== "image" || o.preview || o.pixelW !== FILE_CARD_W || o.pixelH !== FILE_CARD_H) continue;
      if (!pdfShapes.has(o.assetId)) {
        const e = await session.catalog.entry(o.assetId).catch(() => undefined);
        if (!e) continue;
        const rec = isPdfFile(e) ? await assets.record(o.assetId).catch(() => undefined) : undefined;
        pdfShapes.set(o.assetId, rec ? await pdfCardShape(new Uint8Array(await rec.blob.arrayBuffer())) : null);
      }
      changed ||= !!pdfShapes.get(o.assetId);
    }
    if (!changed) return;
    doc.remap((o) => {
      const z = o.kind === "image" && !o.preview && o.pixelW === FILE_CARD_W && o.pixelH === FILE_CARD_H ? pdfShapes.get(o.assetId) : null;
      if (!z || o.kind !== "image") return o;
      const { crop: _crop, ...rest } = o;
      return { ...rest, preview: "1", pixelW: z.w, pixelH: z.h, h: (o.w * z.h) / z.w };
    });
    editor.changed();
  };
  doc.subscribe((_source, changed) => {
    if (!changed || [...changed].some((id) => doc.get(id)?.kind === "image")) wantNoteSync();
  });
  settings.subscribe((key) => {
    if (key === "notes.cardProps") pageHeights.clear(); // (labels take a line of the page)
    if (key === "notes.cardShows" || key === "notes.cardProps") wantNoteSync();
  });
  wantNoteSync();
  // Make note files: texts on a card (what the Note tool made before notes were files) become notes in the library, their cards in the same place, as wide.
  makeNoteFiles = async () => {
    const texts = [...editor.selection].map((id) => doc.get(id)).filter((o): o is TextObject => o?.kind === "text" && !!o.card);
    if (!texts.length || editor.blockEdit() || !session.catalog) return;
    const next: ImageObject[] = [];
    for (const t of texts) {
      const title = t.md.split("\n").find((l) => l.trim())?.replace(/^[#>*\-\s]+/, "").trim().slice(0, 60);
      const rec = await storeNote(new File([t.md.endsWith("\n") ? t.md : `${t.md}\n`], `${cleanFileName(title || "Note") || "Note"}.md`, { type: "text/markdown" }));
      if (!rec || doc.get(t.id) !== t) continue; // (changed meanwhile: left as it is)
      const { id, frame, anchor, unit, z, opacity, attachmentTargetId, rot, constraint, parent, groups, name, groupNames, blend, tags } = t;
      next.push({ ...{ id, frame, anchor, unit, z, opacity, attachmentTargetId, rot, constraint, parent, groups, name, groupNames, blend, tags }, kind: "image", assetId: rec.hash, w: t.w, h: (t.w * rec.pixelH) / rec.pixelW, pixelW: rec.pixelW, pixelH: rec.pixelH } as ImageObject);
    }
    if (!next.length) return;
    doc.commit(doc.transaction(next.length === 1 ? "Make a note file" : `Make ${plural(next.length, "note file")}`, next));
    editor.message = next.length === 1 ? "The note is a note file in the library now: double-click its card to edit it." : `${plural(next.length, "note")} ${be(next.length)} note files in the library now.`;
    editor.changed();
  };
  redrawNoteCards = () => {
    for (const [h, n] of assetNames.map) if (noteKindOf(n)) assets.forget(h);
    tiles.clear();
    invalidate();
    assetsView.redrawNotes();
  };
  // A property changed in the panel: the labels of the notes it touched, at once.
  session.onMetaChanged = async (items) => {
    if (!settings.get("notes.cardProps").trim()) return;
    const names = items.has("*") ? [] : await Promise.all([...items].map(async (h) => (await session.catalog?.entry(h).catch(() => undefined))?.name ?? ""));
    if (!items.has("*") && !names.some((n) => noteKindOf(n))) return;
    pageHeights.clear();
    redrawNoteCards();
    wantNoteSync();
  };
  notePanelReady({ session, assets, settings, fonts: libraryFonts, importFiles: (files) => assetsView.importFiles(files), showInLibrary: (h) => (setView("assets"), void assetsView.reveal([h])), hidden: hiddenModeOn });
  // Alt+Shift+Left and Alt+Shift+Right: previous and next view (ADR 0116), on the canvas. (Alt with an arrow alone pans, as ever.)
  window.addEventListener("keydown", (e) => {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    if (document.body.dataset["view"] !== "canvas" || typing(e.target) || (e.target as HTMLElement | null)?.closest?.("dialog")) return;
    e.preventDefault(); // (not the browser's Back and Forward)
    if (e.key === "ArrowLeft") history.back();
    else history.forward();
  });
  // Bookmark keys (Settings > Shortcuts): previous and next, and the first nine by number.
  window.addEventListener("keydown", (e) => {
    if (e.repeat || document.body.dataset["view"] !== "canvas" || typing(e.target) || (e.target as HTMLElement | null)?.closest?.("dialog")) return;
    const c = comboOfEvent(e);
    const n = c === "[" ? -1 : c === "]" ? 1 : /^Alt\+[1-9]$/.test(c ?? "") ? 0 : null;
    if (n === null) return;
    e.preventDefault();
    if (n === 0 ? bookmarkList.goTo(Number(c!.slice(4)) - 1) : bookmarkList.step(n)) return;
    editor.message = bookmarkList.items.length ? "That bookmark's place no longer exists." : "No bookmarks yet.";
    editor.changed();
  });
  // The Zen key (Settings > Shortcuts, Z at first) fades the floating bars and panels out and back, on the canvas.
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.key.toLowerCase() !== "z") return;
    if (document.body.dataset["view"] !== "canvas" || typing(e.target) || (e.target as HTMLElement | null)?.closest?.("dialog")) return;
    e.preventDefault();
    settings.set("ui.zen", !settings.get("ui.zen"));
  });
  // Ctrl+F searches what you are looking at (the canvas, or the library in the Assets view); Ctrl+Shift+F goes to the library's search
  // from anywhere. The browser's own find is not used for these.
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "f") return;
    if (document.querySelector("dialog[open]") || appView === "settings") return;
    e.preventDefault();
    if (e.shiftKey || appView === "assets") {
      setView("assets");
      assetsView.focusSearch();
    } else canvasSearch.open("");
  });
  // Tool buttons say which key picks them (the keys can be changed in Settings).
  const updateToolTitles = (): void => {
    for (const t of TOOL_ORDER) {
      const k = keymap.display(TOOL_COMMAND[t]);
      document.querySelector<HTMLElement>(`button[data-tool="${t}"]`)?.setAttribute("title", k ? `${TOOL_NAME[t]} (${k})` : TOOL_NAME[t]);
    }
  };
  updateToolTitles();
  // The buttons that name a key name the one in use now (Settings > Shortcuts): the words are fixed here, the keys are the keymap's.
  const updateKeyTitles = (): void => {
    const k = (id: string): string => keymap.display(id);
    const keyed = (text: string, id: string, more = ""): string => (k(id) ? `${text} (${k(id)}${more})` : text);
    const title = (action: string, text: string): void => document.querySelector<HTMLElement>(`[data-action="${action}"]`)?.setAttribute("title", text);
    title("undo", keyed("Undo", "edit.undo"));
    title("redo", keyed("Redo", "edit.redo"));
    title("search", `Search the canvas (${[k("find.canvas"), k("find.tag") && `${k("find.tag")} tag`, k("find.bookmark") && `${k("find.bookmark")} bookmark`].filter(Boolean).join("; ") || "no key"})`.replace(" (no key)", ""));
    title("zen", keyed("Zen mode: fade the bars and panels out; each shows while the pointer is over it", "view.zen"));
    title("zoom-out", keyed("Zoom out", "view.zoomOut"));
    title("zoom-in", keyed("Zoom in", "view.zoomIn"));
    title("cam-back", keyed("Previous view", "view.back"));
    title("cam-fwd", keyed("Next view", "view.forward"));
    title("fit-selection", keyed("Fit the selection in view", "view.focus"));
    title("fit-all", keyed("Fit everything visible at this zoom in view", "view.focus", " again"));
    title("home", keyed("Return to origin", "view.home"));
  };
  updateKeyTitles();
  keymap.subscribe(() => {
    updateToolTitles();
    updateKeyTitles();
  });
  document.documentElement.dataset["version"] = __CANVAST_VERSION__; // before Settings is built: its Develop tab shows it
  // The library index in the library folder follows the workspace by itself (ADR 0159): a change pokes it, it writes a little later.
  // (not in the desktop build: its workspace folder has library.json, so this browser-format index would be a stale copy)
  if (!storage?.workspaceFolder) session.autoIndex = installAutoIndex({
    enabled: () => settings.get("storage.autoIndex"),
    readOnly: () => session.readOnly,
    build: (scope, progress) => session.exportArchive(scope, progress),
    say: (text) => { editor.message = text; editor.changed(); },
  });
  session.subscribeAssets(() => session.autoIndex?.poke()); // (commits, imports, catalog changes)
  settings.subscribe(() => session.autoIndex?.poke());
  externalFolder.subscribe(() => session.autoIndex?.poke()); // (a folder was chosen or came back)
  const settingsView = mountSettingsView(document.getElementById("settings-view")!, settings, keymap, () => setView("canvas"), {
    last: async () => {
      const r = await session.lastBackup();
      return r ? { at: r.at, kind: r.kind ?? "full", fileName: r.fileName, bytes: r.bytes } : null;
    },
    exportFull: async () => void (await runExport(session, { kind: "workspace" })),
    exportChanges: () => runExportChanges(session),
    exportAdvanced: async () => void (await runAdvancedExport(session)),
    exportFiles: async () => void (await runExportFiles(session, { kind: "workspace" })),
    importFiles: (files) => runImport(session, files),
    readOnly: () => session.readOnly,
    saving: () => {
      const p = session.persistence;
      return {
        state: p.state,
        error: p.lastError ?? "",
        lastVerified: p.lastVerifiedAt ? `${new Date(p.lastVerifiedAt).toLocaleTimeString()}${p.lastCommit ? ` (revision ${p.revision}, ${p.lastCommit.puts} written, ${p.lastCommit.deletes} deleted)` : ""}` : "not yet",
        role: `${session.readOnly ? "read-only (another tab is editing)" : "editing (writer)"} · lease via ${session.lease.mechanism}`,
      };
    },
    onSaving: (fn) => void session.persistence.subscribe(fn),
    folder: (() => {
      let draw: (() => Promise<void>) | null = null;
      return (host: HTMLElement) => (draw ??= mountLibraryFolderCard(host, session))();
    })(),
    persist: async () => void (await navigator.storage?.persist?.().catch(() => false)),
    ...(storage?.folderSync
      ? {
          librarySplit: {
            get: () => storage.folderSync!.partSplit(),
            set: async (split: 1 | 2 | 3) => {
              const files = 16 ** split;
              const sure = await confirmDialog({
                title: `Split the library into ${files.toLocaleString()} files?`,
                lines: ["Every file of .canvast/library/ is written again once (a sync tool uploads them all once), and the old ones are removed. Nothing in the library changes.", "Update the app on every device that opens this workspace first: versions before 0.52.4 read only 256 files."],
                confirmLabel: "Split it",
                danger: false,
              });
              if (sure) await storage.folderSync!.setPartSplit(split);
              return sure;
            },
          },
        }
      : {}),
    password: async (kind, action) => {
      /** New key: asked for, then the files sealed again in the background, with its progress; what to say on the card. */
      const newHiddenKey = async (): Promise<string> => {
        const hidden = storage?.hidden;
        if (!hidden?.newKey) return "";
        if (session.readOnly) return "Another tab is editing, so the key cannot change here.";
        const go = await confirmDialog({
          title: "A new key for the hidden items?",
          lines: [
            "Every hidden file is encrypted again with a new key, one at a time, each checked before the old one goes. It takes about as long as hiding them did, and runs in the background; you can keep working.",
            "Afterwards, copies of .canvast/hidden.json from before (backups, a sync tool's history) and the old password with them open nothing. Make a new backup once it is done.",
            "Your password stays the same. Stopped half-way (the app closed), it goes on the next time the hidden items are opened.",
          ],
          confirmLabel: "Continue",
          danger: false,
        });
        if (!go) return "Not changed.";
        const password = await promptDialog({ title: "New key: your Hidden password", lines: ["The new key is locked with it."], value: "", confirmLabel: "Make a new key", secret: true });
        if (!password) return "Not changed.";
        const p = beginProgress(editor, "newkey", "Encrypting the hidden items with the new key");
        hidden.onSealAgain = (done, all) => {
          p.update(all ? done / all : null, `${done} of ${all}`);
          if (done === all) {
            hidden.onSealAgain = null;
            p.done("Every hidden item is encrypted with the new key.");
          }
        };
        try {
          if (!(await hidden.newKey(password))) {
            hidden.onSealAgain = null;
            p.fail("That is not the Hidden password, so nothing changed.");
            return "That is not the Hidden password, so nothing changed.";
          }
        } catch (e) {
          hidden.onSealAgain = null;
          p.fail(`No new key: ${(e as Error).message}`);
          return `No new key: ${(e as Error).message}`;
        }
        return "A new key is made: the hidden files are being encrypted with it (see the progress at the bottom).";
      };
      const what = kind === "workspace" ? "workspace" : "Hidden items";
      const state = async (note = "", only = false): Promise<{ has: boolean; text: string; open: boolean; rekey: boolean }> => {
        const has = await session.hasPassword(kind);
        return { has, open: kind === "hidden" && !!storage?.hidden?.isOpen(), rekey: kind === "hidden" && has && !!storage?.hidden?.newKey, text: only && note ? note : `${note ? `${note} ` : ""}${has ? "A password is set." : kind === "workspace" ? "No password is set: the app opens without asking." : "No password is set: anyone can open the Hidden items."}` };
      };
      if (action === "status") return state();
      if (action === "lock") return state((await lockHidden(session)) ? HIDDEN_LOCKED : "", true);
      if (action === "newkey") return state(await newHiddenKey(), true);
      if (session.readOnly) return state("Another tab is editing, so the password cannot change here.");
      const current = await askCurrentPassword(session, kind, "Enter the current password.");
      if (current === null) return state("Not changed.");
      if (kind === "hidden") forgetHiddenPassword();
      if (action === "remove") return (await session.setPassword(kind, null)) ? state("The password was removed.", true) : state();
      // (changing the Hidden password locks the same key again: older copies of hidden.json still open with the old one, as in other tools of this kind)
      const changing = kind === "hidden" && !!storage?.hidden && (await session.hasPassword("hidden"));
      const lines = ["It cannot be recovered. Keep it somewhere safe.", ...(changing ? ["Copies of .canvast/hidden.json from before (in backups, or a sync tool's history) still open your hidden items with the old password. Delete them, or use New key in Settings > Privacy afterwards: then they open nothing."] : [])];
      const first = await promptDialog({ title: `New password for the ${what}`, lines, value: "", confirmLabel: "Next", secret: true });
      if (!first) return state("Not changed.");
      const again = await promptDialog({ title: `New password for the ${what}`, lines: ["Type it again."], value: "", confirmLabel: "Set the password", secret: true });
      if (again !== first) return state("The two did not match, so nothing changed.");
      return (await session.setPassword(kind, first, current)) ? state("The password was set.", true) : state();
    },
    reset: async () => {
      if (session.storage?.workspaceFolder) {
        // The desktop build: the folder is the workspace; this only clears the working copy of this device and reads it again.
        const sure = await confirmDialog({ title: "Rebuild from the workspace folder?", lines: ["This device's working copy is cleared and the workspace is read again from its folder. Edits not in the folder yet are written to it first.", "Nothing in the folder is deleted, and your settings stay."], confirmLabel: "Rebuild", danger: false });
        if (!sure) return;
        const p = beginProgress(editor, "reset", "Rebuilding from the workspace folder");
        p.update(null, "the app reloads when it is done");
        await session.storage.resetAll().catch((e) => p.fail(`Could not rebuild: ${(e as Error).message}`));
        return;
      }
      const folderStore = session.storage?.libraryFolder ?? null;
      const tree = session.tree;
      const boards = tree?.boards.length ?? 0;
      const canvases = tree?.boards.reduce((n, b) => n + b.canvases.length, 0) ?? 0;
      const items = (await session.catalog?.list().catch(() => null))?.entries.length ?? 0;
      const est = await navigator.storage?.estimate?.().catch(() => undefined);
      const last = await session.lastBackup();
      const folder = externalFolder.ready && folderStore ? (await folderStore.counts()).inFolder : null;
      const sure = await confirmReset({
        summary: [
          `${plural(boards, "board")} with ${plural(canvases, "canvas", "canvases")}`,
          `${plural(items, "library item")}${est?.usage ? `, ${fmtBytes(est.usage)} of browser storage` : ""}`,
          "the saved styles, bookmarks, tags, folders and every setting of this device",
          folder !== null ? "the link to the library folder (its files stay on your disk)" : "",
        ].filter(Boolean),
        lastBackup: last ? `${new Date(last.at).toLocaleString()} (${last.fileName})` : "never",
        folderFiles: folder,
        exportFull: () => runExport(session, { kind: "workspace" }),
        exportFiles: () => runExportFiles(session, { kind: "workspace" }),
        saveLibrary: folder !== null ? () => runSaveLibraryFile(session) : null,
      });
      if (!sure) return;
      const p = beginProgress(editor, "reset", "Deleting all data");
      p.update(null, "the page reloads when it is done");
      await (session.storage?.resetAll(() => p.update(null, "waiting for the other canvast tabs to close")) ?? Promise.reject(new Error("storage is unavailable"))).catch((e) => p.fail(`Could not delete all data: ${(e as Error).message}`));
    },
  });
  // A setting changed in the Settings view reaches the tools and the drawing (the toolbars write to the store the other way).
  settings.subscribe((key) => {
    switch (key) {
      case "pen.color": editor.penColor = settings.get(key); break;
      case "pen.widthPx": editor.penWidthPx = settings.get(key); break;
      case "pen.kind": editor.penKind = settings.get(key); break;
      case "pen.stabilizer.on":
      case "pen.stabilizer.strength": editor.stabilizer = { on: settings.get("pen.stabilizer.on"), strength: settings.get("pen.stabilizer.strength") }; break;
      case "pen.followZoom": editor.followZoom = settings.get(key); break;
      case "select.ignoreFilling": editor.ignoreFilling = settings.get(key); break;
      case "lasso.filter": editor.lassoFilter = settings.get(key); break;
      case "snap.enabled": editor.snap = settings.get(key); break;
      case "select.alignBox": editor.alignBox = settings.get(key); break;
      case "eraser.diameterPx": editor.eraserPx = settings.get(key); break;
      case "eraser.wholeGroups": editor.eraseWholeGroups = settings.get(key); break;
      case "eraser.parts": editor.eraseParts = settings.get(key); break;
      case "quality.auto": quality.pinned = !settings.get("quality.auto") || debug; if (settings.get("quality.auto")) quality.force(0); else applyHeldQuality(); break;
      case "quality.level": applyHeldQuality(); break;
      case "cache.decodedMb": assets?.setBudget(Number(settings.get("cache.decodedMb")) * 2 ** 20); break;
      case "ui.density":
      case "ui.motion":
      case "ui.animSpeed":
      case "nav.travel":
      case "nav.speed":
      case "nav.maxSeconds":
      case "nav.ease":
      case "nav.fade":
      case "nav.baseSeconds":
      case "nav.respectMotion":
        applyAppearance();
        return;
      case "ui.zen":
        applyZen();
        return;
      case "ui.hints":
        hintLine.current?.refresh();
        return;
      case "grid.size":
      case "grid.major":
      case "grid.opacity":
        applyGridLook();
        invalidate();
        return;
      case "snap.reachPx":
        setSnapPx(settings.get(key));
        return;
      case "library.hiddenCopySeconds":
        setHiddenCopySeconds(settings.get(key));
        return;
      case "ui.pattern":
      case "ui.names":
        invalidate();
        return;
      case "ui.corners": // (the round handles drawn on the canvas turn square too)
      case "ui.hue":
      case "ui.hueAdaptive":
      case "ui.background":
      case "ui.vivid":
        // The canvas colours follow the dials too: read them again and redraw.
        applyAppearance();
        theme = readTheme(document.documentElement);
        setCanvasInk(theme.ink);
        tiles.clear();
        invalidate();
        return;
      case "ui.theme":
        applyThemeAttribute();
        theme = readTheme(document.documentElement);
        setCanvasInk(theme.ink);
        tiles.clear();
        invalidate();
        return;
      default:
        if (key.startsWith("key.")) updateToolTitles();
        return;
    }
    editor.changed();
  });
  // The save indicator opens Settings > Storage, the one place for space, the library folder, saving and backups.
  document.querySelector<HTMLElement>('[data-testid="save-status"]')!.addEventListener("click", () => { setView("settings"); settingsView.show("storage"); });

  // The command palette (ADR 0117, 0129): Ctrl+K or Ctrl+Shift+P finds any command by words, and `@kind` narrows it to a kind. The commands come
  // from the registry (src/commands): each part of the app adds its own, so a new feature or a macro has one place to put them.
  const registry = new CommandRegistry();
  /** Settings of the two checks of the library's files (desktop): the full one reads every file, the quick one looks at sizes. */
  const checkLibraryFiles = (quick: boolean): void => {
    const p = busyProgress(editor, quick ? "Checking the library file sizes" : "Checking the library files", [quick ? "Each file is looked for and its size compared with the library's. Nothing is read." : "Each file is read and compared with what the library knows of it. Hidden items are left out."]);
    void storage!.folderSync!.checkFiles((done, total) => p.update(done / total, `${done} of ${plural(total, "file")}`), quick).then(
      (r) => {
        const list = (names: string[]) => names.slice(0, 5).map((n) => `“${n}”`).join(", ") + (names.length > 5 ? ` and ${names.length - 5} more` : "");
        const found = [r.damaged.length ? `${r.damaged.length} changed or damaged (${list(r.damaged)})` : "", r.missing.length ? `${r.missing.length} missing (${list(r.missing)})` : ""].filter(Boolean).join("; ");
        const what = quick ? "Quick check of" : "Checked";
        p.done(found ? `${what} ${r.checked} library files: ${found}. Put good copies back from a backup.` : quick ? `All ${r.checked} library files are there with the sizes the library knows.` : `All ${r.checked} library files are as the library knows them.`);
      },
      (e: unknown) => p.fail(`The check stopped: ${(e as Error).message}`),
    );
  };
  registry.setProvider("app", () => {
    const sel = editor.selection.size > 0;
    const onCanvas = appView === "canvas";
    const key = (k: string): string => k.toUpperCase();
    const list: Command[] = [
      ...TOOL_ORDER.map((t): Command => ({ group: "Tool", title: TOOL_NAME[t], keys: key(keymap.display(TOOL_COMMAND[t])), enabled: () => onCanvas, run: () => editor.setTool(t) })),
      { group: "Edit", title: "Undo", keys: "Ctrl+Z", words: "back revert", enabled: () => onCanvas, run: () => undo(doc, editor) },
      { group: "Edit", title: "Change the old default ink to the canvas ink", words: "recolour near-black dark outline theme light old drawings readable", enabled: () => onCanvas && newInk(DEFAULT_INK) !== DEFAULT_INK, run: () => void recolourOldInk(doc, editor) },
      { group: "Edit", title: "Redo", keys: "Ctrl+Shift+Z", words: "again", enabled: () => onCanvas, run: () => redo(doc, editor) },
      { group: "Edit", title: "Copy", keys: "Ctrl+C", enabled: () => onCanvas && sel, run: () => { if (!document.execCommand("copy")) copySelection(doc, editor, view); } }, // (as the keys do: the copy event below puts it on the system clipboard too)
      ...(desktopBridge() ? [{ group: "Edit", title: "Copy file", words: "real file clipboard file manager", enabled: () => onCanvas && sel && selectedHashes().length > 0, run: () => void selectedFiles().then((ents) => (forgetCopiedPicture(), copyItemsAsFiles(copyOnCanvas, ents))) }] : []),
      { group: "Edit", title: "Cut", keys: "Ctrl+X", enabled: () => onCanvas && sel, run: () => { if (!document.execCommand("cut")) cutSelection(doc, editor, view); } }, // (as Copy: the cut event below puts it on the system clipboard)
      { group: "Edit", title: "Paste", keys: "Ctrl+V", enabled: () => onCanvas, run: () => void pasteObjects(doc, editor, view, null) },
      { group: "Edit", title: "Duplicate", keys: "Ctrl+D", words: "copy", enabled: () => onCanvas && sel, run: () => duplicateSelection(doc, editor, view) },
      { group: "Edit", title: "Rename", words: "file name picture image library layer", enabled: () => onCanvas && !session.readOnly && selectedPictures().length > 0, run: () => void renamePictures() },
      { group: "Edit", title: "Delete everywhere", words: "remove erase library every canvas file", enabled: () => onCanvas && sel && !session.readOnly && selectedHashes().length > 0, run: () => void deleteSelectedEverywhere() },
      { group: "Edit", title: "Delete the selection", keys: "Delete", words: "remove erase", enabled: () => onCanvas && sel, run: () => deleteSelection(doc, editor) },
      { group: "Edit", title: "Show all hidden", words: "unhide reveal eye", enabled: () => onCanvas && [...doc.all()].some((o) => o.hidden), run: () => clearFlag(doc, editor, "hidden") },
      { group: "Edit", title: "Unlock all", words: "unlock locked", enabled: () => onCanvas && [...doc.all()].some((o) => o.locked), run: () => clearFlag(doc, editor, "locked") },
      { group: "Edit", title: "Select everything", keys: "Ctrl+A", words: "all", enabled: () => onCanvas, run: () => editor.select(doc.ordered().filter((o) => !o.hidden && !o.locked).map((o) => o.id)) },
      { group: "Arrange", title: "Group", keys: "Ctrl+G", enabled: () => onCanvas && sel, run: () => groupSelection(doc, editor) },
      { group: "Arrange", title: "Ungroup", keys: "Ctrl+Shift+G", enabled: () => onCanvas && sel, run: () => ungroupSelection(doc, editor) },
      { group: "Arrange", title: "Put the selection on a sheet", keys: "Ctrl+Alt+G", words: "frame wrap", enabled: () => onCanvas && sel, run: () => sheetSelection(doc, editor) },
      { group: "Arrange", title: "Release the sheet", words: "unframe", enabled: () => onCanvas && [...editor.selection].some((id) => isContainer(doc.get(id))), run: () => releaseSheets(doc, editor) },
      { group: "Arrange", title: "Bring to front", keys: "Ctrl+]", enabled: () => onCanvas && sel, run: () => arrangeSelection(doc, editor, "front") },
      { group: "Arrange", title: "Send to back", keys: "Ctrl+[", enabled: () => onCanvas && sel, run: () => arrangeSelection(doc, editor, "back") },
      { group: "Arrange", title: "Detach from what it follows", enabled: () => onCanvas && canDetach(doc, editor), run: () => detachSelection(doc, editor) },
      { group: "Shape", title: "Vector network", words: "join paths regions graph", enabled: () => onCanvas && canMakeNetwork(doc, editor), run: () => makeNetwork(doc, editor) },
      { group: "Shape", title: "Release the network", words: "paths edges", enabled: () => onCanvas && canReleaseNetwork(doc, editor), run: () => releaseNetwork(doc, editor) },
      { group: "Shape", title: "Divide into regions", words: "pathfinder cut overlap", enabled: () => onCanvas && canDivide(doc, editor) && !editor.builder, run: () => divide(doc, editor) },
      { group: "Shape", title: "Shape builder", words: "merge regions overlap unite delete", enabled: () => onCanvas && canDivide(doc, editor) && !editor.builder, run: () => startShapeBuilder(doc, editor) },
      { group: "Shape", title: "Fill gaps", words: "holes empty space between enclosed paint bucket", enabled: () => onCanvas && canFillGaps(doc, editor) && !editor.builder && !editor.gapFill, run: () => fillAllGaps(doc, editor, view, settings.get("shape.gapClosePx")) },
      { group: "Shape", title: "Fill a gap", words: "hole empty space between enclosed paint bucket click", enabled: () => onCanvas && canFillGaps(doc, editor) && !editor.builder && !editor.gapFill, run: () => startGapFill(doc, editor, view, settings.get("shape.gapClosePx")) },
      { group: "Mask", title: "Clipping mask", words: "clip cut shape", enabled: () => onCanvas && canMakeMask(doc, editor), run: () => makeClippingMask(doc, editor) },
      { group: "Mask", title: "Mask by opacity", words: "alpha cut transparent", enabled: () => onCanvas && canMakeMask(doc, editor), run: () => makeMask(doc, editor, "alpha") },
      { group: "Mask", title: "Mask by brightness", words: "luminance greyscale light dark cut", enabled: () => onCanvas && canMakeMask(doc, editor), run: () => makeMask(doc, editor, "luminance") },
      { group: "Mask", title: "Brush mask: show everything, paint black to hide", words: "paint erase reveal", enabled: () => onCanvas && sel && !editor.maskEdit, run: () => startBrushMask(doc, editor, true) },
      { group: "Mask", title: "Brush mask: hide everything, paint white to show", words: "paint reveal", enabled: () => onCanvas && sel && !editor.maskEdit, run: () => startBrushMask(doc, editor, false) },
      { group: "Mask", title: "Paint the mask in white", words: "show reveal", enabled: () => onCanvas && editor.maskEdit !== null, run: () => paintMask(editor, "show") },
      { group: "Mask", title: "Paint the mask in black", words: "hide", enabled: () => onCanvas && editor.maskEdit !== null, run: () => paintMask(editor, "hide") },
      { group: "Mask", title: "Done painting the mask", words: "finish stop", enabled: () => onCanvas && editor.maskEdit !== null, run: () => paintMask(editor, "done") },
      { group: "Mask", title: "Select the mask", words: "select edit move", enabled: () => onCanvas && canReleaseMask(doc, editor), run: () => selectTheMask(doc, editor) },
      { group: "Mask", title: "Invert the mask", words: "swap show hide", enabled: () => onCanvas && canReleaseMask(doc, editor), run: () => changeMask(doc, editor, { invert: !(selectedMask(doc, editor)?.invert ?? false) }) },
      { group: "Mask", title: "Release the mask", words: "remove unmask", enabled: () => onCanvas && canReleaseMask(doc, editor), run: () => changeMask(doc, editor, { release: true }) },
      { group: "Path", title: "Outline stroke", words: "stroke to shape expand", enabled: () => onCanvas && canOutlineStroke(doc, editor), run: () => outlineStroke(doc, editor) },
      ...(["taper", "taper-start", "taper-end", "swell"] as const).map((profile): Command => ({ group: "Path", title: `Width: ${profile.replace("-", " ")}`, words: "variable width thin thick shape", enabled: () => onCanvas && canOutlineStroke(doc, editor), run: () => setWidthProfile(doc, editor, profile) })),
      { group: "Path", title: "Width: even", words: "variable width taper remove", enabled: () => onCanvas && canOutlineStroke(doc, editor), run: () => setWidthProfile(doc, editor, null) },
      { group: "Export", title: "Copy the selection as SVG", words: "vector clipboard text", enabled: () => onCanvas && canExportSvg(doc, editor), run: () => { const t = svgOfSelection(doc, editor); if (t) void copyText(t).then(() => { editor.message = `Copied the shapes as SVG text.${svgWarningOfSelection(doc, editor) ? ` ${svgWarningOfSelection(doc, editor)}` : ""}`; editor.changed(); }); } },
      { group: "Export", title: "Export… (choose a size)", words: "picture png jpeg webp size dpi print sheet image save", enabled: () => onCanvas && exportTarget(doc, editor) !== null, run: () => openExport() },
      { group: "Export", title: "Save the selection to the library as SVG", words: "vector assets", enabled: () => onCanvas && canExportSvg(doc, editor), run: () => void saveSvgToLibrary() },
      { group: "View", title: "Zoom in", keys: "+", enabled: () => onCanvas, run: () => zoomByStep(view, 1) },
      { group: "View", title: "Zoom out", keys: "−", enabled: () => onCanvas, run: () => zoomByStep(view, -1) },
      { group: "View", title: "Return to the origin", keys: "0", words: "home reset", enabled: () => onCanvas, run: () => goHome(view) },
      { group: "View", title: "Fit the selection in view", keys: "F", enabled: () => onCanvas && sel, run: () => focusCycle.fit("selection") },
      { group: "View", title: "Fit everything in view", enabled: () => onCanvas, run: () => focusCycle.fit("all") },
      { group: "View", title: "Previous view", keys: "Alt+Shift+Left", words: "back camera", enabled: () => onCanvas && history.canBack(), run: () => history.back() },
      { group: "View", title: "Next view", keys: "Alt+Shift+Right", words: "forward camera", enabled: () => onCanvas && history.canForward(), run: () => history.forward() },
      { group: "View", title: "Go to a random empty view", words: "dice random far away", enabled: () => onCanvas, run: () => goRandomView() },
      { group: "View", title: "Zen mode", keys: key(keymap.display("view.zen")), words: "focus hide bars", run: () => void settings.set("ui.zen", !settings.get("ui.zen")) },
      { group: "View", title: "Take a screenshot", words: "picture capture", enabled: () => onCanvas, run: () => void takeScreenshot() },
      { group: "View", title: "Play the bookmarks as a tour", words: "present", enabled: () => onCanvas && bookmarkList.items.length > 0, run: () => bookmarkTour.start() },
      { group: "Panel", title: "Adjust", words: "toggle show hide adjustments picture exposure contrast", enabled: () => onCanvas, run: () => { editor.adjustOpen = !editor.adjustOpen; editor.changed(); } },
      { group: "Panel", title: "Layers", words: "toggle show hide", enabled: () => onCanvas, run: () => { editor.layersOpen = !editor.layersOpen; editor.changed(); } },
      { group: "View", title: "Bookmark the selected things", words: "save view selection", enabled: () => onCanvas && editor.selection.size > 0, run: bookmarkPicked },
      { group: "Panel", title: "Bookmarks", words: "toggle show hide", enabled: () => onCanvas, run: () => { editor.bookmarksOpen = !editor.bookmarksOpen; editor.changed(); } },
      { group: "Panel", title: "Pattern", words: "toggle show hide generator wave blob background random tiles", enabled: () => onCanvas, run: () => { editor.patternOpen = !editor.patternOpen; editor.changed(); } },
      { group: "Panel", title: "Styles", words: "toggle show hide adjustments saved", enabled: () => onCanvas, run: () => { editor.stylesOpen = !editor.stylesOpen; editor.changed(); } },
      { group: "Panel", title: "Tags", words: "toggle show hide", enabled: () => onCanvas, run: () => { editor.tagsOpen = !editor.tagsOpen; editor.changed(); } },
      { group: "Go to", title: "Canvas view", run: () => setView("canvas") },
      { group: "Go to", title: "Library", words: "assets files pictures", run: () => setView("assets") },
      { group: "Go to", title: "Shortcuts", keys: "?", words: "keys keyboard help", run: () => { setView("settings"); settingsView.show("shortcuts"); } },
      { group: "Workspace", title: "New canvas", words: "add", run: () => { const b = session.current?.boardId; if (b) void session.newCanvas(b); } },
      { group: "Workspace", title: "New board", words: "add", run: () => void session.newBoard() },
      { group: "Workspace", title: "Export a backup (.canvast)", words: "save archive", run: () => void runExport(session, { kind: "workspace" }) },
      ...(canSwitchWorkspace() ? [{ group: "Workspace", title: "Switch workspace…", words: "open folder new recent workspace change", run: () => void openWorkspaceSwitcher(document.querySelector<HTMLElement>('[data-testid="workspace-chevron"]') ?? document.body) }] : []),
      ...(storage?.folderSync
        ? [
            { group: "Workspace", title: "Check library files", words: "verify damaged corrupt missing integrity hash folder", run: () => checkLibraryFiles(false) },
            { group: "Workspace", title: "Check library files (quick)", words: "verify damaged missing size fast folder", run: () => checkLibraryFiles(true) },
          ]
        : []),
      ...(storage?.hidden ? [{ group: "Workspace", title: "Lock hidden items", words: "encrypt password hide close", enabled: () => !!storage.hidden?.isOpen(), run: () => void lockHidden(session).then(() => { editor.message = HIDDEN_LOCKED; editor.changed(); }) }] : []),
    ];
    // the keys shown are the ones in use now (Settings > Shortcuts)
    const TITLE_COMMAND: Record<string, string> = { Undo: "edit.undo", Redo: "edit.redo", Duplicate: "edit.duplicate", "Delete the selection": "edit.delete", "Select everything": "edit.selectAll", Group: "edit.group", Ungroup: "edit.ungroup", "Bring to front": "edit.front", "Send to back": "edit.back", "Zoom in": "view.zoomIn", "Zoom out": "view.zoomOut", "Return to the origin": "view.home", "Fit the selection in view": "view.focus", "Previous view": "view.back", "Next view": "view.forward", Shortcuts: "find.help" };
    for (const c of list) {
      const id = TITLE_COMMAND[c.title];
      if (id) c.keys = keymap.bindings(id).map(displayCombo).join(", ");
    }
    return list;
  });
  // The context menu (right click, or the menu key): the commands that fit what is under the pointer and what is picked, from the same registry.
  mountContextMenu(canvas, registry, {
    active: () => appView === "canvas" && !textEditor.isOpen && performance.now() - editor.fingerListAt > 1500,
    pickAt: (x, y) => {
      const hit = pickAll(visibleObjects(doc, index, null, view.frameCamera, view.viewport).filter((po) => !po.obj.hidden && !po.obj.locked), x, y)[0]?.obj;
      if (hit && !editor.selection.has(hit.id)) editor.select([hit.id]);
      return !!hit; // (empty canvas: the menu of the canvas, whatever is picked)
    },
  });
  registry.setProvider("panels", () => dock.commands().map((c): Command => ({ ...c, enabled: () => appView === "canvas" && (c.enabled?.() ?? true) })));
  registry.setProvider("settings", () => [
    ...SETTINGS_TABS.map((t): Command => ({ group: "Settings", kind: "settings", title: t.label, words: "preferences options", run: () => { setView("settings"); settingsView.show(t.id); } })),
    ...settingCommands(SETTINGS_TABS, settings, (tab) => { setView("settings"); settingsView.show(tab); }),
  ]);
  registry.setProvider("bars", () => (appView === "canvas" ? barCommands() : []));
  // Boards and canvases of the navigator, and the fixed shortcuts of Settings > Shortcuts (choosing one opens that list).
  registry.setProvider("navigator", () => {
    const tree = session.tree;
    if (!tree) return [];
    const out: Command[] = [];
    for (const { board, canvases } of tree.boards) {
      for (const c of canvases) out.push({ id: `canvas:${c.id}`, group: "Canvas", kind: "canvas", title: `${board.name} / ${c.name}`, words: "open go switch board", enabled: () => session.current?.canvasId !== c.id, run: () => { setView("canvas"); void session.openCanvas(c.id); } });
    }
    out.push({ group: "Canvas", kind: "canvas", title: "Rename this canvas", words: "name", enabled: () => !!session.current, takes: { prompt: "New name of the canvas", run: (n) => void session.renameCanvas(session.current!.canvasId, n) }, run: () => undefined });
    out.push({ group: "Canvas", kind: "canvas", title: "Rename this board", words: "name", enabled: () => !!session.current, takes: { prompt: "New name of the board", run: (n) => void session.renameBoard(session.current!.boardId, n) }, run: () => undefined });
    return out;
  });
  registry.setProvider("shortcuts", () => [...KEY_COMMANDS.map((c): Command => ({ group: "Shortcut", kind: "shortcut", quiet: true, title: c.name, keys: keymap.bindings(c.id).map(displayCombo).join(", ") || "none", words: c.group, run: () => { setView("settings"); settingsView.show("shortcuts"); } })), ...FIXED_SHORTCUTS.flatMap((g) => g.items.map((i): Command => ({ group: "Shortcut", kind: "shortcut", quiet: true, title: i.does, keys: i.keys, words: g.group, run: () => { setView("settings"); settingsView.show("shortcuts"); } })))]);
  const macros = new Macros(registry, (text) => { editor.message = text; editor.changed(); });
  const palette = mountCommandPalette(registry);
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.key.toLowerCase() !== "k" && !(e.shiftKey && e.key.toLowerCase() === "p"))) return;
    if ((e.target as HTMLElement | null)?.closest?.("dialog")) return;
    e.preventDefault();
    palette.open();
  }, true);

  // "/" opens the command palette (not while typing).
  window.addEventListener("keydown", (e) => {
    if (e.key !== "/" || appView !== "canvas" || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || (e.target as HTMLElement | null)?.closest?.("dialog")) return;
    e.preventDefault();
    palette.open();
  });

  // "?" opens the shortcut list (not while typing).
  window.addEventListener("keydown", (e) => {
    if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || (e.target as HTMLElement | null)?.closest?.("dialog")) return;
    e.preventDefault();
    if (appView !== "settings") setView("settings");
    settingsView.show("shortcuts");
  });

  // Drag-and-drop and paste import.
  window.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  // In Assets view, files go into the library only; in Canvas view they are also placed.
  /** Whether a clipboard event belongs to a text field (or the text editor) rather than to the canvas. */
  const typing = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    return !!el && (el.isContentEditable || /^(TEXTAREA|SELECT)$/.test(el.tagName) || (el.tagName === "INPUT" && !/^(range|checkbox|radio|button|color)$/.test((el as HTMLInputElement).type)));
  };
  const receive = (all: File[]): void => {
    // Archives are imported (after confirmation); everything else is a media import.
    for (const f of all.filter(isArchiveFile)) void runImport(session, f);
    const files = all.filter((f) => !isArchiveFile(f));
    if (!files.length) return;
    // (files that came from a folder are then put in library folders of the same names)
    void (appView === "assets" ? assetsView.importFiles(files, true) : importFiles(files)).then(() => fileByFolders(session, files));
  };
  // A drag that starts inside the app (a picture dragged out of the library, a layer row) is never a file import: the browser would hand
  // the dragged thumbnail over as a new file and store it as an asset of its own.
  let internalDrag = false;
  window.addEventListener("dragstart", () => (internalDrag = true));
  window.addEventListener("dragend", () => (internalDrag = false));
  window.addEventListener("drop", (e) => {
    const entries = entriesOfDrop(e.dataTransfer);
    if (!internalDrag && hasFolder(entries)) {
      // a folder: every file in it comes in, in the library folders it had
      e.preventDefault();
      void filesOfEntries(entries).then(receive);
      return;
    }
    const files = [...(e.dataTransfer?.files ?? [])];
    if (internalDrag) {
      if (files.length) e.preventDefault();
      internalDrag = false;
      return;
    }
    if (!files.length) return;
    e.preventDefault();
    receive(files);
  });
  // Where the pointer last was over the view: what is pasted lands under it, whatever floats over the canvas there, and after the pointer has left the
  // window (the middle of the view only before it has been over the view at all).
  const trackPointer = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (x >= 0 && y >= 0 && x <= r.width && y <= r.height) editor.pointerAt = { x, y };
  };
  window.addEventListener("pointermove", trackPointer, true);
  window.addEventListener("pointerdown", trackPointer, true);
  // On Linux a middle click is also a paste, of what is selected in any app: here the middle button pans, so what it ends is no paste. (In a field it stays one.)
  let middleUpAt = -Infinity;
  for (const type of ["pointerdown", "pointerup", "auxclick"]) window.addEventListener(type, (e) => void ((e as MouseEvent).button === 1 && (middleUpAt = performance.now())), true);
  let pasteKeyAt = -Infinity;
  window.addEventListener("keydown", (e) => void (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") || (e.shiftKey && e.key === "Insert") ? (pasteKeyAt = performance.now()) : 0), true);
  window.addEventListener("paste", (e) => {
    // A paste into a field, an editor (the notes editor takes a picture in itself), a dialog or a menu is theirs: nothing is imported or placed.
    if (e.defaultPrevented || typing(e.target) || (e.target as HTMLElement | null)?.closest?.("dialog, [popover], .note-dock") || document.querySelector("dialog:modal")) return;
    // (the system's paste of a middle click can come a good while after the button, on a busy machine; a paste key pressed since is a real paste)
    if (performance.now() - middleUpAt < 3000 && middleUpAt > pasteKeyAt) return void e.preventDefault();
    const files = onePerPicture([...(e.clipboardData?.files ?? [])]);
    // What canvast copied comes back as the objects, even though the clipboard also holds its picture and SVG for other apps.
    const own = e.clipboardData?.getData("text/plain") ?? "";
    if (appView === "canvas" && !textEditor.isOpen && (!files.length || own !== "" || isCopiedPicture()) && pasteObjects(doc, editor, view, own || null)) {
      e.preventDefault();
      return;
    }
    if (files.length) {
      e.preventDefault();
      receive(files);
    } else if (appView === "canvas" && !textEditor.isOpen && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(e.clipboardData?.getData("text/plain") ?? "") && importSvg(doc, editor, view, e.clipboardData!.getData("text/plain"))) e.preventDefault();
    else if (appView === "canvas" && !textEditor.isOpen && pasteCssPaint(doc, editor, e.clipboardData?.getData("text/plain") ?? "")) e.preventDefault();
    else if (appView === "canvas" && !textEditor.isOpen && pasteObjects(doc, editor, view, e.clipboardData?.getData("text/plain") ?? null)) e.preventDefault();
    else if (appView === "canvas" && !textEditor.isOpen && pasteWords(e.clipboardData?.getData("text/plain") ?? "")) e.preventDefault();
  });
  /** Words copied in another program: a new text under the pointer (in the middle of the view before the pointer has been over it), a long one wrapped. */
  const PASTED_TEXT_WRAP_PX = 480;
  const pasteWords = (text: string): boolean => {
    const words = text.replace(/\r\n?/g, "\n").trim();
    if (!words || isPlaceholderText(words)) return false;
    const vp = view.viewport;
    const at = screenToWorld(view.camera, vp, editor.pointerAt ?? { x: vp.width / 2, y: vp.height / 2 });
    return textEditor.add(words, at, words.length > 60 || words.includes("\n") ? { widthPx: PASTED_TEXT_WRAP_PX } : undefined);
  };
  // A picture of the copied things (PNG: one still at full size with its crop and adjustments, else at most 1024 px) next to the text (alone when the text would only say "N objects"), for other apps; the text stays what copySelection set,
  // which is how a paste here knows the objects are still ours. Best effort: a browser without the clipboard picture API keeps the text.
  const copySize = (t: ExportTarget, long: number): { w: number; h: number } => ({ w: Math.max(1, Math.round(t.ratio >= 1 ? long : long * t.ratio)), h: Math.max(1, Math.round(t.ratio >= 1 ? long / t.ratio : long)) });
  const copyPicture = async (t: ExportTarget, withText: boolean, svg?: string, svgFile?: string, files?: ClipboardFiles, hidden = false): Promise<void> => {
    const text = copiedText();
    if (text === null) return;
    const { w, h } = copySize(t, t.original ? Math.min(4096, Math.max(t.original.w, t.original.h)) : 1024);
    // one still picture goes as it looks with its crop and adjustments at full size; a GIF or video as the frame shown; the rest as drawn
    // (not a hidden one out of reach: what makes a file shows that as a padlock. One that cannot be made is drawn instead.)
    const lockedOut = hiddenOutOfReach();
    const still = t.original && !lockedOut ? renderedStill(doc, editor, filesAssets).catch(() => null) : Promise.resolve(null);
    const png = still
      .then((b) => b ?? renderExport({ doc, index, assets: filesAssets, theme }, t, w, h, "transparent").then((c) => new Promise<Blob>((ok, no) => c.toBlob((x) => (x ? ok(x) : no(new Error("no picture"))), "image/png"))))
      .then((b) => (markCopiedPicture(), b));
    // (the words go beside the picture only for copied texts: otherwise a program that takes text would paste the SVG or a count and not the picture)
    // (a line saying how many objects is for a paste here: it never takes the place of a picture that failed)
    const words = isPlaceholderText(text) ? {} : { text, withText };
    const done = await writeSystemClipboard({ image: png, ...words, ...(svg ? { svg } : {}), ...(svgFile ? { svgFile } : {}), ...(files ? { files } : {}), hidden });
    if (done === "failed") copyOnCanvas.say("Could not copy to the clipboard.");
    else if (lockedOut) copyOnCanvas.say("A hidden item copies as a padlock outside hidden mode.");
  };
  /** A hidden item is a padlock outside hidden mode: no file action reaches it there, whatever the password state. */
  const hiddenInReach = (): boolean => hiddenModeOn() && (storage?.hidden ? storage.hidden.isOpen() : true);
  const hiddenOutOfReach = (): boolean => !hiddenInReach() && [...editor.selection].some((id) => assets.isHidden((doc.get(id) as { assetId?: string } | undefined)?.assetId ?? ""));
  /** Copy as picture: as it looks now. A hidden one out of reach is a padlock, as any copy of it is; one in reach asks first, as any copy of it does. */
  const copyAsShown = async (): Promise<void> => {
    const t = exportTargets(doc, editor)[0];
    if (hiddenOutOfReach() && t) {
      const { w, h } = copySize(t, 1024);
      const png = renderExport({ doc, index, assets: filesAssets, theme }, t, w, h, "transparent").then((c) => new Promise<Blob>((ok, no) => c.toBlob((x) => (x ? ok(x) : no(new Error("no picture"))), "image/png")));
      const done = await writeSystemClipboard({ image: png });
      forgetCopiedPicture();
      return copyOnCanvas.say(done === "failed" ? "Could not copy to the clipboard." : "A hidden item copies as a padlock outside hidden mode.");
    }
    const chosen = await selectedFiles();
    if (await hiddenFine(chosen)) await copyRenderedPicture(doc, editor, filesAssets, chosen.some((e) => meta(e).hidden));
  };
  /** The library files of the things selected that file actions may reach: not a text's font, not a padlock. */
  const selectedHashes = (): string[] =>
    [...new Set([...editor.selection].flatMap((id) => {
      const o = doc.get(id) as { assetId?: string; kind?: string } | undefined;
      return o?.assetId && o.kind !== "text" && (hiddenInReach() || !assets.isHidden(o.assetId)) ? [o.assetId] : [];
    }))];
  const selectedFiles = async (): Promise<CatalogEntry[]> => {
    const found = await Promise.all(selectedHashes().map((h) => session.catalog?.entry(h).catch(() => undefined)));
    return found.filter((e): e is NonNullable<typeof e> => !!e && (hiddenInReach() || !meta(e).hidden));
  };
  const deleteSelectedEverywhere = async (): Promise<void> => {
    const ents = await selectedFiles();
    if (!ents.length) return;
    const found = await Promise.all(ents.map((e) => session.assetPlaces(e.hash)));
    const places = found.flat();
    await deleteEverywhere(session, {
      hashes: ents.map((e) => e.hash),
      name: ents[0]!.name,
      uses: places.reduce((t, pl) => t + pl.ids.length, 0),
      canvases: new Set(places.map((pl) => pl.canvasId)).size,
      places: places.map((pl) => `${pl.boardName} › ${pl.canvasName}`),
    });
  };
  const copyOnCanvas: CopyDeps = {
    file: async (h) => {
      const rec = await assets.record(h).catch(() => undefined);
      return rec && externalFolder.fileOf(rec);
    },
    thumb: async (h) => (await session.catalog?.thumb(h).catch(() => undefined))?.blob,
    fileOf: (h) => session.storage?.originals.fileOf(h) ?? Promise.resolve(null),
    say: (m) => {
      editor.message = m;
      editor.changed();
    },
  };
  /** What a copy on the canvas puts out: one note card is its words, so it pastes into a note elsewhere (and still as the card here); the rest a picture. */
  /** Past this, shapes go as one file rather than a file each (temporary files, written at each copy). */
  const MAX_SVG_FILES = 500;
  const copyOut = async (t: ExportTarget | null, withText: boolean, svg?: string): Promise<void> => {
    const one = editor.selection.size === 1 ? await selectedFiles() : [];
    if (one[0] && noteKindOf(one[0].name)) {
      const text = await copyItemsToClipboard(copyOnCanvas, one);
      if (text !== null) {
        forgetCopiedPicture();
        setCopiedText(text);
        return;
      }
    }
    // A picture as it was imported can go as its file: cropped, flipped or adjusted, only the PNG shows that. (A hidden one asks first, and one out of reach is not found.)
    const asImported = (o: CanvasObject | undefined): boolean => o?.kind !== "image" || (!o.crop && !o.flipX && !o.flipY && !o.adjust);
    const objs = [...editor.selection].map((id) => doc.get(id));
    const bridge = desktopBridge();
    const found = bridge ? await selectedFiles() : one;
    const whole = found.filter((e) => objs.some((o) => (o as { assetId?: string } | undefined)?.assetId === e.hash && asImported(o)));
    const fine = await hiddenFine(found);
    const anyHidden = fine && found.some((e) => meta(e).hidden);
    const ents = fine ? whole : whole.filter((e) => !meta(e).hidden);
    const real = bridge && ents.length ? await filesOf(copyOnCanvas, bridge, ents) : undefined;
    // Pictures with their edits: among several, each as a new file as it looks now, since its own file does not show them. (A video's or a GIF's edits stay out.)
    const edited: Array<{ name: string; bytes: Uint8Array }> = [];
    // (no two files that go together of one name: pasted into one folder, they would meet)
    const taken = new Set(ents.map((e) => e.name));
    if (bridge && objs.length > 1) {
      for (const o of objs) {
        if (o?.kind !== "image" || o.media || asImported(o)) continue;
        const e = found.find((x) => x.hash === o.assetId);
        if (!e || (meta(e).hidden && !fine)) continue;
        const rec = await assets.record(o.assetId).catch(() => undefined);
        const png = rec && (await renderedPicture(rec.blob, o).catch(() => null));
        if (png) edited.push({ name: freeNameIn(taken, `${e.name.replace(/\.[^.]*$/, "")}-edited.png`), bytes: new Uint8Array(await png.arrayBuffer()) });
      }
    }
    const files = real || edited.length ? { files: real?.files ?? [], copies: [...(real?.copies ?? []), ...edited], n: (real?.n ?? 0) + edited.length } : undefined;
    const lone = one[0] && ents[0]?.hash === one[0].hash && clipboardFor(one[0].name, one[0].type) === "vector" ? one[0] : undefined;
    const own = lone ? await (await copyOnCanvas.file(lone.hash))?.text().catch(() => undefined) : undefined;
    // Shapes: a file for each, or for each group, at its own proportions. (What is on a sheet stays with the sheet.)
    const loose = bridge && !objs.some((o) => isContainer(o)) ? objs.filter((o): o is PathObject => o?.kind === "path" && !o.hidden && !o.locked && !isTexture(o.fill) && !isTexture(o.stroke)) : [];
    const units = new Map<string, PathObject[]>();
    for (const o of loose) {
      const key = o.groups?.[0] ?? o.id; // (its outermost group)
      units.set(key, [...(units.get(key) ?? []), o]);
    }
    const tooMany = units.size > MAX_SVG_FILES;
    const parts = tooMany ? [loose] : [...units.values()];
    const svgs = parts.flatMap((part) => {
      const theirs = part.length ? buildTarget(doc, part, null) : null;
      const text = theirs && svgOfTarget(doc, theirs, { w: String(copySize(theirs, 1000).w), h: String(copySize(theirs, 1000).h) });
      return text && text.length <= MAX_COPIED_SVG ? [{ name: tooMany ? "selection" : part.length > 1 ? "group" : (part[0]!.name ?? "shape"), text }] : [];
    });
    const made = svgs.length > 1 ? undefined : (svgs[0]?.text ?? svg ?? undefined);
    markCopiedPicture(); // (from now: a paste here is the objects, even before the copy is on the clipboard)
    if (tooMany) copyOnCanvas.say(`More than ${MAX_SVG_FILES} shapes go as one file.`);
    // Several real files: those alone, as Copy file gives them, for a program given one picture would take that and leave the rest.
    if ((files?.n ?? 0) + (svgs.length > 1 ? svgs.length : made ? 1 : 0) > 1 || !t) {
      if (!files?.n && !made && !svgs.length) return;
      const shapeFiles = made ? [{ name: svgs[0]?.name ?? t?.name ?? "selection", text: made }] : svgs;
      const all = { files: files?.files ?? [], copies: [...(files?.copies ?? []), ...shapeFiles.map((f) => svgCopy(freeNameIn(taken, `${f.name}.svg`), f.text))] };
      if ((await writeSystemClipboard({ files: all, hidden: anyHidden })) === "failed") copyOnCanvas.say("Could not copy to the clipboard.");
      return;
    }
    await copyPicture(t, withText, made ?? own, made ? (svgs[0]?.name ?? t.name) : undefined, files, anyHidden);
  };
  // Copy and cut take the selected objects (text fields and the text editor keep their own).
  for (const kind of ["copy", "cut"] as const) {
    document.addEventListener(kind, (e) => {
      if (typing(e.target) || appView !== "canvas" || textEditor.isOpen) return;
      // Shapes leave as SVG text and a copy also puts a picture of what was copied on the system clipboard (see copyPicture); a paste into canvast still finds the objects.
      const ts = exportTargets(doc, editor);
      const t = ts.length === 1 ? ts[0]! : null;
      // (a picture or objects fill is written into an SVG as embedded images, which would be megabytes of text: those shapes go as a picture only)
      const svg0 = t?.vectors && !t.vectors.some((o) => isTexture(o.fill) || isTexture(o.stroke)) ? svgOfTarget(doc, t, { w: String(copySize(t, 1000).w), h: String(copySize(t, 1000).h) }) : null;
      const svg = svg0 && svg0.length <= MAX_COPIED_SVG ? svg0 : null;
      if ((kind === "copy" ? copySelection : cutSelection)(doc, editor, view, e, svg ?? undefined)) {
        e.preventDefault();
        if (kind === "copy") void sayingProgress(copyOnCanvas.say, () => copyOut(t, !svg, svg ?? undefined));
      }
    });
  }
  // Best-effort flush when the page is hidden; saves are already debounced to 150 ms.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void persistence.flush();
      void persistence.saveCamera();
    }
  });

  if (debug) {
    installDebugHook(
      view,
      stats,
      canvas,
      () => {
        invalidate();
        return new Promise((resolve) => frameWaiters.push(resolve));
      },
      { doc, editor, session, renderNow, index, draws: () => drawCount, pictureLocked: (hash) => assets.isLocked(hash), appView: () => appView, setSetting: (k, v) => void (settings as unknown as { set(k: string, v: unknown): Promise<void> }).set(k, v), getSetting: (k) => settings.get(k as never), setView, tiles, density, quality, indexReady: () => indexSync.ready(), labels: () => labels },
    );
  }
  resize();
  canvas.focus();
  editor.changed();
  if (settings.get("ui.view") === "assets") setView("assets");
}

startErrorLog();
void start();
