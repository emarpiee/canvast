import { externalFolder, externalHashes } from "../storage/external-folder";
import { ViewState } from "./view-state";
import { fileInLibrary } from "./library-filing";
import { storeFrame } from "./frames";
import { newObjectId, rasterKey } from "../doc/model";
import type { CanvasObject, ImageObject } from "../doc/model";
import type { Gradient, GradientStop } from "../doc/paint";
import type { PathObject } from "../doc/model";
import type { JoinChoice } from "../doc/stroke-look";
import { SHOT_FORMATS, encodeShot, shotFileName, shotTags, withInterface } from "./screenshot";
import { isCard } from "../assets/file-kind";
import { downloadOriginal, fileActionsOf, openOriginalInTab, saveFile } from "../ui/file-actions";
import { FrameStats } from "./frame-stats";
import type { FrameBreakdown } from "./frame-stats";
import { mountHud } from "./hud";
import { installDebugHook } from "./debug-hook";
import { EditorState } from "./editor-state";
import type { LayoutCommand } from "./actions";
import { pasteCssPaint, applyRotation, showReplaced, arrangeSelection, copySelection, cutSelection, duplicateSelection, pasteObjects, layoutSelection, clearFlag, deleteSelection, groupSelection, importImages, moveAbove, setStackOrder, tagObjects, resetRotation, resetProportions, resettable, recolourOldInk, svgWarningOfTargets, svgWarningOfSelection, extractFrame, pruneSelection, redo, setFlag, setMedia, setFlagOn, setOpacityOn, setBlendOn, renameLayer, ungroupSelection, undo, selectedPaint, previewPaint, commitPaint, combineSelection, canCombine, selectedOutline, commitOutline, selectedDashNumbers, commitDashNumbers, selectedArrows, commitArrows, selectedMiterAngle, commitMiterAngle, selectedShape, commitShape, selectedCorners, commitCorners, selectedSmoothing, commitSmoothing, selectionPaints, recolour, initialShapeState, setInitialShape, resetToInitialShape, groupJoinMode, addToBooleanGroup, takeOutOfBooleanGroup, convertTextToPath, simplifySelection, canSimplify, outlineStroke, setWidthProfile, canOutlineStroke, makeMask, makeClippingMask, canMakeMask, changeMask, selectTheMask, canReleaseMask, selectedMask, startBrushMask, paintMask, divide, startShapeBuilder, finishShapeBuilder, canDivide, makeNetwork, releaseNetwork, canMakeNetwork, canReleaseNetwork, strokeToPath, canStrokeToPath, setTextOnPath, canSetOnPath, takeTextOffPath, canTakeOffPath, canOutline, booleanSelection, releaseBoolean, flattenBoolean, canExportSvg, exportTarget, exportTargets, svgOfTarget, pdfVectorOfTarget, svgOfSelection, importSvg, setSheetClip, sheetSelection, releaseSheets, selectedPin, setPin, canFitSheet, fitSheet, sheetRatio, setSheetRatio, sheetScalesContents, setSheetScale, boxOnSheet, moveOnSheet, resizeOnSheet, canDetach, detachSelection, selectedTextStyle, setTextStyle, croppablePicture, isCropped, uncropPicture, selectedAdjust, pictureCount, applyGradientMap, paintTargetCount, selectionColours, previewAdjust, commitAdjust, copyAdjustments, pasteAdjustments, canPasteAdjustments, copyRenderedPicture, bakePicture } from "./actions";
import { attachNavigation } from "../interaction/navigation";
import { attachTools } from "../interaction/tools";
import { createFocusCycle, focusObjects, stepToNeighbour } from "../interaction/item-navigation";
import { renderFrame } from "../render/canvas2d-renderer";
import type { Theme } from "../render/canvas2d-renderer";
import { batchRuns, drawObjects, drawOverlays, drawCropGhost } from "../render/scene-renderer";
import { strokeLineWidth } from "../render/draw-objects";
import type { ProjectedObject } from "../render/projection";
import { coverObject, projectObject } from "../render/projection";
import { TileCache } from "../render/tile-cache";
import { DensityLayer } from "../render/density";
import type { SceneTheme } from "../render/scene-renderer";
import { hiddenInView, visibleObjects } from "../render/scene-view";
import { setTextureHost } from "../render/texture";
import { isTexture } from "../doc/texture";
import { createTextureHost } from "./texture-host";
import { pickAll } from "../render/hit-test";
import { dimHits, revealHits } from "../interaction/reveal";
import { syncScroll } from "../ui/bar";
import { parseHex, rgbToOklch } from "../colour-picker/colour";
import { mountContextMenu } from "../ui/context-menu";
import { LANDMARKS } from "../scene/landmarks";
import { DocumentStore } from "../doc/document-store";
import { syncIndex } from "../scene/spatial-index";
import { FrameIndex, cameraIn, isCoarse, worldBackdrop } from "../scene/frame-index";
import type { Frame } from "../core/frames";
import { depthOf, localCamera, normalize } from "../core/frames";
import { AssetLibrary } from "../assets/asset-library";
import { openDb } from "../storage/idb";
import { WorkspaceRepo } from "../storage/workspace-repo";
import type { SaveState } from "../storage/canvas-persistence";
import { Session } from "./session";
import { mountNavigator } from "../ui/navigator";
import { mountLibraryFolderCard } from "../ui/library-folder-card";
import { confirmReset } from "../ui/reset-dialog";
import { beginProgress } from "./progress";
import { plural } from "../doc/plural";
import { installAutoIndex } from "../storage/auto-index";
import { fmtBytes } from "../ui/format";
import { resetAllData } from "../storage/reset";
import { libraryCounts } from "../storage/external-folder";
import { runSaveLibraryFile } from "../ui/archive-ui";
import { mountToolbar } from "../ui/toolbar";
import { initColourPopover } from "../ui/colour-popover";
import { labelOf, mountLayersPanel } from "../ui/layers-panel";
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
import { chooseDialog, confirmDialog } from "../ui/confirm";
import { extractPalette } from "../assets/extract-palette";
import { mountTagsPanel } from "../ui/tags-panel";
import { mountStylesPanel } from "../ui/styles-panel";
import { linkedUpdates } from "./style-sync";
import { PanelDock } from "../ui/panel-dock";
import { mountAdjustPanel } from "../ui/adjust-panel";
import { mountPatternPanel } from "../ui/pattern-panel";
import { patternTargetLabel, foundPattern, makePattern, newPatternSession } from "./pattern";
import { mountCanvasSearch } from "../ui/canvas-search";
import { mountNotices } from "../ui/notices";
import { FIXED_SHORTCUTS, TOOL_COMMAND, TOOL_NAME, TOOL_ORDER, navForKey, toolForKey } from "../settings/shortcuts";
import { KEY_COMMANDS, Keymap, displayCombo, installKeymap } from "../settings/keymap";
import { randomEmptyView, viewIsEmpty } from "../interaction/random-view";
import { renderExport } from "./export-render";
import { openExportDialog } from "../ui/export-dialog";
import { mountViewSwitch } from "../ui/view-switch";
import type { AppView } from "../ui/view-switch";
import { entriesOfDrop, fileByFolders, filesOfEntries, hasFolder } from "./directory";
import { isArchiveFile, runExport, runExportChanges, runExportFiles, runImport } from "../ui/archive-ui";
import { copyText, mountTextEditor } from "../ui/text-editor";
import { FontLoader, whyNotFont } from "./font-loader";
import { onFontsChange } from "../text/fonts";
import { describeFile } from "../assets/file-kind";
import { NOTE_CARD, NOTE_INK, styleOf, toolLook } from "../text/text-style";
import { installTextFont } from "../text/inter";
import { descendantsOf, isContainer } from "../doc/containers";
import { CameraHistory } from "./camera-history";
import { mountTour } from "./tour";
import { ADJUSTMENT_KIND } from "../assets/styles";
import { setColourStyles } from "../ui/colour-popover";
import { setTextureHooks } from "../ui/texture-editor";
import { createTextureHooks } from "./texture-actions";
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
import { SettingsStore } from "../settings/settings";
import { DEFAULT_INK, newInk, setCanvasInk } from "../render/ink";
import { paintFromText, paintToText } from "../doc/paint";

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
    ink: v("--canvas-ink"),
    danger: v("--canvas-danger"),
    dangerWash: v("--canvas-danger-wash"),
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
  readonly: "Read-only (another tab is editing)",
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
  doc.subscribe((_source, changed) => {
    // What a sheet holds is cut by it: when a sheet changes, so does the look of everything on it (ADR 0108).
    const sheets = changed ? [...changed].filter((id) => isContainer(doc.get(id))) : [];
    // (an objects fill of an objects fill follows too, down the chain; a cycle ends because an id is added once)
    const hit = new Set(changed);
    for (let grew = changed !== null && objectsUsers.size > 0; grew; ) {
      grew = false;
      for (const [id, src] of objectsUsers) if (!hit.has(id) && src.some((i) => hit.has(i))) (hit.add(id), (grew = true));
    }
    const more = changed ? [...hit].filter((id) => !changed.has(id)) : [];
    tiles.invalidate(sheets.length || more.length ? new Set([...changed!, ...more, ...descendantsOf(doc.all(), new Set(sheets))]) : changed);
  });
  // Objects with a blend mode (ADR 0047): tiles hold paint without its backdrop, so a view that shows one is drawn directly.
  const blended = new Set<string>();
  doc.subscribe((_source, changed) => {
    if (changed === null) {
      blended.clear();
      for (const o of doc.all()) if (o.blend) blended.add(o.id);
      return;
    }
    for (const id of changed) {
      if (doc.get(id)?.blend) blended.add(id);
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
  editor.shapeStroke = paintFromText(settings.get("shape.stroke")) ?? null;
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
    settings.set("shape.stroke", paintToText(editor.shapeStroke));
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
    if (t === "system") delete document.documentElement.dataset["theme"];
    else document.documentElement.dataset["theme"] = t;
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
    const still = m === "reduce" || (m === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    view.glideMs = debug || still ? 0 : Math.round(420 * (m === "subtle" ? speed * 0.6 : speed));
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

  let db: IDBDatabase | null = null;
  let storageError = "";
  try {
    db = await openDb(undefined, {
      onBlocked: () => {
        editor.message = "Upgrading storage: close other canvast tabs to continue.";
        editor.changed();
      },
      onVersionChange: () => {
        editor.message = "canvast was upgraded in another tab. Reload this tab to keep working.";
        editor.readOnly = true;
        editor.changed();
      },
    });
    await externalFolder.load(db); // (before anything is drawn: an await later in this function lets a frame run early)
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
  const assets = new AssetLibrary(db, () => {
    tiles.dropPending(); // an original finished loading: redraw tiles that showed its placeholder
    invalidate();
  });
  // The library folder (ADR 0159): a restart asks permission again, which needs a click in the storage panel.
  externalFolder.subscribe(() => assets.retryAll());
  if (db && externalFolder.state === "needs-permission") {
    void externalHashes(db).then((h) => {
      if (!h.length) return;
      editor.message = "The library folder needs your permission again: open the storage panel and press Reconnect folder.";
      editor.changed();
    });
  }
  assets.onNotice = (text) => { editor.message = text; editor.changed(); };
  assets.setBudget(Number(settings.get("cache.decodedMb")) * 2 ** 20);
  const textureHost = createTextureHost({ doc, index, assets, theme: () => theme });
  setTextureHost(textureHost); // (texture fills, ADR 0154)
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
            (po) => (po.obj.kind === "stroke" ? strokeLineWidth(po) / 2 + 2 : 2),
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
    if (!shot || shot.overlays) drawOverlays(ctx, selected, editor, fc, vp, theme, members, labels);
    if ((editor.revealAt || editor.revealIds) && (!shot || shot.overlays)) {
      const all = (visible ??= visibleObjects(doc, index, editor, fc, vp));
      if (editor.revealIds) drawRevealOutlines(ctx, all.filter((po) => editor.revealIds!.has(po.obj.id)), theme, true);
    }
    if (editor.revealAt && (!shot || shot.overlays)) {
      const all = (visible ??= visibleObjects(doc, index, editor, fc, vp));
      const name = (po: ProjectedObject): string => po.obj.name ?? itemName(po.obj, (h) => assetNames.get(h)) ?? (po.obj.kind === "path" ? ({ rect: "Rectangle", ellipse: "Ellipse", polygon: "Polygon", star: "Star", line: "Line" } as Record<string, string>)[po.obj.shape ?? ""] ?? "Path" : po.obj.kind === "stroke" ? "Stroke" : po.obj.kind === "text" ? "Text" : "Item");
      const hits = revealHits(all, editor.revealAt.x, editor.revealAt.y);
      const dim = dimHits(all, hiddenInView(doc, fc, vp), editor.revealAt.x, editor.revealAt.y);
      drawReveal(ctx, hits, editor.revealAt, theme, name, dim);
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
  const draw = (): void => {
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

  const session = new Session(db ? new WorkspaceRepo(db) : null, doc, view, editor, assets);
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
  const assetNames = new AssetNames(async (hash) => (await session.catalog?.entry(hash).catch(() => undefined))?.name ?? "");
  assetNames.subscribe(() => invalidate());
  if (db) {
    try {
      await session.start();
      if (session.startup?.kind === "migrated") {
        const m = session.startup.migration;
        editor.message = m.verified
          ? `Upgraded your canvas to the new storage format (${m.copied} objects, verified). The old data was kept.`
          : `Upgrade could not be verified (${m.verifyError ?? "unknown"}). The old data was kept unchanged.`;
      }
    } catch (e) {
      editor.message = `Could not open the workspace: ${(e as Error).message}`;
    }
  } else {
    editor.message = `Storage unavailable (${storageError}); work will not be saved.`;
  }
  const persistence = session.persistence;
  // Startup marks (docs/testing/phase-8.md): the canvas is loaded, the index is complete (the first frame is marked where it is drawn).
  mark("loaded");
  void indexSync.ready().then(() => mark("indexed"));
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
  editor.subscribe(() => {
    canvas.dataset["tool"] = editor.tool;
    invalidate();
  });
  editor.subscribeRedraw(invalidate);
  canvas.dataset["tool"] = editor.tool;

  const importFiles = (files: File[]): Promise<unknown> => importImages(files, assets, doc, view, editor);
  attachNavigation(canvas, view);
  /** The fonts in the library, loaded: for the font choices of the toolbar and of the words selected in a text. */
  const libraryFonts = async (): Promise<Array<{ hash: string; name: string; unusable: string }>> => {
    const list = (await session.catalog?.list())?.entries ?? [];
    const fonts = list.filter((e) => e.present && describeFile(e.name, e.type).category === "Font").sort((a, b) => a.name.localeCompare(b.name));
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
  });
  attachTools(canvas, view, doc, index, editor, { editText: (t, at, box) => textEditor.open(t, at, box), toolForKey: (k) => toolForKey(k), navForKey: (k) => navForKey(k),
    navigate: (dir) => void stepToNeighbour(doc, view, editor, dir, settings.get("nav.mode"), settings.get("nav.arrive") === "focus"),
    focusSelection: () => focusCycle.tap(),
    labels: () => labels,
    openSearch: (prefix) => canvasSearch.open(prefix),
    // A long press with a finger lists what is under it (ADR 0151): a row outlines its thing while touched and picks it when tapped; "Add to the pick" keeps what is picked.
    revealList: (at, things, pick) => {
      const box = canvas.getBoundingClientRect();
      const anchor = document.createElement("div");
      anchor.style.cssText = `position:fixed;left:${box.left + at.x}px;top:${box.top + at.y}px;width:0;height:0;pointer-events:none`;
      document.body.appendChild(anchor);
      let add = false;
      const items = (): MenuItem[] => [
        { id: "reveal-add", label: "Add to the pick", hint: "Tap to add or take out; tap outside when done", icon: ICONS.listChecks, checked: add, run: () => { add = !add; } },
        ...things.map((o): MenuItem => {
          const l = labelOf(o, assetNames.map);
          // ticked while picked; in "Add to the pick" a tap on a picked one takes it out again
          return { id: o.id, label: l.text, icon: l.icon, checked: editor.selection.has(o.id), run: () => {
            if (add && editor.selection.has(o.id)) editor.select([...editor.selection].filter((x) => x !== o.id));
            else pick(o.id, add);
            if (!add) closeMoreMenu();
          } };
        }),
      ];
      openMoreMenu(anchor, items(), "Under your finger", {
        keepOpen: true,
        consumeOutside: true,
        needPress: true,
        refresh: items,
        onActive: (i) => { const o = i === null || i < 1 ? undefined : things[i - 1]; editor.revealIds = o ? new Set([o.id]) : null; editor.redraw(); },
        onClose: () => { anchor.remove(); editor.revealIds = null; editor.redraw(); },
      });
    },
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
  mountBookmarksPanel(side, editor, bookmarkList, () => captureThumb(canvas), () => bookmarkTour.start(), { update: (ids) => void refreshThumbs(ids) });
  mountMediaPlayer(host, view, doc, editor, assets, settings, { setMedia: (id, patch, label) => setMedia(doc, editor, id, patch, label), extract: (id, png, label) => void extractFrame(doc, editor, assets, id, png, label, (shot) => storeFrame(assets, session, settings, shot)), repaint: (id) => { tiles.invalidate(new Set([id])); invalidate(); } });
  mountLayersPanel(side, editor, doc, {
    setFlagOn: (ids, flag, on) => setFlagOn(doc, editor, ids, flag, on),
    setClip: (id, clip) => setSheetClip(doc, editor, id, clip),
    moveAbove: (ids, above) => moveAbove(doc, editor, ids, above),
    setOrder: (order, label) => setStackOrder(doc, editor, order, label),
    setOpacity: (ids, opacity, final) => setOpacityOn(doc, editor, ids, opacity, final),
    setBlend: (ids, blend) => setBlendOn(doc, editor, ids, blend),
    rename: (key, name) => renameLayer(doc, editor, key, name),
    names: assetNames,
  });
  mountStylesPanel(side, editor, session.styles, {
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
              lines: ["Which part of the picked shapes should take it?"],
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
          editor.message = session.readOnly ? "Read-only: this workspace is open for editing in another tab." : "Nothing to save: no adjustment is set.";
          editor.changed();
        }
      },
  });
  // Every floating panel lives in the dock (ADR 0123): stacked on a side, or floating, folded by its title bar.
  const panelEl = (testid: string): HTMLElement => side.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!;
  dock.add(panelEl("layers-panel"), { id: "layers", title: "Layers", side: "right" });
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
  mountPatternPanel(side, editor, {
    make: (g, values, seed) => makePattern(doc, editor, view, patternSession, g, values, seed),
    live: () => (patternSession.top !== null && doc.lastTransaction === patternSession.top) || foundPattern(doc, editor) !== null,
    found: () => { const f = foundPattern(doc, editor); return f ? { id: f.info.id, gid: f.info.gid, seed: f.info.seed, v: f.info.v } : null; },
    end: () => { patternSession.top = null; patternSession.sheet = null; },
    target: () => patternTargetLabel(doc, editor),
  });
  dock.add(panelEl("pattern-panel"), { id: "pattern", title: "Pattern", side: "right" });
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
      const wLocal = first?.kind === "image" ? (first.stroke === undefined ? 0 : (first.width ?? 0)) : first?.width;
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
    selectedTextStyle: () => (textEditor.isOpen ? textEditor.look() : editor.tool === "text" ? toolLook(editor.textLook, newInk(editor.penColor)) : editor.tool === "note" ? toolLook({ color: NOTE_INK, ...editor.textLook, card: editor.textLook.card ?? NOTE_CARD }, newInk(editor.penColor)) : selectedTextStyle(doc, editor, textPpu)),
    setTextStyle: (look, final = true) => {
      if (editor.tool === "text" || editor.tool === "note") editor.textLook = { ...editor.textLook, ...look };
      if (textEditor.isOpen) textEditor.restyle(look);
      else if (editor.tool !== "text" && editor.tool !== "note") setTextStyle(doc, editor, look, textPpu, final);
      else editor.changed();
    },
    setPin: (patch) => setPin(doc, editor, patch as { h?: "left"; v?: "top" }),
    sheetRatio: () => sheetRatio(doc, editor),
    setSheetRatio: (r, final) => setSheetRatio(doc, editor, r, final),
    boxOnSheet: () => boxOnSheet(doc, editor),
    moveOnSheet: (x, y, final) => moveOnSheet(doc, editor, x, y, final),
    resizeOnSheet: (w, h, final) => resizeOnSheet(doc, editor, w, h, final),
    exportSelection: () => openExport(),
    sheetScale: () => sheetScalesContents(doc, editor),
    setSheetScale: (on) => setSheetScale(doc, editor, on),
    croppable: () => croppablePicture(doc, editor) !== null,
    cropped: () => isCropped(doc, editor),
    uncrop: () => uncropPicture(doc, editor),
    selectedAdjust: () => selectedAdjust(doc, editor),
    adjustStyles: adjustStylesApi,
    previewAdjust: (a) => previewAdjust(doc, editor, a),
    commitAdjust: (a, label) => commitAdjust(doc, editor, a, label),
    copyAdjust: () => void copyAdjustments(doc, editor),
    pasteAdjust: () => pasteAdjustments(doc, editor),
    canPasteAdjust: () => canPasteAdjustments(),
    copyRendered: () => void copyRenderedPicture(doc, editor, assets),
    bake: () => void bakePicture(doc, editor, assets, (shot) => storeFrame(assets, session, settings, shot)),
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
  const openExport = (): void => {
    const targets = exportTargets(doc, editor);
    if (!targets.length || appView !== "canvas") {
      editor.message = "Pick a sheet, a picture or some shapes to export.";
      editor.changed();
      return;
    }
    openExportDialog({
      targets,
      render: (t, w, h, bg) => renderExport({ doc, index, assets, theme }, t, w, h, bg),
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
      renderNow({ pattern: cfg.pattern, overlays: false, transparent: cfg.transparent });
      let pic = document.createElement("canvas");
      pic.width = canvas.width;
      pic.height = canvas.height;
      pic.getContext("2d")!.drawImage(canvas, 0, 0);
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
        try {
          const png = format === "png" ? blob : await new Promise<Blob | null>((r) => pic.toBlob(r, "image/png"));
          if (png) await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
        } catch {
          // the clipboard refused (no permission): the screenshot is saved anyway
        }
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
        .filter((e) => e.type.startsWith("image/") && !e.card && e.present)
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
  // Fresh pictures for the bookmarks (ADR 0124): the canvas visits each place, one at a time, and comes back.
  let thumbsRunning = false;
  const refreshThumbs = async (ids?: readonly string[]): Promise<void> => {
    const list = ids ? bookmarkList.items.filter((b) => ids.includes(b.id)) : bookmarkList.items;
    if (thumbsRunning || !list.length || appView !== "canvas") return;
    thumbsRunning = true;
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
      const mib = (b: number): string => (b / 2 ** 20).toFixed(0);
      return [
        `objects ${doc.size.toLocaleString()} · drawn ${stats.last?.visibleCount.toLocaleString() ?? 0}${indexSync.building() ? " · indexing…" : ""}`,
        `decoded ${mem.count} images · ${mib(mem.bytes)} / ${mib(mem.budget)} MiB · decoding ${q.running} · waiting ${q.queued}`,
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
  const fileKinds = new Map<string, { card: boolean; open: boolean; svg: boolean }>();
  // The selection action bar follows the selection box (updated after each drawn frame).
  // Menus and pickers keep off the selected items.
  setMenuAvoid(() => {
    const b = editor.selectionBoxOnScreen;
    if (!b || editor.selection.size === 0) return null;
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
      takeOffPath: () => takeTextOffPath(doc, editor),
      canTakeOffPath: () => canTakeOffPath(doc, editor),
      canOutline: () => canOutline(doc, editor),
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
      finishBuilder: (apply) => finishShapeBuilder(doc, editor, apply),
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
      tag: () => {
        editor.tagsOpen = true;
        editor.changed();
        requestAnimationFrame(() => tagsPanel.focusAdd());
      },
      fileSelection: () => {
        const ids = [...editor.selection];
        const o = ids.length === 1 ? doc.get(ids[0]!) : undefined;
        if (o?.kind !== "image") return null;
        if (!fileKinds.has(o.assetId)) {
          fileKinds.set(o.assetId, { card: false, open: false, svg: false });
          void session.catalog?.entry(o.assetId).then((e) => {
            if (!e) return;
            fileKinds.set(o.assetId, { card: isCard(e), open: fileActionsOf(e.name, e.type).canOpen, svg: e.type === "image/svg+xml" });
            contextBar.update();
          });
        }
        const k = fileKinds.get(o.assetId)!;
        return k.card ? { hash: o.assetId, open: k.open } : null;
      },
      pictureTools: () => {
        const sa = selectedAdjust(doc, editor);
        return sa ? { still: sa.stills, canPaste: canPasteAdjustments() } : null;
      },
      copyAdjust: () => void copyAdjustments(doc, editor),
      pasteAdjust: () => pasteAdjustments(doc, editor),
      copyRendered: () => void copyRenderedPicture(doc, editor, assets),
      bake: () => void bakePicture(doc, editor, assets, (shot) => storeFrame(assets, session, settings, shot)),
      svgPicture: () => {
        const ids = [...editor.selection];
        const o = ids.length === 1 ? doc.get(ids[0]!) : undefined;
        if (o?.kind !== "image") return false;
        void session.catalog?.entry(o.assetId).then((e) => {
          if (e && !fileKinds.get(o.assetId)?.svg && e.type === "image/svg+xml") {
            fileKinds.set(o.assetId, { card: isCard(e), open: fileActionsOf(e.name, e.type).canOpen, svg: true });
            contextBar.update();
          }
        });
        return fileKinds.get(o.assetId)?.svg === true;
      },
      vectorise: () => {
        const o = [...editor.selection].map((id) => doc.get(id)).find((x) => x?.kind === "image");
        if (o?.kind !== "image") return;
        void assets.record(o.assetId).then(async (rec) => {
          if (rec) importSvg(doc, editor, view, await rec.blob.text()); // (the picture stays: this makes a vector copy)
        });
      },
      canExportSvg: () => canExportSvg(doc, editor),
      saveSvgToLibrary: () => void saveSvgToLibrary(),
      initialState: () => initialShapeState(doc, editor),
      setInitialState: (onlyMissing) => setInitialShape(doc, editor, onlyMissing, settings.get("shape.initialPaint")),
      resetInitialState: () => resetToInitialShape(doc, editor),
      canExport: () => exportTarget(doc, editor) !== null,
      exportPicture: () => openExport(),
      canDownload: () => pickedFiles(doc, editor).length > 0,
      downloadFile: () => void downloadSelection(doc, editor, assets, session, settings),
      openFile: () => {
        const o = [...editor.selection].map((id) => doc.get(id)).find((x) => x?.kind === "image");
        if (o?.kind === "image") void openOriginalInTab(assets, o.assetId);
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
  markTab("canvas");
  markNav("canvas");
  const assetsView = mountAssetsView(assetsRoot, session, assets, () => setView("canvas"), notices, settings);
  // Alt+Shift+Left and Alt+Shift+Right: previous and next view (ADR 0116), on the canvas. (Alt with an arrow alone pans, as ever.)
  window.addEventListener("keydown", (e) => {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    if (document.body.dataset["view"] !== "canvas" || typing(e.target) || (e.target as HTMLElement | null)?.closest?.("dialog")) return;
    e.preventDefault(); // (not the browser's Back and Forward)
    if (e.key === "ArrowLeft") history.back();
    else history.forward();
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
  session.autoIndex = installAutoIndex({
    enabled: () => settings.get("storage.autoIndex"),
    readOnly: () => session.readOnly,
    build: (scope, progress) => session.exportArchive(scope, progress),
    say: (text) => { editor.message = text; editor.changed(); },
  });
  session.subscribeAssets(() => session.autoIndex?.poke()); // (commits, imports, catalog changes)
  settings.subscribe(() => session.autoIndex?.poke());
  externalFolder.subscribe(() => session.autoIndex?.poke()); // (a folder was chosen or came back)
  session.settingsHook = { snapshot: () => settings.snapshot(), restore: (s) => settings.restore(s), restorable: (s) => settings.restorable(s), getAuto: () => settings.get("storage.autoIndex"), setAuto: (on) => void settings.set("storage.autoIndex", on) };
  const settingsView = mountSettingsView(document.getElementById("settings-view")!, settings, keymap, () => setView("canvas"), {
    last: async () => {
      const r = await session.lastBackup();
      return r ? { at: r.at, kind: r.kind ?? "full", fileName: r.fileName, bytes: r.bytes } : null;
    },
    exportFull: async () => void (await runExport(session, { kind: "workspace" })),
    exportChanges: () => runExportChanges(session),
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
    reset: async () => {
      const db = session.repo?.db ?? null;
      const tree = session.tree;
      const boards = tree?.boards.length ?? 0;
      const canvases = tree?.boards.reduce((n, b) => n + b.canvases.length, 0) ?? 0;
      const items = (await session.catalog?.list().catch(() => null))?.entries.length ?? 0;
      const est = await navigator.storage?.estimate?.().catch(() => undefined);
      const last = await session.lastBackup();
      const folder = externalFolder.ready && db ? (await libraryCounts(db)).inFolder : null;
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
      await resetAllData({ db, onBlocked: () => p.update(null, "waiting for the other canvast tabs to close") }).catch((e) => p.fail(`Could not delete all data: ${(e as Error).message}`));
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
        applyAppearance();
        return;
      case "ui.zen":
        applyZen();
        return;
      case "ui.hints":
        hintLine.current?.refresh();
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
  registry.setProvider("app", () => {
    const sel = editor.selection.size > 0;
    const onCanvas = appView === "canvas";
    const key = (k: string): string => k.toUpperCase();
    const list: Command[] = [
      ...TOOL_ORDER.map((t): Command => ({ group: "Tool", title: TOOL_NAME[t], keys: key(keymap.display(TOOL_COMMAND[t])), enabled: () => onCanvas, run: () => editor.setTool(t) })),
      { group: "Edit", title: "Undo", keys: "Ctrl+Z", words: "back revert", enabled: () => onCanvas, run: () => undo(doc, editor) },
      { group: "Edit", title: "Change the old default ink to the canvas ink", words: "recolour near-black dark outline theme light old drawings readable", enabled: () => onCanvas && newInk(DEFAULT_INK) !== DEFAULT_INK, run: () => void recolourOldInk(doc, editor) },
      { group: "Edit", title: "Redo", keys: "Ctrl+Shift+Z", words: "again", enabled: () => onCanvas, run: () => redo(doc, editor) },
      { group: "Edit", title: "Copy", keys: "Ctrl+C", enabled: () => onCanvas && sel, run: () => void copySelection(doc, editor, view) },
      { group: "Edit", title: "Cut", keys: "Ctrl+X", enabled: () => onCanvas && sel, run: () => void cutSelection(doc, editor, view) },
      { group: "Edit", title: "Paste", keys: "Ctrl+V", enabled: () => onCanvas, run: () => void pasteObjects(doc, editor, view, null) },
      { group: "Edit", title: "Duplicate", keys: "Ctrl+D", words: "copy", enabled: () => onCanvas && sel, run: () => duplicateSelection(doc, editor, view) },
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
      { group: "Mask", title: "Clipping mask", words: "clip cut shape", enabled: () => onCanvas && canMakeMask(doc, editor), run: () => makeClippingMask(doc, editor) },
      { group: "Mask", title: "Mask by opacity", words: "alpha cut transparent", enabled: () => onCanvas && canMakeMask(doc, editor), run: () => makeMask(doc, editor, "alpha") },
      { group: "Mask", title: "Mask by brightness", words: "luminance greyscale light dark cut", enabled: () => onCanvas && canMakeMask(doc, editor), run: () => makeMask(doc, editor, "luminance") },
      { group: "Mask", title: "Brush mask: show everything, paint black to hide", words: "paint erase reveal", enabled: () => onCanvas && sel && !editor.maskEdit, run: () => startBrushMask(doc, editor, true) },
      { group: "Mask", title: "Brush mask: hide everything, paint white to show", words: "paint reveal", enabled: () => onCanvas && sel && !editor.maskEdit, run: () => startBrushMask(doc, editor, false) },
      { group: "Mask", title: "Paint the mask in white", words: "show reveal", enabled: () => onCanvas && editor.maskEdit !== null, run: () => paintMask(editor, "show") },
      { group: "Mask", title: "Paint the mask in black", words: "hide", enabled: () => onCanvas && editor.maskEdit !== null, run: () => paintMask(editor, "hide") },
      { group: "Mask", title: "Done painting the mask", words: "finish stop", enabled: () => onCanvas && editor.maskEdit !== null, run: () => paintMask(editor, "done") },
      { group: "Mask", title: "Pick the mask", words: "select edit move", enabled: () => onCanvas && canReleaseMask(doc, editor), run: () => selectTheMask(doc, editor) },
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
    void (appView === "assets" ? assetsView.importFiles(files) : importFiles(files)).then(() => fileByFolders(session, files));
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
  // Where the pointer is on the canvas: what is pasted lands under it (the middle of the view when it is elsewhere).
  const trackPointer = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    editor.pointerAt = { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener("pointermove", trackPointer);
  canvas.addEventListener("pointerdown", trackPointer);
  canvas.addEventListener("pointerleave", () => { editor.pointerAt = null; });
  window.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      receive(files);
    } else if (!typing(e.target) && appView === "canvas" && !textEditor.isOpen && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(e.clipboardData?.getData("text/plain") ?? "") && importSvg(doc, editor, view, e.clipboardData!.getData("text/plain"))) e.preventDefault();
    else if (!typing(e.target) && appView === "canvas" && !textEditor.isOpen && pasteCssPaint(doc, editor, e.clipboardData?.getData("text/plain") ?? "")) e.preventDefault();
    else if (!typing(e.target) && appView === "canvas" && !textEditor.isOpen && pasteObjects(doc, editor, view, e.clipboardData?.getData("text/plain") ?? null)) e.preventDefault();
  });
  // Copy and cut take the selected objects (text fields and the text editor keep their own).
  for (const kind of ["copy", "cut"] as const) {
    document.addEventListener(kind, (e) => {
      if (typing(e.target) || appView !== "canvas" || textEditor.isOpen) return;
      if ((kind === "copy" ? copySelection : cutSelection)(doc, editor, view, e)) e.preventDefault();
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
      { doc, editor, session, renderNow, index, appView: () => appView, setView, tiles, density, quality, indexReady: () => indexSync.ready(), labels: () => labels },
    );
  }
  resize();
  canvas.focus();
  editor.changed();
  if (settings.get("ui.view") === "assets") setView("assets");
}

startErrorLog();
void start();
