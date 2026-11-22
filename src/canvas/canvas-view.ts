// The canvas engine (ADR 0009, 0010, 0028, 0047): the spatial index of a document, its tile cache and density preview, the drawing of a frame
// and the frame loop. Made once for each view of a canvas: the main view, and a pinned one (Pins). Moved out of app/main.ts as it was.
import { comicHandles } from "../interaction/comic-handles";
import { isComicPage } from "../app/comic";
import { ViewState } from "../app/view-state";
import { isBackdrop, rasterKey } from "../doc/model";
import type { CanvasObject, ImageObject, ObjectId, TextObject } from "../doc/model";
import { worldToScreen, type ScreenPoint } from "../core/camera";
import { drawAgentPointer } from "../render/agent-mark";
import type { PathObject } from "../doc/model";
import { FrameStats } from "../app/frame-stats";
import type { FrameBreakdown } from "../app/frame-stats";
import { EditorState } from "../app/editor-state";
import { renderFrame } from "../render/canvas2d-renderer";
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
import { isTexture } from "../doc/texture";
import { dimHits, revealHits, type RevealWhy } from "../interaction/reveal";
import { LANDMARKS } from "../scene/landmarks";
import { DocumentStore } from "../doc/document-store";
import { syncIndex } from "../scene/spatial-index";
import { FrameIndex, cameraIn, isCoarse, worldBackdrop } from "../scene/frame-index";
import type { Frame } from "../core/frames";
import { localCamera, normalize } from "../core/frames";
import { AssetLibrary } from "../assets/asset-library";
import { be } from "../doc/plural";
import { labelOf } from "../ui/layers-panel";
import { layoutHandles } from "../interaction/layout-handles";
import { isContainer } from "../doc/containers";
import { hasShadow, needsNeighbours } from "../doc/adjust";
import { AssetNames } from "../app/asset-names";
import { isLabelled, itemLabels } from "../render/item-label";
import { drawReveal, drawRevealOutlines, revealWords } from "../render/reveal";
import type { ItemLabel } from "../render/item-label";
import { SettingsStore } from "../settings/settings";

/** A row of the list a click over the selection's box opens (main.ts `choicesAt`). */
export interface Choice { /** The row's own key: a group's id, else its thing's. */ key?: string; /** How deep under a group of the selection (0: the selection's own items). */ depth?: number; ids: ObjectId[]; enter: string[]; label: string; icon: string; why?: RevealWhy; from: "here" | "selection"; sep?: boolean }

export interface CanvasViewDeps {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  doc: DocumentStore;
  view: ViewState;
  stats: FrameStats;
  editor(): EditorState;
  settings(): SettingsStore;
  assets(): AssetLibrary;
  assetNames(): AssetNames;
  theme(): Theme & SceneTheme;
  dpr(): number;
  /** The rows of the list a click over the selection's box opens (the reveal list). */
  choicesAt(at: ScreenPoint): Choice[];
  hintRefresh(): void;
  /** The view is shown (another view covering it: nothing is drawn, the frame waiters still go on). */
  shown(): boolean;
  /** A frame was drawn, in this many ms. */
  drawn(ms: number): void;
}

export function createCanvasView(d: CanvasViewDeps) {
  const { canvas, ctx, doc, view, stats } = d;
  void canvas;
  // The spatial index mirrors the document incrementally (changed ids only).
  const index = new FrameIndex(() => doc.space);
  const indexSync = syncIndex(doc, index, {
    onProgress: (done, total) => {
      const editor = d.editor();
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
  /** The objects drawn on their own while an adjustment shape is in view and the view is drawn directly (ADR 0188). */
  let objectsLayer: HTMLCanvasElement | null = null;
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

  let scheduled = false;
  let frameWaiters: Array<() => void> = [];

  const invalidate = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(draw);
  };

  let backdrop: ({ f: Frame } & ReturnType<typeof worldBackdrop>) | null = null;
  /** Where the AI agent's pointer was last drawn (its next move glides from there). */
  let agentPointerAt: { x: number; y: number } | null = null;
  /** Render synchronously and return the timing breakdown. */
  const renderNow = (shot?: { pattern: boolean; overlays: boolean; transparent: boolean }): FrameBreakdown => {
    const editor = d.editor(), settings = d.settings(), assets = d.assets(), theme = d.theme(), dpr = d.dpr();
    // (the names only when a name is wanted, as before: read later, they may not exist yet at the first frame)
    const assetNames = { get: (h: string) => d.assetNames().get(h), get map() { return d.assetNames().map; } };
    const t0 = performance.now();
    const cam = view.camera;
    const fc = view.frameCamera;
    const vp = view.viewport;
    // Axes and landmarks are world-frame content, re-expressed in the camera frame (once per frame change).
    if (backdrop?.f !== fc.f) backdrop = { f: fc.f, ...worldBackdrop(fc.f, LANDMARKS) };
    renderFrame(ctx, cam, vp, dpr, theme, backdrop!.landmarks, backdrop!.origin, shot && !shot.pattern ? "none" : settings.get("ui.pattern"), !shot?.transparent);
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
      const direct0 = performance.now();
      visible = visibleObjects(doc, index, editor, fc, vp);
      t2 = performance.now();
      if (visible.some((po) => isBackdrop(po.obj))) {
        // (an adjustment shape adjusts objects only, not the grid under them: the objects are drawn on a layer of their own first, as tiles are)
        const own = (objectsLayer ??= document.createElement("canvas"));
        own.width = ctx.canvas.width; // (also clears it)
        own.height = ctx.canvas.height;
        const oc = own.getContext("2d")!;
        oc.setTransform(ctx.getTransform());
        drawObjects(oc, visible, assets, vp, dpr, theme);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(own, 0, 0);
        ctx.restore();
      } else drawObjects(ctx, visible, assets, vp, dpr, theme);
      tiles.directMs = performance.now() - direct0; // (what this view costs drawn directly: a zoom in progress draws so while it is less than a set)
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
      // (a picked sheet with auto layout: its gap and padding handles, not while it or something on it is being changed)
      const lh = editor.preview.kind === "none" || editor.preview.kind === "replace" ? layoutHandles(doc, selected) : null;
      // (a comic page or its panels selected: its gutter and corner handles, ADR 0206)
      // (only with something selected and a tool that shows them: nothing more is worked out on every frame of a pan or a zoom)
      const ch = editor.selection.size && (editor.tool === "select" || editor.tool === "panel") && editor.preview.kind === "none" && !editor.comicKnife ? comicHandles(doc, editor, selected.some((po) => isComicPage(po.obj)) ? selected : (visible ??= visibleObjects(doc, index, editor, fc, vp))) : null;
      drawOverlays(ctx, selected, editor, fc, vp, theme, members, labels, owner, lh && { handles: lh.handles, flow: lh.sheet.container.layout.flow }, ch?.handles);
    }
    if ((editor.revealAt || editor.revealIds) && (!shot || shot.overlays)) {
      const all = (visible ??= visibleObjects(doc, index, editor, fc, vp));
      if (editor.revealIds) drawRevealOutlines(ctx, all.filter((po) => editor.revealIds!.has(po.obj.id)), theme, true);
    }
    // Where an AI agent works (ADR 0205): what it made or changed outlined, and its pointer there gliding from where it was, then fading.
    const mark = editor.agentMark;
    if (mark && (!shot || shot.overlays)) {
      const now = performance.now();
      const all = mark.ids.length ? (visible ??= visibleObjects(doc, index, editor, fc, vp)) : [];
      const shown = all.filter((po) => mark.ids.includes(po.obj.id));
      const fade = Math.min(1, (mark.until - now) / 600);
      if (shown.length) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, fade);
        drawRevealOutlines(ctx, shown, theme, true);
        ctx.restore();
      }
      let to: { x: number; y: number } | null = null;
      if (shown.length) {
        const minX = Math.min(...shown.map((po) => po.box.minX));
        const maxX = Math.max(...shown.map((po) => po.box.maxX));
        const minY = Math.min(...shown.map((po) => po.box.minY));
        const maxY = Math.max(...shown.map((po) => po.box.maxY));
        to = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      } else {
        // shortcut: off the view, only an item of the canvas's own space is pointed at (one inside a nested frame is not), from its anchor
        const o = view.frame === doc.space.world ? mark.ids.map((id) => doc.get(id)).find((x) => x && !x.frame) : undefined;
        if (o) to = worldToScreen(view.camera, vp, o.anchor);
      }
      if (to && Number.isFinite(to.x) && Number.isFinite(to.y)) {
        const t = mark.from ? Math.min(1, (now - mark.at) / 350) : 1;
        const ease = 1 - (1 - t) ** 3;
        const at = mark.from ? { x: mark.from.x + (to.x - mark.from.x) * ease, y: mark.from.y + (to.y - mark.from.y) * ease } : to;
        agentPointerAt = at;
        mark.off = drawAgentPointer(ctx, at, vp, `AI agent: ${mark.title}`, theme, fade, view.glideMs ? now : 0); // (reduced motion: a still ring)
        if (mark.off) mark.until = Math.max(mark.until, mark.at + 8000); // (off the view it waits longer: it is easy to miss at the edge)
      }
    }
    if (editor.revealAt && (!shot || shot.overlays)) {
      const all = (visible ??= visibleObjects(doc, index, editor, fc, vp));
      const name0 = (po: ProjectedObject): string => labelOf(po.obj, assetNames.map).text; // (as Layers names it)
      let hits = revealHits(all, editor.revealAt.x, editor.revealAt.y);
      // Over nothing inside the selection's box: what the selection holds, the very rows of the list a click opens (choicesAt): a nested group
      // is one row, by its name, outlined whole, and picked whole.
      // Every item, nested groups' items indented under them, in the small list beside the pointer, which scrolls (the wheel, while Ctrl is held).
      const rows: Choice[] = hits.length ? [] : d.choicesAt(editor.revealAt).filter((c) => c.from === "selection");
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
        d.hintRefresh();
      }
    } else if (editor.revealText !== null) {
      editor.revealText = null;
      d.hintRefresh();
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

  let drawCount = 0;
  const draw = (): void => {
    drawCount++;
    scheduled = false;
    // Assets view covers the canvas: rendering is suspended (frame waiters still resolve).
    if (d.shown()) d.drawn(renderNow().totalMs);
    const waiters = frameWaiters;
    frameWaiters = [];
    for (const w of waiters) w();
  };

  return {
    index, indexSync, tiles, density, objectsUsers, fillUsersOf, invalidate, renderNow, draw,
    labels: (): ItemLabel[] => labels,
    agentPointerAt: () => agentPointerAt,
    draws: () => drawCount,
    /** After the next frame is drawn. */
    nextFrame: (): Promise<void> => new Promise((resolve) => frameWaiters.push(resolve)),
  };
}
