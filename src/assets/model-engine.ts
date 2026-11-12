import type { AnimationClip, AnimationMixer, CanvasTexture, Light, Material, Mesh, MeshBasicMaterial, MeshNormalMaterial, MeshToonMaterial, Object3D, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, SkinnedMesh, WebGLRenderTarget, WebGLRenderer } from "three";
import { extOf } from "./file-kind";
import { defaultLook, readLook } from "./model-look";
import type { ModelLook } from "./model-look";
import type { LinesResult, TraceInput } from "./model-lines";
import { paintInk } from "./model-edges";
import type { Drawing, EdgeMesh, InkSpec, InkStyle, ToneKind } from "./model-edges";

// three.js, for what the app draws of a 3D model: one `ModelStage` draws a model with a look on its canvas, in a view and for a card alike.

type Three = typeof import("three");
let lib: Promise<Three> | null = null;
const three = (): Promise<Three> => (lib ??= import("three"));

/** The longer side of a model's picture on a new card, in pixels. */
export const MODEL_CARD_EDGE = 1600;
/** The shape of a new model card. */
const CARD_RATIO = 4 / 3;
/** Lines to find for a view, and how to paint them. */
interface InkJob {
  spec: InkSpec;
  key: string;
  look: ModelLook;
  w: number;
  h: number;
  paint: string;
}
/** What changes only how found lines are painted, not where they are. */
const LINE_PAINT = ["linesColour", "creaseColour", "hiddenColour", "hiddenOpacity", "hiddenDash", "toneColour"] as const;
/** Past this a model does not open: all of it has to be in memory, and on the graphics card. */
export const MAX_MODEL_BYTES = 2 ** 30;
/** A file that has more triangles than this is drawn at one pixel to a pixel while it is turned. */
const HEAVY_TRIANGLES = 2_000_000;

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

/** What a file holds: its objects, and the animations they can be posed in. */
export interface ReadModel {
  root: Object3D;
  clips: AnimationClip[];
}

interface WorkerPart {
  position: Float32Array;
  normal: Float32Array;
  color?: Float32Array;
  index?: Uint32Array | Uint16Array;
}
let workerUrl: Promise<string> | null = null;
/** A worker of the model's own (reading files, finding lines). */
const modelWorker = async (): Promise<Worker> => new Worker(await (workerUrl ??= import("./model-inside").then(({ workerText }) => URL.createObjectURL(new Blob([workerText], { type: "text/javascript" })))));
/** Reads a file off the page, in a worker of its own that goes when it is done. The bytes are given to it. */
async function readInWorker(bytes: Uint8Array, ext: string): Promise<WorkerPart[]> {
  const worker = await modelWorker();
  const data = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
  try {
    return await new Promise<WorkerPart[]>((done, failed) => {
      worker.onmessage = (e: MessageEvent<{ parts?: WorkerPart[]; error?: string }>) => (e.data.parts ? done(e.data.parts) : failed(new Error(e.data.error ?? "it could not be read")));
      worker.onerror = () => failed(new Error("it could not be read"));
      worker.postMessage({ data, ext }, [data as ArrayBuffer]);
    });
  } finally {
    worker.terminate();
  }
}

/** The lines of a view, worked out off the page. */
export async function linesInWorker(input: TraceInput): Promise<LinesResult> {
  const worker = await modelWorker();
  try {
    return await new Promise<LinesResult>((done, failed) => {
      worker.onmessage = (e: MessageEvent<{ result?: LinesResult; error?: string }>) => (e.data.result ? done(e.data.result) : failed(new Error(e.data.error ?? "its lines could not be read")));
      worker.onerror = () => failed(new Error("its lines could not be read"));
      worker.postMessage({ lines: input }, [input.mask.buffer as ArrayBuffer]);
    });
  } finally {
    worker.terminate();
  }
}

/** A model's objects from its file. Throws on what cannot be read. */
export async function readModel(bytes: Uint8Array, name: string): Promise<ReadModel> {
  const T = await three();
  const ext = extOf(name);
  if (ext === "STL" || ext === "PLY" || ext === "OBJ") {
    const parts = await readInWorker(bytes, ext);
    const root = new T.Group();
    for (const p of parts) {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(p.position, 3));
      g.setAttribute("normal", new T.BufferAttribute(p.normal, 3));
      if (p.color) g.setAttribute("color", new T.BufferAttribute(p.color, 3));
      if (p.index) g.setIndex(new T.BufferAttribute(p.index, 1));
      root.add(new T.Mesh(g, new T.MeshStandardMaterial({ color: p.color ? 0xffffff : 0xc8c3ba, roughness: 0.75, vertexColors: !!p.color, side: T.DoubleSide })));
    }
    return { root, clips: [] };
  }
  const data = (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer) as ArrayBuffer;
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
  return new Promise<ReadModel>((done, failed) => loader.parse(ext === "GLB" ? data : new TextDecoder().decode(bytes), "", (g) => done({ root: g.scene, clips: g.animations }), failed));
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

/** Finds lines at each pixel from a ring of its neighbours as far as the line's half width. */
const LINE_SHADER = `
  uniform sampler2D normals; uniform sampler2D depth; uniform vec2 texel; uniform float radius; uniform float near; uniform float far; uniform bool flatLens;
  uniform float outline; uniform float inner; varying vec2 vUv;
  float zAt(vec2 uv) {
    float d = texture2D(depth, uv).x;
    return flatLens ? d * (far - near) + near : (near * far) / (far - d * (far - near));
  }
  void main() {
    float d0 = texture2D(depth, vUv).x;
    vec3 n0 = texture2D(normals, vUv).xyz * 2.0 - 1.0;
    float z0 = zAt(vUv);
    float dd = 0.0, nn = 0.0;
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 0.5236;
      float r = radius * (mod(float(i), 2.0) < 0.5 ? 1.0 : 0.6);
      vec2 uv = vUv + vec2(cos(a), sin(a)) * r * texel;
      float d = texture2D(depth, uv).x;
      if ((d0 >= 1.0) != (d >= 1.0)) { dd = 10.0; continue; }
      if (d0 >= 1.0) continue;
      dd = max(dd, abs(zAt(uv) - z0));
      vec3 n = texture2D(normals, uv).xyz * 2.0 - 1.0;
      nn = max(nn, 1.0 - dot(n0, n));
    }
    // (a surface seen at a slant changes depth quickly without any edge)
    float slant = max(abs(n0.z), 0.12);
    float td = mix(0.25, 0.004, outline) / slant;
    float tn = mix(1.0, 0.03, inner);
    gl_FragColor = vec4(1.0, 1.0, 1.0, max(smoothstep(td, td * 1.5, dd), smoothstep(tn, tn * 1.5, nn)));
  }`;

/** A band of edges as wide as a line: narrowed where the line is thinner than the band (what stays is its middle), or widened where it is thicker. */
const LINE_DRAW_SHADER = `
  uniform sampler2D band; uniform vec2 texel; uniform float spread; uniform vec3 colour; varying vec2 vUv;
  void main() {
    float a = texture2D(band, vUv).a;
    float r = abs(spread);
    if (r > 0.25) {
      for (int i = 0; i < 12; i++) {
        float t = float(i) * 0.5236;
        vec2 off = vec2(cos(t), sin(t)) * texel;
        float far = texture2D(band, vUv + off * r).a, mid = texture2D(band, vUv + off * r * 0.5).a;
        a = spread < 0.0 ? min(a, min(far, mid)) : max(a, max(far, mid));
      }
    }
    gl_FragColor = vec4(colour, a);
    #include <colorspace_fragment>
  }`;

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
  private readonly plain: { clay: Material; flat: Material; wire: Material; tones: MeshToonMaterial; fill: MeshBasicMaterial };
  private clips: AnimationClip[] = [];
  private mixer: AnimationMixer | null = null;
  private shownTones = 0;
  private shownClip = -1;
  /** What the lights and the canvas were made for: made again only when it changes (a shadow map and a canvas's pixels are costly to make, and a drag draws each frame). */
  private shownLights = "";
  private shownSize = "";
  private shownPose = "";
  private lastCamera: PerspectiveCamera | OrthographicCamera | null = null;
  /** What the lines of a picture are found in: the surface's direction and how far it is, at each pixel. */
  private seen: WebGLRenderTarget | null = null;
  private seenNormals: MeshNormalMaterial | null = null;
  private lineQuad: { scene: Scene; camera: OrthographicCamera; mesh: Mesh<PlaneGeometry, ShaderMaterial>; find: ShaderMaterial; draw: ShaderMaterial } | null = null;
  /** The band of edges found, before it is made as wide as a line. */
  private edges: WebGLRenderTarget | null = null;
  /** A model of so many triangles that a drag should not also draw each at two pixels to one. */
  heavy = false;
  /** The view is being turned: its lines are found coarser, to keep up. */
  moving = false;
  /** Lines from the model's edges came for what is drawn: draw again to show them. */
  onInk: (() => void) | null = null;
  /** The lines from the model's edges: worked out in a worker that keeps the model, painted on a canvas laid over the picture. */
  private ink: {
    worker: Worker;
    /** The model's shape as the worker has it (its pose, which way is up). */
    sent: number;
    canvas: HTMLCanvasElement;
    texture: CanvasTexture;
    quad: { scene: Scene; camera: OrthographicCamera; mesh: Mesh<PlaneGeometry, MeshBasicMaterial> };
    /** What is on the canvas (a view and its paint), what is being found, what comes after it. */
    shown: { key: string; drawing: Drawing } | null;
    paint: string;
    busy: string;
    next: InkJob | null;
    asked: Map<number, { done(d: Drawing): void; failed(e: Error): void }>;
    settled: Array<() => void>;
    id: number;
  } | null = null;
  private inkMaking: Promise<NonNullable<ModelStage["ink"]>> | null = null;
  /** Each change of the model's shape (a model, a pose, which way is up). */
  private shape = 0;
  private wantedInk = "";
  private readonly persp: PerspectiveCamera;
  private readonly ortho: OrthographicCamera;
  private shownSurface = "";
  private constructor(T: Three, canvas: HTMLCanvasElement) {
    this.T = T;
    this.canvas = canvas;
    this.gl = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = T.PCFSoftShadowMap;
    this.gl.shadowMap.autoUpdate = false; // (shadows lie on the model: they change with the lights or the pose, not as the camera turns)
    this.scene = new T.Scene();
    this.holder = new T.Group();
    this.scene.add(this.holder);
    this.persp = new T.PerspectiveCamera();
    this.ortho = new T.OrthographicCamera();
    const clay = new T.MeshStandardMaterial({ roughness: 0.85, side: T.DoubleSide });
    const flat = new T.MeshBasicMaterial({ side: T.DoubleSide });
    const wire = new T.MeshBasicMaterial({ wireframe: true });
    this.plain = { clay, flat, wire, tones: new T.MeshToonMaterial({ side: T.DoubleSide }), fill: new T.MeshBasicMaterial({ side: T.DoubleSide }) };
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
  setModel({ root: model, clips }: ReadModel): void {
    if (this.model) (this.holder.remove(this.model), free(this.model));
    this.mixer?.stopAllAction();
    this.mixer?.uncacheRoot(this.mixer.getRoot());
    this.own.clear();
    this.gl.shadowMap.needsUpdate = true;
    this.shownSurface = "";
    this.clips = clips;
    this.shownClip = -1;
    this.mixer = clips.length ? new this.T.AnimationMixer(model) : null;
    const T = this.T;
    const box = new T.Box3().setFromObject(model);
    const c = box.getCenter(new T.Vector3());
    const size = box.getSize(new T.Vector3());
    const k = 1 / (Math.max(size.x, size.y, size.z) || 1);
    const g = new T.Group();
    model.position.sub(c);
    g.scale.setScalar(k);
    g.add(model);
    let triangles = 0;
    model.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        triangles += (m.geometry.index?.count ?? m.geometry.getAttribute("position")?.count ?? 0) / 3;
        this.own.set(m, m.material);
        m.castShadow = m.receiveShadow = true;
      }
    });
    this.heavy = triangles > HEAVY_TRIANGLES;
    this.model = g;
    this.holder.add(g);
    this.shape++;
    if (this.ink) this.ink.shown = null;
  }

  /** Lights stand round the model as lamps in a room: at a value of 0, in front of it, whatever the camera does. */
  private setLights(look: ModelLook): void {
    const T = this.T;
    const made = JSON.stringify(["key", "fill", "rim"].flatMap((k) => ["Type", "Colour", "Power", "Around", "Height"].map((n) => look[`${k}${n}`])).concat(look["ambientColour"]!, look["ambientPower"]!, look["shadows"]!));
    if (made === this.shownLights) return;
    this.shownLights = made;
    this.gl.shadowMap.needsUpdate = true;
    for (const l of this.lights) {
      this.scene.remove(l);
      const target = (l as Light & { target?: Object3D }).target;
      if (target) this.scene.remove(target);
      l.dispose();
    }
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
    const size = `${w}x${h}@${scale}`;
    if (size !== this.shownSize) {
      this.shownSize = size;
      this.gl.setPixelRatio(scale);
      this.gl.setSize(w, h, false);
    }
    const bg = look["bg"] as string;
    this.gl.setClearColor(bg || 0x000000, bg ? 1 : 0);
    // Which way is up.
    const upX = look["up"] === "z" ? -Math.PI / 2 : 0;
    if (this.holder.rotation.x !== upX) {
      this.holder.rotation.set(upX, 0, 0);
      this.gl.shadowMap.needsUpdate = true;
      this.shape++;
    }
    // The surface.
    const show = look["linesShow"] as string;
    // (on a fill, the model is one flat colour under its lines)
    const surface = show === "flat" ? "fill" : (look["surface"] as string);
    const { clay, flat, wire, tones, fill } = this.plain;
    fill.color.set(look["linesFill"] as string);
    for (const m of [clay, flat, wire, tones] as unknown as Array<{ color: { set(c: string): void } }>) m.color.set(look["colour"] as string);
    if (surface === "tones" && look["tones"] !== this.shownTones) {
      // Light falls into this many flat steps of value.
      this.shownTones = look["tones"] as number;
      tones.gradientMap?.dispose();
      const steps = Uint8Array.from({ length: this.shownTones }, (_, i) => Math.round((255 * (i + 0.5)) / this.shownTones));
      const map = new T.DataTexture(steps, this.shownTones, 1, T.RedFormat);
      map.minFilter = map.magFilter = T.NearestFilter;
      map.needsUpdate = true;
      tones.gradientMap = map;
      tones.needsUpdate = true;
    }
    if (surface !== this.shownSurface) {
      this.shownSurface = surface;
      this.gl.shadowMap.needsUpdate = true;
      for (const [m, mat] of this.own) m.material = surface === "own" ? mat : surface === "clay" ? clay : surface === "tones" ? tones : surface === "flat" ? flat : surface === "fill" ? fill : wire;
    }
    // The pose: one moment of one of its animations.
    if (this.mixer) {
      const c = Math.min(this.clips.length - 1, look["clip"] as number);
      if (c !== this.shownClip) {
        this.mixer.stopAllAction();
        this.mixer.clipAction(this.clips[c]!).play();
        this.shownClip = c;
      }
      const pose = `${c}@${look["poseTime"]}`;
      if (pose !== this.shownPose) {
        this.shownPose = pose;
        this.mixer.setTime(Math.min(look["poseTime"] as number, this.clips[c]!.duration * 0.9999)); // (at its very end it would loop back to its start)
        this.gl.shadowMap.needsUpdate = true;
        this.shape++;
      }
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
    camera.updateMatrixWorld();
    this.lastCamera = camera;
    if (show !== "only") this.gl.render(this.scene, camera);
    else this.gl.clear();
    this.wantedInk = "";
    if (show === "off") return;
    if (look["linesBy"] === "picture") return this.drawLines(look, camera, show === "only");
    if (w < 8 || h < 8) return; // (not laid out yet)
    // From its edges: what was found last shows until what is in view now comes.
    const px = this.gl.getDrawingBufferSize(new T.Vector2());
    const quick = this.moving ? 0.5 : 1;
    const spec = this.inkSpec(look, camera, Math.max(1, Math.round(px.x * quick)), Math.max(1, Math.round(px.y * quick)), this.moving, false);
    this.wantInk(spec, look, px.x, px.y);
  }

  /** What the worker needs to find a view's lines from the model's edges, at `w` × `h` pixels. */
  private inkSpec(look: ModelLook, camera: PerspectiveCamera | OrthographicCamera, w: number, h: number, quick: boolean, fill: boolean): InkSpec {
    const T = this.T;
    const px = h / 800; // (sizes are for a picture 800 pixels tall: the same drawing at any size)
    const lights: InkSpec["lights"] = ["key", "fill", "rim"]
      .filter((k) => look[`${k}Type`] !== "off")
      .map((k) => {
        const a = (look[`${k}Around`] as number) * (Math.PI / 180), e = (look[`${k}Height`] as number) * (Math.PI / 180);
        return { dir: [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)] as const, power: (look[`${k}Power`] as number) / 3.5 };
      });
    const toCamera = camera.getWorldDirection(new T.Vector3()).negate();
    return {
      w, h, view: [...camera.matrixWorldInverse.elements], proj: [...camera.projectionMatrix.elements], persp: camera === this.persp, near: camera.near,
      camPos: [camera.position.x, camera.position.y, camera.position.z], camDir: [toCamera.x, toCamera.y, toCamera.z], quick,
      outline: !!look["linesOuter"], outlineWidth: (look["linesWidth"] as number) * px,
      creases: !!look["linesCreases"], creaseWidth: (look["creaseWidth"] as number) * px, creaseAngle: look["creaseAngle"] as number,
      hidden: !!look["hiddenShow"],
      tones: look["toneMode"] as ToneKind, toneSpacing: (look["toneSpacing"] as number) * px, toneStrength: (look["toneStrength"] as number) / 100, toneWidth: (look["toneWidth"] as number) * px, toneAngle: look["toneAngle"] as number,
      sketch: (look["sketch"] as number) * px, fade: (look["depthFade"] as number) / 100, weight: !!look["depthWeight"],
      lights, ambient: (look["ambientPower"] as number) / 3, fill,
    };
  }

  /** How a view's lines are painted, at `h` pixels tall. */
  static inkStyle(look: ModelLook, h: number, fill: boolean): InkStyle {
    return {
      contour: look["linesColour"] as string, crease: look["creaseColour"] as string, hidden: look["hiddenColour"] as string,
      hiddenOpacity: (look["hiddenOpacity"] as number) / 100, hiddenDash: ((look["hiddenDash"] as number) * h) / 800, tone: look["toneColour"] as string,
      fill: fill && look["linesShow"] === "flat" ? (look["linesFill"] as string) : undefined,
    };
  }

  /** The model's triangles where they stand now (posed, turned up), for the worker. */
  private edgeMesh(): EdgeMesh {
    const T = this.T;
    this.scene.updateMatrixWorld(true);
    const meshes: Mesh[] = [];
    this.model?.traverseVisible((o) => void ((o as Mesh).isMesh && meshes.push(o as Mesh)));
    let corners = 0, count = 0;
    for (const m of meshes) {
      corners += m.geometry.getAttribute("position")?.count ?? 0;
      count += m.geometry.index?.count ?? m.geometry.getAttribute("position")?.count ?? 0;
    }
    const pos = new Float32Array(corners * 3), faces = new Uint32Array(count - (count % 3));
    const v = new T.Vector3();
    let at = 0, f = 0;
    for (const m of meshes) {
      const p = m.geometry.getAttribute("position");
      if (!p) continue;
      (m as SkinnedMesh).skeleton?.update();
      const e = m.matrixWorld.elements, plain = !(m as SkinnedMesh).isSkinnedMesh && !m.geometry.morphAttributes["position"]?.length;
      for (let i = 0; i < p.count; i++) {
        if (plain) v.set(p.getX(i), p.getY(i), p.getZ(i));
        else m.getVertexPosition(i, v);
        pos[(at + i) * 3] = e[0]! * v.x + e[4]! * v.y + e[8]! * v.z + e[12]!;
        pos[(at + i) * 3 + 1] = e[1]! * v.x + e[5]! * v.y + e[9]! * v.z + e[13]!;
        pos[(at + i) * 3 + 2] = e[2]! * v.x + e[6]! * v.y + e[10]! * v.z + e[14]!;
      }
      const idx = m.geometry.index, n = (idx?.count ?? p.count) - ((idx?.count ?? p.count) % 3);
      for (let i = 0; i < n && f < faces.length; i++) faces[f++] = at + (idx ? idx.getX(i) : i);
      at += p.count;
    }
    return { pos, faces: faces.subarray(0, f - (f % 3)) };
  }

  /** The worker, the canvas of lines and what lays it over the picture: made once, when lines from edges are first asked for. */
  private async inkParts(): Promise<NonNullable<ModelStage["ink"]>> {
    if (this.ink) return this.ink;
    return (this.inkMaking ??= (async () => {
      const T = this.T;
      const worker = await modelWorker();
      const canvas = document.createElement("canvas");
      const texture = new T.CanvasTexture(canvas);
      texture.colorSpace = T.SRGBColorSpace;
      const mesh = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
      mesh.position.z = -1; // (in front of the camera, past its near side)
      const scene = new T.Scene();
      scene.add(mesh);
      const ink: NonNullable<ModelStage["ink"]> = { worker, sent: -1, canvas, texture, quad: { scene, camera: new T.OrthographicCamera(), mesh }, shown: null, paint: "", busy: "", next: null, asked: new Map(), settled: [], id: 0 };
      worker.onmessage = (e: MessageEvent<{ drawing?: Drawing; error?: string; id: number }>) => {
        const asked = ink.asked.get(e.data.id);
        ink.asked.delete(e.data.id);
        if (e.data.drawing) asked?.done(e.data.drawing);
        else asked?.failed(new Error(e.data.error ?? "its lines could not be drawn"));
      };
      worker.onerror = () => {
        for (const a of ink.asked.values()) a.failed(new Error("its lines could not be drawn"));
        ink.asked.clear();
      };
      this.ink = ink;
      return ink;
    })());
  }

  /** The lines of a view from the model's edges, found off the page. */
  private async askInk(spec: InkSpec): Promise<Drawing> {
    const ink = await this.inkParts();
    if (ink.sent !== this.shape) {
      ink.sent = this.shape;
      const mesh = this.edgeMesh();
      ink.worker.postMessage({ mesh }, [mesh.pos.buffer, mesh.faces.buffer]);
    }
    const id = ++ink.id;
    return new Promise<Drawing>((done, failed) => {
      ink.asked.set(id, { done, failed });
      ink.worker.postMessage({ ink: spec, id });
    });
  }

  /** Shows the lines of this view: those found last, until these come (one is found at a time; only the latest waits). */
  private wantInk(spec: InkSpec, look: ModelLook, w: number, h: number): void {
    const key = JSON.stringify([this.shape, spec]);
    const paint = JSON.stringify([key, LINE_PAINT.map((k) => look[k]), w, h]);
    this.wantedInk = key;
    const ink = this.ink;
    // What was found last, while these are found: only at this size (stretched, it would not lie on the model).
    if (ink?.shown && ink.canvas.width === w && ink.canvas.height === h) {
      // (only its colours changed: painted again from what was found)
      if (ink.shown.key === key && ink.paint !== paint) this.paintInkCanvas(ink, ink.shown.drawing, look, w, h, paint);
      this.layInk(ink);
    }
    const job: InkJob = { spec, key, look, w, h, paint };
    if (!ink) {
      // (the first: the worker is still being made; the latest asked for goes when it is)
      const first = !this.firstInk;
      this.firstInk = job;
      if (first)
        void this.inkParts().then(() => {
          const j = this.firstInk;
          this.firstInk = null;
          if (j) this.findInk(j);
        });
      return;
    }
    if (ink.shown?.key === key || ink.busy === key) return this.inkSettledIf();
    if (ink.busy) ink.next = job;
    else this.findInk(job);
  }
  private firstInk: InkJob | null = null;

  private findInk(job: InkJob): void {
    void this.inkParts().then((ink) => {
      ink.busy = job.key;
      const after = (): void => {
        ink.busy = "";
        const next = ink.next;
        ink.next = null;
        if (next && next.key !== ink.shown?.key) this.findInk(next);
        else this.inkSettledIf(true);
      };
      this.askInk(job.spec).then(
        (d) => {
          ink.shown = { key: job.key, drawing: d };
          this.paintInkCanvas(ink, d, job.look, job.w, job.h, job.paint);
          after();
          this.onInk?.();
        },
        after,
      );
    });
  }

  /** Paints what was found on the canvas laid over the picture, at its pixels. */
  private paintInkCanvas(ink: NonNullable<ModelStage["ink"]>, d: Drawing, look: ModelLook, w: number, h: number, paint: string): void {
    ink.paint = paint;
    if (ink.canvas.width !== w || ink.canvas.height !== h) {
      ink.canvas.width = w;
      ink.canvas.height = h;
      // (a texture keeps the size it was made at: a new one for the new size)
      ink.texture.dispose();
      ink.texture = new this.T.CanvasTexture(ink.canvas);
      ink.texture.colorSpace = this.T.SRGBColorSpace;
      ink.quad.mesh.material.map = ink.texture;
    }
    const g = ink.canvas.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(w / d.w, 0, 0, h / d.h, 0, 0);
    paintInk(g, d, ModelStage.inkStyle(look, d.h, false));
    ink.texture.needsUpdate = true;
  }

  /** Lays the canvas of lines over what was drawn. */
  private layInk(ink: NonNullable<ModelStage["ink"]>): void {
    const auto = this.gl.autoClear;
    this.gl.autoClear = false;
    this.gl.render(ink.quad.scene, ink.quad.camera);
    this.gl.autoClear = auto;
  }

  /** Lets those waiting for the lines go once nothing is being found. */
  private inkSettledIf(anyway = false): void {
    const ink = this.ink;
    if (!ink || ink.busy || (!anyway && ink.shown?.key !== this.wantedInk)) return;
    const list = ink.settled;
    ink.settled = [];
    for (const f of list) f();
  }

  /** The lines of what was last drawn are on it (or it has none to find). */
  get inkCurrent(): boolean {
    return !this.wantedInk || (!!this.ink && !this.ink.busy && this.ink.shown?.key === this.wantedInk);
  }

  /** Resolves when the lines of what was last drawn have come (at once when there are none to find). */
  inkSettled(): Promise<void> {
    const ink = this.ink;
    if (!this.wantedInk || (ink && !ink.busy && ink.shown?.key === this.wantedInk)) return Promise.resolve();
    if (!ink) return this.inkParts().then(() => this.inkSettled());
    return new Promise((done) => ink.settled.push(done));
  }

  /** A view's lines from the model's edges at `w` × `h` (for placing on a canvas or a file): the last drawn camera, exactly, with the faces in sight for a fill. */
  async inkOf(look: ModelLook, w: number, h: number): Promise<Drawing | null> {
    const camera = this.lastCamera;
    if (!camera || !this.model) return null;
    return this.askInk(this.inkSpec(look, camera, w, h, false, look["linesShow"] === "flat"));
  }

  /** Renders the surface's direction and depth into `seen`, at this canvas's size. */
  private renderSeen(camera: PerspectiveCamera | OrthographicCamera, at?: { x: number; y: number }): WebGLRenderTarget {
    const T = this.T;
    const size = at ?? this.gl.getDrawingBufferSize(new T.Vector2());
    if (!this.seen || this.seen.width !== size.x || this.seen.height !== size.y) {
      this.seen?.depthTexture?.dispose();
      this.seen?.dispose();
      this.seen = new T.WebGLRenderTarget(size.x, size.y, { depthTexture: new T.DepthTexture(size.x, size.y), minFilter: T.NearestFilter, magFilter: T.NearestFilter });
    }
    this.seenNormals ??= new T.MeshNormalMaterial({ side: T.DoubleSide });
    const clear = this.gl.getClearColor(new T.Color()), alpha = this.gl.getClearAlpha();
    this.gl.setRenderTarget(this.seen);
    this.gl.setClearColor(0x000000, 0);
    this.gl.clear();
    this.scene.overrideMaterial = this.seenNormals;
    this.gl.render(this.scene, camera);
    this.scene.overrideMaterial = null;
    this.gl.setRenderTarget(null);
    this.gl.setClearColor(clear, alpha);
    return this.seen;
  }

  /** Line art over what is on the canvas: where depth or the surface's direction jumps between neighbouring pixels. Its cost follows the picture, not the triangles. */
  private drawLines(look: ModelLook, camera: PerspectiveCamera | OrthographicCamera, only: boolean): void {
    const quad = this.lineQuadFor(look, camera, this.renderSeen(camera));
    const auto = this.gl.autoClear;
    if (only) this.gl.clear();
    this.gl.autoClear = false;
    this.gl.render(quad.scene, quad.camera);
    this.gl.autoClear = auto;
  }

  /** The pass that finds lines, set for this look and what was seen. */
  private lineQuadFor(look: ModelLook, camera: PerspectiveCamera | OrthographicCamera, seen: WebGLRenderTarget): { scene: Scene; camera: OrthographicCamera; mesh: Mesh<PlaneGeometry, ShaderMaterial> } {
    const T = this.T;
    if (!this.lineQuad) {
      const vertexShader = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
      const draw = new T.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { band: { value: null }, texel: { value: new T.Vector2() }, spread: { value: 0 }, colour: { value: new T.Color() } },
        vertexShader,
        fragmentShader: LINE_DRAW_SHADER,
      });
      const find = new T.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: { normals: { value: null }, depth: { value: null }, texel: { value: new T.Vector2() }, radius: { value: 1 }, near: { value: 1 }, far: { value: 10 }, flatLens: { value: false }, outline: { value: 0.5 }, inner: { value: 0.5 } },
        vertexShader,
        fragmentShader: LINE_SHADER,
      });
      const mesh = new T.Mesh(new T.PlaneGeometry(2, 2), find);
      const scene = new T.Scene();
      scene.add(mesh);
      this.lineQuad = { scene, camera: new T.OrthographicCamera(), mesh, find, draw };
    }
    const quad = this.lineQuad;
    if (!this.edges || this.edges.width !== seen.width || this.edges.height !== seen.height) {
      this.edges?.dispose();
      this.edges = new T.WebGLRenderTarget(seen.width, seen.height);
    }
    const u = quad.find.uniforms as Record<string, { value: unknown }>;
    u["normals"]!.value = seen.texture;
    u["depth"]!.value = seen.depthTexture;
    (u["texel"]!.value as { set(x: number, y: number): void }).set(1 / seen.width, 1 / seen.height);
    // (sizes are for a picture 800 pixels tall: the same drawing at any size)
    const toPixels = seen.height / 800;
    const reach = Math.max(1, (look["linesReach"] as number) * toPixels);
    u["radius"]!.value = reach;
    u["near"]!.value = camera.near;
    u["far"]!.value = camera.far;
    u["flatLens"]!.value = camera === this.ortho;
    u["outline"]!.value = look["linesOutline"];
    u["inner"]!.value = look["linesInner"];
    // First the band of edges, as far either side as the reach; then that band made as wide as a line. So what is found does not depend on how wide it is drawn.
    const was = this.gl.getRenderTarget(), clear = this.gl.getClearColor(new T.Color()), alpha = this.gl.getClearAlpha(), auto = this.gl.autoClear;
    quad.mesh.material = quad.find;
    this.gl.setRenderTarget(this.edges);
    this.gl.setClearColor(0x000000, 0);
    this.gl.autoClear = true;
    this.gl.render(quad.scene, quad.camera);
    this.gl.setRenderTarget(was);
    this.gl.setClearColor(clear, alpha);
    this.gl.autoClear = auto;
    const d = quad.draw.uniforms as Record<string, { value: unknown }>;
    d["band"]!.value = this.edges.texture;
    (d["texel"]!.value as { set(x: number, y: number): void }).set(1 / seen.width, 1 / seen.height);
    d["spread"]!.value = ((look["linesWidth"] as number) * toPixels) / 2 - reach;
    (d["colour"]!.value as { set(c: string): void }).set(look["linesColour"] as string);
    quad.mesh.material = quad.draw;
    return quad;
  }

  /** The line art of the view last drawn, as a mask of `w` × `h` (the same shape as the canvas): the very lines it shows. Top row first; flipped when the view is mirrored. */
  linesMask(look: ModelLook, w: number, h: number): Uint8Array | null {
    const T = this.T, camera = this.lastCamera;
    if (!camera || !this.model) return null;
    const seen = this.renderSeen(camera, { x: w, y: h });
    const quad = this.lineQuadFor(look, camera, seen);
    const target = new T.WebGLRenderTarget(w, h, { minFilter: T.NearestFilter, magFilter: T.NearestFilter });
    const clear = this.gl.getClearColor(new T.Color()), alpha = this.gl.getClearAlpha(), auto = this.gl.autoClear;
    this.gl.setRenderTarget(target);
    this.gl.setClearColor(0x000000, 0);
    this.gl.clear();
    this.gl.autoClear = false;
    this.gl.render(quad.scene, quad.camera);
    this.gl.autoClear = auto;
    const bytes = new Uint8Array(w * h * 4);
    this.gl.readRenderTargetPixels(target, 0, 0, w, h, bytes);
    this.gl.setRenderTarget(null);
    this.gl.setClearColor(clear, alpha);
    target.dispose();
    const mask = new Uint8Array(w * h), mirror = !!look["mirror"];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) mask[y * w + (mirror ? w - 1 - x : x)] = bytes[((h - 1 - y) * w + x) * 4 + 3]! > 127 ? 1 : 0;
    return mask;
  }

  /** The canvas's size in pixels. */
  get pixels(): { w: number; h: number } {
    const z = this.gl.getDrawingBufferSize(new this.T.Vector2());
    return { w: z.x, h: z.y };
  }

  /** Lets go of the graphics card. */
  dispose(): void {
    if (this.model) free(this.model);
    this.plain.clay.dispose();
    this.plain.flat.dispose();
    this.plain.wire.dispose();
    this.plain.tones.gradientMap?.dispose();
    this.plain.tones.dispose();
    this.plain.fill.dispose();
    if (this.ink) {
      this.ink.worker.terminate();
      this.ink.texture.dispose();
      this.ink.quad.mesh.geometry.dispose();
      this.ink.quad.mesh.material.dispose();
      for (const f of this.ink.settled) f();
    }
    this.seen?.depthTexture?.dispose();
    this.seen?.dispose();
    this.seenNormals?.dispose();
    this.edges?.dispose();
    this.lineQuad?.mesh.geometry.dispose();
    this.lineQuad?.find.dispose();
    this.lineQuad?.draw.dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
  }
}

/** The stage that draws cards and thumbnails, one at a time; its model stays read a little, for a card's next size, and it all goes when it falls idle. */
let cardStage: { stage: ModelStage | null; hash: string; timer: ReturnType<typeof setTimeout> } | null = null;
let queue: Promise<unknown> = Promise.resolve();
const CARD_STAGE_IDLE_MS = 15_000;
/** Past this a model has a plain card (it can still be opened): reading one is done on the page. */
const MAX_CARD_MODEL_BYTES = 2 ** 29;
const dropCardStage = (): void => {
  cardStage?.stage?.dispose();
  if (cardStage) clearTimeout(cardStage.timer);
  cardStage = null;
};

/** A card's pixel size from a view of width over height. */
export const modelCardFit = (ratio: number): { w: number; h: number } => (ratio >= 1 ? { w: MODEL_CARD_EDGE, h: Math.max(1, Math.round(MODEL_CARD_EDGE / ratio)) } : { w: Math.max(1, Math.round(MODEL_CARD_EDGE * ratio)), h: MODEL_CARD_EDGE });

/** The picture of a model with a look, at `size` or else with its longer side `edge`. Null when it cannot be read or drawn. */
export function modelPicture(read: () => Promise<Uint8Array>, name: string, o: { hash?: string | undefined; fileSize?: number | undefined; size?: { w: number; h: number } | undefined; edge?: number | undefined; preview?: string | undefined }): Promise<ImageBitmap | null> {
  if ((o.fileSize ?? 0) > MAX_CARD_MODEL_BYTES) return Promise.resolve(null); // (known without reading it)
  const run = async (): Promise<ImageBitmap | null> => {
    if (!cardStage) cardStage = { stage: await ModelStage.make(), hash: "", timer: setTimeout(() => undefined, 0) };
    const held = cardStage;
    clearTimeout(held.timer);
    held.timer = setTimeout(dropCardStage, CARD_STAGE_IDLE_MS);
    const stage = held.stage;
    if (!stage) return null;
    if (!o.hash || held.hash !== o.hash) {
      const bytes = await read();
      if (bytes.length > MAX_CARD_MODEL_BYTES) return null;
      stage.setModel(await readModel(bytes, name));
      held.hash = o.hash ?? "";
    }
    const edge = o.edge ?? MODEL_CARD_EDGE;
    const size = o.size ?? { w: edge, h: Math.round(edge / CARD_RATIO) };
    const look = o.preview ? readLook(o.preview, firstLook(name)) : defaultLook(firstLook(name));
    stage.draw(look, size.w, size.h);
    // (lines from the model's edges come from its worker: drawn again with them)
    if (look["linesShow"] !== "off" && look["linesBy"] !== "picture") {
      await stage.inkSettled();
      stage.draw(look, size.w, size.h);
    }
    if (!look["mirror"]) return createImageBitmap(stage.canvas, { premultiplyAlpha: "none" });
    const flipped = document.createElement("canvas");
    flipped.width = size.w;
    flipped.height = size.h;
    const g = flipped.getContext("2d")!;
    g.scale(-1, 1);
    g.drawImage(stage.canvas, -size.w, 0);
    return createImageBitmap(flipped);
  };
  const done = queue.then(run, run).catch(() => null);
  queue = done;
  return done;
}
