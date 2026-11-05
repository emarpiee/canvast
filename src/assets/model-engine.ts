import type { BufferGeometry, Light, Material, Mesh, Object3D, OrthographicCamera, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { extOf } from "./file-kind";
import { defaultLook, readLook } from "./model-look";
import type { ModelLook } from "./model-look";

// three.js, for what the app draws of a 3D model: one `ModelStage` draws a model with a look on its canvas, in a view and for a card alike.

type Three = typeof import("three");
let lib: Promise<Three> | null = null;
const three = (): Promise<Three> => (lib ??= import("three"));

/** The longer side of a model's picture on a new card, in pixels. */
export const MODEL_CARD_EDGE = 1600;
/** The shape of a new model card. */
const CARD_RATIO = 4 / 3;
/** Past this a model keeps its plain card, and asks before it opens: reading one is done on the page. */
export const MAX_MODEL_BYTES = 256 * 2 ** 20;

/** The look a model starts with: an STL is usually made with Z up, the rest with Y up. */
export const firstLook = (name: string): ModelLook => (extOf(name) === "STL" ? { up: "z" } : {});

/** The file's text decoded as `data:` addresses are: a glTF's buffers inside it (connect-src is closed, so nothing can be fetched, even that). */
function dataUrlBytes(url: string): ArrayBuffer | null {
  const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const text = m[1] ? atob(m[2]!) : decodeURIComponent(m[2]!);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out.buffer;
}

/** A model's objects from its file. Throws on what cannot be read. */
export async function readModel(bytes: Uint8Array, name: string): Promise<Object3D> {
  const T = await three();
  const data = bytes.slice().buffer as ArrayBuffer;
  const ext = extOf(name);
  const mesh = (g: BufferGeometry): Mesh => {
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    return new T.Mesh(g, new T.MeshStandardMaterial({ color: g.getAttribute("color") ? 0xffffff : 0xc8c3ba, roughness: 0.75, vertexColors: !!g.getAttribute("color"), side: T.DoubleSide }));
  };
  if (ext === "STL") return mesh(new (await import("three/examples/jsm/loaders/STLLoader.js")).STLLoader().parse(data));
  if (ext === "PLY") return mesh(new (await import("three/examples/jsm/loaders/PLYLoader.js")).PLYLoader().parse(data));
  if (ext === "OBJ") return new (await import("three/examples/jsm/loaders/OBJLoader.js")).OBJLoader().parse(new TextDecoder().decode(bytes));
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  // (the page may not fetch, so pictures are read by an image element, and buffers from the file's own text; what lies in other files cannot be reached)
  loader.register((parser) => {
    const p = parser as unknown as { textureLoader: unknown; fileLoader: unknown; options: { manager: import("three").LoadingManager } };
    p.textureLoader = new T.TextureLoader(p.options.manager);
    p.fileLoader = {
      load: (url: string, done: (b: ArrayBuffer) => void, _progress: unknown, failed: (e: Error) => void) => {
        const b = dataUrlBytes(url);
        if (b) done(b);
        else failed(new Error("its buffers are in another file: a single .glb or .gltf file is read"));
      },
      setPath: () => undefined,
    };
    return { name: "canvast-inside" };
  });
  return new Promise<Object3D>((done, failed) => loader.parse(ext === "GLB" ? data : new TextDecoder().decode(bytes), "", (g) => done(g.scene), failed));
}

/** Frees what a model holds on the graphics card. */
function free(root: Object3D): void {
  root.traverse((o) => {
    const m = o as Mesh;
    m.geometry?.dispose();
    for (const mat of ([] as Material[]).concat(m.material ?? [])) {
      for (const v of Object.values(mat)) (v as { isTexture?: boolean; dispose?: () => void } | null)?.isTexture && (v as { dispose(): void }).dispose();
      mat.dispose();
    }
  });
}

let graphics: boolean | null = null;
/** Asked once of a canvas of its own, as the library would say so as an error each time. */
function hasGraphics(): boolean {
  if (graphics === null) {
    const gl = document.createElement("canvas").getContext("webgl2");
    graphics = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return graphics;
}

/** A model, a look and a camera on a canvas. Drawn only when asked. */
export class ModelStage {
  private readonly T: Three;
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderer;
  private readonly scene: Scene;
  private readonly holder: Object3D;
  private model: Object3D | null = null;
  private lights: Light[] = [];
  private readonly own = new Map<Mesh, Material | Material[]>();
  private readonly plain: { clay: Material; flat: Material; wire: Material & { color: { set(c: string): void } } };
  private readonly persp: PerspectiveCamera;
  private readonly ortho: OrthographicCamera;
  private shownSurface = "";
  private constructor(T: Three, canvas: HTMLCanvasElement) {
    this.T = T;
    this.canvas = canvas;
    this.gl = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = T.PCFSoftShadowMap;
    this.scene = new T.Scene();
    this.holder = new T.Group();
    this.scene.add(this.holder);
    this.persp = new T.PerspectiveCamera();
    this.ortho = new T.OrthographicCamera();
    const clay = new T.MeshStandardMaterial({ roughness: 0.85, side: T.DoubleSide });
    const flat = new T.MeshBasicMaterial({ side: T.DoubleSide });
    const wire = new T.MeshBasicMaterial({ wireframe: true });
    this.plain = { clay, flat, wire };
  }

  /** Null when this browser or machine has no 3D graphics. */
  static async make(canvas = document.createElement("canvas")): Promise<ModelStage | null> {
    if (!hasGraphics()) return null;
    const T = await three();
    try {
      return new ModelStage(T, canvas);
    } catch {
      return null;
    }
  }

  /** Shows a model, in the middle, a unit across. The model is freed with the stage or the next one. */
  setModel(model: Object3D): void {
    if (this.model) (this.holder.remove(this.model), free(this.model));
    this.own.clear();
    this.shownSurface = "";
    const T = this.T;
    const box = new T.Box3().setFromObject(model);
    const c = box.getCenter(new T.Vector3());
    const size = box.getSize(new T.Vector3());
    const k = 1 / (Math.max(size.x, size.y, size.z) || 1);
    const g = new T.Group();
    model.position.sub(c);
    g.scale.setScalar(k);
    g.add(model);
    model.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        this.own.set(m, m.material);
        m.castShadow = m.receiveShadow = true;
      }
    });
    this.model = g;
    this.holder.add(g);
  }

  /** Lights stand round the model as lamps in a room: at a value of 0, in front of it, whatever the camera does. */
  private setLights(look: ModelLook): void {
    const T = this.T;
    for (const l of this.lights) (this.scene.remove(l), l.dispose());
    this.lights = [];
    const ambient = new T.AmbientLight(look["ambientColour"] as string, look["ambientPower"] as number);
    this.lights.push(ambient);
    this.scene.add(ambient);
    for (const k of ["key", "fill", "rim"]) {
      const type = look[`${k}Type`] as string;
      if (type === "off") continue;
      const colour = look[`${k}Colour`] as string, power = look[`${k}Power`] as number;
      const a = (look[`${k}Around`] as number) * (Math.PI / 180), h = (look[`${k}Height`] as number) * (Math.PI / 180);
      const at = new T.Vector3(Math.sin(a) * Math.cos(h), Math.sin(h), Math.cos(a) * Math.cos(h)).multiplyScalar(2.5);
      const l = type === "point" ? new T.PointLight(colour, power * 6, 0, 2) : type === "spot" ? new T.SpotLight(colour, power * 6, 0, Math.PI / 5, 0.4, 2) : new T.DirectionalLight(colour, power);
      l.position.copy(at);
      if (look["shadows"] && k === "key") {
        l.castShadow = true;
        l.shadow.mapSize.set(2048, 2048);
        l.shadow.bias = -0.0005;
        l.shadow.normalBias = 0.01;
        const cam = l.shadow.camera as OrthographicCamera;
        if (type === "sun") {
          cam.left = cam.bottom = -1.2;
          cam.right = cam.top = 1.2;
          cam.near = 0.1;
          cam.far = 6;
        }
      }
      this.lights.push(l);
      this.scene.add(l);
      if (type !== "point") this.scene.add((l as import("three").DirectionalLight).target);
    }
  }

  /** Draws, the canvas being `w` × `h` CSS px at `scale` pixels each. */
  draw(look: ModelLook, w: number, h: number, scale = 1): void {
    const T = this.T;
    this.gl.setPixelRatio(scale);
    this.gl.setSize(w, h, false);
    const bg = look["bg"] as string;
    this.gl.setClearColor(bg || 0x000000, bg ? 1 : 0);
    // Which way is up.
    this.holder.rotation.set(look["up"] === "z" ? -Math.PI / 2 : 0, 0, 0);
    // The surface.
    const surface = look["surface"] as string;
    const { clay, flat, wire } = this.plain;
    for (const m of [clay, flat, wire] as unknown as Array<{ color: { set(c: string): void } }>) m.color.set(look["colour"] as string);
    if (surface !== this.shownSurface) {
      this.shownSurface = surface;
      for (const [m, mat] of this.own) m.material = surface === "own" ? mat : surface === "clay" ? clay : surface === "flat" ? flat : wire;
    }
    this.setLights(look);
    // The camera, in spherical steps round the middle: the model is a unit across, fitted at a zoom of 1.
    const yaw = (look["yaw"] as number) * (Math.PI / 180), pitch = (look["pitch"] as number) * (Math.PI / 180), zoom = look["zoom"] as number;
    const dir = new T.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const aspect = w / Math.max(1, h);
    const fit = 0.9 / Math.min(1, aspect); // (the model's half-size that shows, at a zoom of 1)
    // (a slide moves the camera across and up as it looks, so it is the same on the screen from any side)
    const across = new T.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const upward = new T.Vector3().crossVectors(dir, across).negate();
    const target = across.multiplyScalar(look["panX"] as number).add(upward.multiplyScalar(look["panY"] as number));
    let camera: PerspectiveCamera | OrthographicCamera;
    if (look["lens"] === "ortho") {
      const half = (fit * 0.8) / zoom;
      Object.assign(this.ortho, { left: -half * aspect, right: half * aspect, top: half, bottom: -half, near: 0.01, far: 100 });
      this.ortho.updateProjectionMatrix();
      this.ortho.position.copy(dir.multiplyScalar(10)).add(target);
      camera = this.ortho;
    } else {
      // Focal length on a 36 mm film's height of 24.
      const vfov = 2 * Math.atan(12 / (look["focal"] as number));
      const dist = (fit * 0.8) / Math.tan(vfov / 2) / zoom;
      Object.assign(this.persp, { fov: (vfov * 180) / Math.PI, aspect, near: Math.max(0.001, dist / 200), far: dist * 50 + 50 });
      this.persp.updateProjectionMatrix();
      this.persp.position.copy(dir.multiplyScalar(dist)).add(target);
      camera = this.persp;
    }
    camera.lookAt(target);
    this.gl.render(this.scene, camera);
  }

  /** Lets go of the graphics card. */
  dispose(): void {
    if (this.model) free(this.model);
    this.plain.clay.dispose();
    this.plain.flat.dispose();
    this.plain.wire.dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
  }
}

/** The stage that draws cards and thumbnails, one at a time. */
let cardStage: Promise<ModelStage | null> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** A card's pixel size from a view of width over height. */
export const modelCardFit = (ratio: number): { w: number; h: number } => (ratio >= 1 ? { w: MODEL_CARD_EDGE, h: Math.max(1, Math.round(MODEL_CARD_EDGE / ratio)) } : { w: Math.max(1, Math.round(MODEL_CARD_EDGE * ratio)), h: MODEL_CARD_EDGE });

/** The picture of a model with a look, at `size` or else with its longer side `edge`. Null when it cannot be read or drawn. */
export function modelPicture(bytes: Uint8Array, name: string, o: { size?: { w: number; h: number } | undefined; edge?: number | undefined; preview?: string | undefined }): Promise<ImageBitmap | null> {
  if (bytes.length > MAX_MODEL_BYTES) return Promise.resolve(null);
  const run = async (): Promise<ImageBitmap | null> => {
    const stage = await (cardStage ??= ModelStage.make());
    if (!stage) return null;
    const edge = o.edge ?? MODEL_CARD_EDGE;
    const size = o.size ?? { w: edge, h: Math.round(edge / CARD_RATIO) };
    stage.setModel(await readModel(bytes, name));
    stage.draw(o.preview ? readLook(o.preview, firstLook(name)) : defaultLook(firstLook(name)), size.w, size.h);
    return createImageBitmap(stage.canvas, { premultiplyAlpha: "none" });
  };
  const done = queue.then(run, run).catch(() => null);
  queue = done;
  return done;
}
