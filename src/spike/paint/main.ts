/**
 * SPIKE (P0 of the Painting view): the brush engine as WebAssembly, measured where it will run. Opened from file:// with
 * the app's CSP plus 'wasm-unsafe-eval'. Everything is driven through `window.__spikePaint` by scripts/spike-paint-measure.mjs.
 */
/** The engine's builds, base64: release (speed), small (size), simd (release with WebAssembly SIMD). */
declare const WASM: Record<"release" | "small" | "simd", string>;
const WASM_RELEASE = WASM.release;
type Build = keyof typeof WASM;

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  layer_new(): number;
  stroke_begin(layer: number, json: number, len: number, lock: number): number;
  stroke_push(pts: number, n: number): number;
  stroke_end(): number;
  dirty_ptr(): number;
  read_rgba8(layer: number, x: number, y: number, w: number, h: number, out: number): number;
  abr_roundtrip(n: number): number;
}

const bytesOf = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const pct = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? 0;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { p50: r(at(50)), p95: r(at(95)), max: r(s[s.length - 1] ?? 0) };
};

/** A thin handle on one instance (the same code runs in the worker). */
function engine(x: Exports) {
  const enc = new TextEncoder();
  let pts = 0, ptsCap = 0, px = 0, pxCap = 0;
  const room = (need: number, ptr: number, cap: number): [number, number] => (need <= cap ? [ptr, cap] : (ptr && x.dealloc(ptr, cap), [x.alloc(need), need]));
  return {
    x,
    layer: () => x.layer_new(),
    begin(layer: number, brush: object, lock = false): void {
      const j = enc.encode(JSON.stringify(brush));
      const p = x.alloc(j.length);
      new Uint8Array(x.memory.buffer, p, j.length).set(j);
      const r = x.stroke_begin(layer, p, j.length, lock ? 1 : 0);
      x.dealloc(p, j.length);
      if (r !== 0) throw new Error(`stroke_begin ${r}`);
    },
    /** Push points (7 floats each); returns the changed rectangle or null. */
    push(f: Float32Array): [number, number, number, number] | null {
      [pts, ptsCap] = room(f.byteLength, pts, ptsCap);
      new Float32Array(x.memory.buffer, pts, f.length).set(f);
      return x.stroke_push(pts, f.length / 7) === 1 ? this.dirty() : null;
    },
    end: () => (x.stroke_end() === 1 ? [...new Int32Array(x.memory.buffer, x.dirty_ptr(), 4)] as [number, number, number, number] : null),
    dirty: () => [...new Int32Array(x.memory.buffer, x.dirty_ptr(), 4)] as [number, number, number, number],
    /** The pixels of a rectangle, copied out of the engine's memory. */
    read(layer: number, r: [number, number, number, number]): ImageData {
      const w = r[2] - r[0], h = r[3] - r[1];
      [px, pxCap] = room(w * h * 4, px, pxCap);
      x.read_rgba8(layer, r[0], r[1], w, h, px);
      return new ImageData(new Uint8ClampedArray(x.memory.buffer.slice(px, px + w * h * 4)), w, h);
    },
  };
}
type Engine = ReturnType<typeof engine>;

/** A zigzag across a page, `n` points `step` px apart, pressure going up and down: 7 floats a point. */
function zigzag(n: number, step: number, w: number, h: number, t0 = 0): Float32Array {
  const f = new Float32Array(n * 7);
  let x = 40, y = 40, dx = step, row = 0;
  for (let i = 0; i < n; i++) {
    f.set([x, y, 0.5 + 0.5 * Math.sin(i / 20), 0, 0, 0, t0 + i * 4], i * 7);
    x += dx;
    if (x > w - 40 || x < 40) {
      dx = -dx;
      x += dx;
      y += 60 + (row++ % 3) * 7;
      if (y > h - 40) y = 40;
    }
  }
  return f;
}

const brush = (size: number) => ({ size, hardness: 0.5, spacing: 0.1, opacity: 1, flow: 1, color: [0.1, 0.3, 0.8, 1] });

async function instantiate(b64: string): Promise<{ eng: Engine; compileMs: number; instMs: number; module: WebAssembly.Module }> {
  const t0 = performance.now();
  const module = await WebAssembly.compile(bytesOf(b64) as BufferSource);
  const t1 = performance.now();
  const inst = await WebAssembly.instantiate(module, {});
  const t2 = performance.now();
  return { eng: engine(inst.exports as unknown as Exports), compileMs: t1 - t0, instMs: t2 - t1, module };
}

/** Worker source: the same `engine` handle, fed chunks; answers with the changed pixels, transferred. */
const WORKER = `
const engine = ${engine.toString()};
let e = null, layer = 0;
onmessage = async (m) => {
  const d = m.data;
  if (d.type === "init") { const inst = await WebAssembly.instantiate(d.module, {}); e = engine(inst.exports); layer = e.layer(); postMessage({ type: "ready" }); return; }
  if (d.type === "begin") { e.begin(layer, d.brush); return; }
  if (d.type === "push") {
    const r = e.push(d.pts);
    if (!r) { postMessage({ type: "px", id: d.id, r: null }); return; }
    const img = e.read(layer, r);
    postMessage({ type: "px", id: d.id, r, buf: img.data.buffer }, [img.data.buffer]);
    return;
  }
  if (d.type === "end") { e.end(); postMessage({ type: "ended" }); }
};`;

const spike = {
  /** Compile and instantiate both builds; the file sizes as inlined. */
  async load() {
    const out: Record<string, unknown> = {};
    for (const [name, b64] of Object.entries(WASM)) {
      const { compileMs, instMs } = await instantiate(b64);
      out[name] = { kib: Math.round(bytesOf(b64).length / 1024), base64Kib: Math.round(b64.length / 1024), compileMs: Math.round(compileMs * 10) / 10, instMs: Math.round(instMs * 10) / 10 };
    }
    return out;
  },

  /** Dabs per second: one long stroke per brush size on a 4000 × 3000 page, in one push and in frame-sized pushes. */
  async throughput(which: Build = "release") {
    const { eng } = await instantiate(WASM[which]);
    const rows: unknown[] = [];
    for (const size of [10, 50, 200, 500]) {
      const layer = eng.layer();
      const n = size >= 200 ? 600 : 2000;
      const pts = zigzag(n, 8, 4000, 3000);
      const t0 = performance.now();
      eng.begin(layer, brush(size));
      for (let i = 0; i < n; i += 4) eng.push(pts.subarray(i * 7, Math.min(n, i + 4) * 7));
      eng.end();
      const ms = performance.now() - t0;
      // spacing 0.1 × size, points 8 px apart: dabs ≈ path length / spacing
      const dabs = Math.round((n * 8) / Math.max(0.5, 0.1 * size * 0.75));
      rows.push({ size, points: n, ms: Math.round(ms), approxDabs: dabs, dabsPerSec: Math.round(dabs / (ms / 1000)), pointsPerFrameBudget16ms: Math.round((n / ms) * 16) });
    }
    return { memoryMiB: Math.round(eng.x.memory.buffer.byteLength / 2 ** 20), rows };
  },

  /** Pointer to pixel on the main thread: per frame, 4 coalesced points 6 px apart, push + read the changed pixels + put them on a canvas. */
  async latencyMain(size: number, frames = 240, which: Build = "release") {
    const { eng } = await instantiate(WASM[which]);
    const layer = eng.layer();
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 800;
    const g = c.getContext("2d")!;
    const pts = zigzag(frames * 4, 6, 1280, 800);
    const push: number[] = [], read: number[] = [], put: number[] = [], all: number[] = [];
    eng.begin(layer, brush(size));
    for (let f = 0; f < frames; f++) {
      const t0 = performance.now();
      const r = eng.push(pts.subarray(f * 28, f * 28 + 28));
      const t1 = performance.now();
      if (!r) continue;
      const img = eng.read(layer, r);
      const t2 = performance.now();
      g.putImageData(img, r[0], r[1]);
      const t3 = performance.now();
      push.push(t1 - t0);
      read.push(t2 - t1);
      put.push(t3 - t2);
      all.push(t3 - t0);
    }
    eng.end();
    return { size, push: pct(push), read: pct(read), put: pct(put), total: pct(all) };
  },

  /** The same through a worker (pixels transferred back): the round trip per frame. */
  async latencyWorker(size: number, frames = 240, which: Build = "release") {
    const { module } = await instantiate(WASM[which]);
    const w = new Worker(URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" })));
    await new Promise<void>((ok) => {
      w.onmessage = () => ok();
      w.postMessage({ type: "init", module });
    });
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 800;
    const g = c.getContext("2d")!;
    const pts = zigzag(frames * 4, 6, 1280, 800);
    const rt: number[] = [];
    w.postMessage({ type: "begin", brush: brush(size) });
    for (let f = 0; f < frames; f++) {
      const t0 = performance.now();
      const d = await new Promise<{ r: [number, number, number, number] | null; buf?: ArrayBuffer }>((ok) => {
        w.onmessage = (m) => ok(m.data);
        const chunk = pts.slice(f * 28, f * 28 + 28);
        w.postMessage({ type: "push", id: f, pts: chunk }, [chunk.buffer]);
      });
      if (d.r && d.buf) g.putImageData(new ImageData(new Uint8ClampedArray(d.buf), d.r[2] - d.r[0], d.r[3] - d.r[1]), d.r[0], d.r[1]);
      rt.push(performance.now() - t0);
    }
    w.terminate();
    return { size, roundTrip: pct(rt) };
  },

  /** Memory: a 4000 × 3000 page painted all over with a 200 px brush (every tile touched), and 10 such layers. */
  async memory() {
    const { eng } = await instantiate(WASM_RELEASE);
    const out: Array<{ layers: number; mib: number }> = [];
    for (let l = 1; l <= 10; l++) {
      const layer = eng.layer();
      eng.begin(layer, brush(200));
      const pts = zigzag(3000, 20, 4000, 3000);
      for (let i = 0; i < 3000; i += 50) eng.push(pts.subarray(i * 7, (i + 50) * 7));
      eng.end();
      if (l === 1 || l === 5 || l === 10) out.push({ layers: l, mib: Math.round(eng.x.memory.buffer.byteLength / 2 ** 20) });
    }
    return out;
  },

  /**
   * Showing a page (1280 × 800 view): per frame, upload the changed part of the active layer and draw three surfaces (below,
   * active, above), in Canvas 2D and in WebGL2.
   */
  async display(frames = 120) {
    const W = 1280, H = 800, dirty = 160; // a 160 × 160 px change per frame
    const patch = new ImageData(new Uint8ClampedArray(dirty * dirty * 4).fill(128), dirty, dirty);
    const surf = () => {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      c.getContext("2d")!.fillRect(0, 0, W, H);
      return c;
    };
    // Canvas 2D
    const view = document.createElement("canvas");
    view.width = W;
    view.height = H;
    document.body.append(view);
    const vg = view.getContext("2d")!;
    const below = surf(), active = surf(), above = surf();
    const ag = active.getContext("2d")!;
    const c2: number[] = [];
    for (let f = 0; f < frames; f++) {
      const t0 = performance.now();
      ag.putImageData(patch, (f * 37) % (W - dirty), (f * 23) % (H - dirty));
      vg.clearRect(0, 0, W, H);
      vg.drawImage(below, 0, 0);
      vg.drawImage(active, 0, 0);
      vg.drawImage(above, 0, 0);
      vg.getImageData(0, 0, 1, 1); // (include the rasterization)
      c2.push(performance.now() - t0);
    }
    view.remove();
    // WebGL2
    const glc = document.createElement("canvas");
    glc.width = W;
    glc.height = H;
    document.body.append(glc);
    const gl = glc.getContext("webgl2", { premultipliedAlpha: true, preserveDrawingBuffer: false });
    let webgl: unknown = "no WebGL2";
    if (gl) {
      const sh = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, "#version 300 es\nin vec2 p;out vec2 uv;void main(){uv=p*0.5+0.5;gl_Position=vec4(p,0,1);}"));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, "#version 300 es\nprecision mediump float;in vec2 uv;uniform sampler2D t;out vec4 o;void main(){o=texture(t,uv);}"));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const tex = () => {
        const t = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        return t;
      };
      const ts = [tex(), tex(), tex()];
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const px = new Uint8Array(4);
      const g2: number[] = [];
      for (let f = 0; f < frames; f++) {
        const t0 = performance.now();
        gl.bindTexture(gl.TEXTURE_2D, ts[1]!);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, (f * 37) % (W - dirty), (f * 23) % (H - dirty), dirty, dirty, gl.RGBA, gl.UNSIGNED_BYTE, patch.data);
        gl.clear(gl.COLOR_BUFFER_BIT);
        for (const t of ts) {
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // (include the GPU work)
        g2.push(performance.now() - t0);
      }
      webgl = pct(g2);
    }
    glc.remove();
    return { canvas2d: pct(c2), webgl2: webgl };
  },

  /** `.abr`: the engine writes a brush file and reads it back, in the browser. */
  async abr() {
    const { eng } = await instantiate(WASM_RELEASE);
    const t0 = performance.now();
    const n = eng.x.abr_roundtrip(200);
    return { brushesRead: n, ms: Math.round((performance.now() - t0) * 10) / 10 };
  },

  /** A stroke's pixels are the engine's: one mid-stroke pixel and one far from it (a sanity check). */
  async check() {
    const { eng } = await instantiate(WASM_RELEASE);
    const layer = eng.layer();
    eng.begin(layer, brush(40));
    eng.push(new Float32Array([100, 100, 1, 0, 0, 0, 0, 300, 100, 1, 0, 0, 0, 16]));
    eng.end();
    const on = eng.read(layer, [200, 100, 201, 101]).data;
    const off = eng.read(layer, [200, 300, 201, 301]).data;
    return { on: [...on], off: [...off] };
  },
};

(window as unknown as { __spikePaint: typeof spike }).__spikePaint = spike;
document.body.dataset["ready"] = "1";
