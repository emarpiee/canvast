/**
 * Vector layers edited with the canvas's own tools (ADR 0167). The picked vector layer (`kind: "object"`) is loaded into a document of the
 * canvas (`DocumentStore`, with its index, view and editor state), and the canvas's tools (`attachTools`), text editor and overlays work on
 * it unchanged: the same gizmo, handles, node editing, Pen, Path, Shape, Text, keys and touch gestures as on the canvas. A page px is a
 * world unit at zoom 0 (ADR 0166), so the view's camera is the Painting view's, both ways. Every finished edit is one step of the
 * painting's history (the layer's objects replaced); an undo there loads the layer again. Drawing with no vector layer picked makes one.
 */
import * as D from "../core/dyadic";
import { fromLocal } from "../core/frames";
import { ViewState } from "../app/view-state";
import { EditorState } from "../app/editor-state";
import { DocumentStore } from "../doc/document-store";
import { deserializeObject } from "../doc/model";
import { FrameIndex } from "../scene/frame-index";
import { syncIndex } from "../scene/spatial-index";
import { visibleObjects } from "../render/scene-view";
import { drawObjects, drawOverlays, type SceneTheme } from "../render/scene-renderer";
import type { AssetLibrary } from "../assets/asset-library";
import { attachTools, type ToolHooks } from "../interaction/tools";
import { toolForKey } from "../settings/shortcuts";
import { mountTextEditor } from "../ui/text-editor";
import type { PaintCamera } from "./camera";
import { nextName, type Layer, type ObjectLayer } from "./model";
import { cameraFor, pageSpace, stored, type At } from "./objects";
import type { PaintSession } from "./session";

export interface VectorHostDeps {
  /** The Painting view's canvas (the tools take its pointer) and the stage holding it (the text editor goes there). */
  readonly el: HTMLCanvasElement;
  readonly stage: HTMLElement;
  session(): PaintSession | null;
  /** Whether the pointer is the canvas's tools' (else a painting tool has it). */
  active(): boolean;
  /** Whether the keys are the canvas's tools' (while a painting is open and shown). */
  keysActive(): boolean;
  camera(): PaintCamera;
  /** The canvas's gestures moved the view (pan, pinch): the Painting view takes it (and keeps it within its limits). */
  setCamera(c: PaintCamera): void;
  size(): { w: number; h: number };
  redraw(): void;
  assets: AssetLibrary;
  theme(): SceneTheme;
  fonts?: () => Promise<Array<{ hash: string; name: string; unusable: string }>>;
  revealList: ToolHooks["revealList"];
  sample: NonNullable<ToolHooks["sample"]>;
}

const isVector = (l: Layer | null | undefined): l is ObjectLayer => !!l && l.kind === "object";

export function createVectorHost(deps: VectorHostDeps) {
  const doc = new DocumentStore();
  const view = new ViewState(() => doc.space);
  const index = new FrameIndex(() => doc.space);
  syncIndex(doc, index);
  const editor = new EditorState();
  /** The layer loaded, and its objects as last loaded or written (a change from elsewhere, as an undo, loads it again). */
  let layerId: string | null = null;
  let written: ObjectLayer["objs"] | null = null;
  let loading = false;
  let adding = false;
  let syncing = false;

  const load = (l: ObjectLayer | null): void => {
    loading = true;
    try {
      doc.load(l ? l.objs.map((s) => deserializeObject(s, pageSpace())) : [], pageSpace());
    } finally {
      loading = false;
    }
    if (l?.id !== layerId) editor.select([]);
    layerId = l?.id ?? null;
    written = l?.objs ?? null;
    editor.readOnly = !!l?.locked;
  };

  /** Follow the painting: the picked layer when it is a vector layer (none otherwise), loaded again when it changed elsewhere. */
  const sync = (): void => {
    const s = deps.session();
    if (adding || !s) return;
    const a = s.active();
    const l = isVector(a) ? a : null;
    if (l?.id === layerId && (l?.objs ?? null) === written) {
      editor.readOnly = !!l?.locked;
      return;
    }
    load(l);
    deps.redraw();
  };

  // A finished edit of the canvas's tools: one step of the painting (a new vector layer when none is picked).
  doc.subscribe((source) => {
    const s = deps.session();
    if (loading || source !== "do" || !s) return;
    const objs = stored(doc.ordered());
    const label = doc.lastTransaction?.label ?? "Edit";
    const l = layerId ? s.layers.get(layerId) : undefined;
    written = objs;
    if (isVector(l)) return s.replaceLayer({ ...l, objs }, label);
    const fresh = s.freshLayer({ kind: "object", objs }, nextName("Vector", [...s.layers.values()].map((x) => x.name)));
    layerId = fresh.id;
    adding = true;
    try {
      s.addLayer(fresh, label);
    } finally {
      adding = false;
    }
  });

  /** The Painting view's camera given to the canvas's view (the page's origin is the world's). */
  const syncCamera = (): void => {
    const { w, h } = deps.size();
    syncing = true;
    try {
      view.setViewport({ width: w, height: h });
      view.setCamera(cameraFor(deps.camera(), { width: w, height: h }));
    } finally {
      syncing = false;
    }
  };
  view.subscribe(() => {
    if (syncing) return;
    const c = view.camera;
    const scale = 2 ** (c.zi + c.zf);
    const { w, h } = deps.size();
    deps.setCamera({ scale, x: w / 2 - D.toNumber(c.center.x) * scale, y: h / 2 - D.toNumber(c.center.y) * scale });
  });

  editor.subscribe(deps.redraw);
  editor.subscribeRedraw(deps.redraw);

  const text = mountTextEditor(deps.stage, view, doc, editor, deps.fonts);
  for (const b of deps.stage.querySelectorAll<HTMLElement>('[data-testid="text-editor"]')) b.dataset["testid"] = "paint-text-editor"; // (the canvas's is "text-editor")
  attachTools(deps.el, view, doc, index, editor, {
    editText: (t, at, box) => text.open(t, at, box),
    toolForKey: (k) => toolForKey(k, "paint"),
    navForKey: () => undefined,
    navigate: () => undefined,
    focusSelection: () => undefined,
    labels: () => [],
    openSearch: () => undefined,
    revealList: deps.revealList,
    scope: "paint",
    history: { undo: () => deps.session()?.undo(), redo: () => deps.session()?.redo() },
    active: deps.active,
    keysActive: deps.keysActive,
    sample: deps.sample,
  });

  return {
    doc,
    editor,
    view,
    index,
    text,
    sync,
    syncCamera,
    /** The layer being edited, with what the gesture going on shows (a move, a resize): into a target placed by `at`. True: draw again soon. */
    drawLayer(id: string, g: CanvasRenderingContext2D, at: At): boolean | null {
      if (id !== layerId) return null;
      const vp = { width: g.canvas.width, height: g.canvas.height };
      return !!drawObjects(g, visibleObjects(doc, index, editor, fromLocal(doc.space.world, cameraFor(at, vp)), vp), deps.assets, vp, 1, deps.theme());
    },
    /** The canvas's overlays (selection, handles, nodes, what is being drawn) over the view, in CSS px. */
    drawOverlay(g: CanvasRenderingContext2D, dpr: number): void {
      if (!deps.active()) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const fc = view.frameCamera, vp = view.viewport;
      const vis = visibleObjects(doc, index, editor, fc, vp);
      const members = editor.entered.length ? visibleObjects(doc, index, editor, fc, vp, undefined, { entered: editor.entered, mode: "members" }) : [];
      const selected = editor.selection.size ? [...vis, ...members].filter((po) => editor.selection.has(po.obj.id)) : [];
      drawOverlays(g, selected, editor, fc, vp, deps.theme(), members);
    },
  };
}

export type VectorHost = ReturnType<typeof createVectorHost>;
