import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import type { BufferGeometry, Mesh } from "three";
import { extractLines } from "./model-lines";
import type { LinesInput } from "./model-lines";

// Reads a model's file off the page: a large one takes seconds, and the page must not stop for them. What it makes goes back as plain arrays.

interface Part {
  position: Float32Array;
  normal: Float32Array;
  color?: Float32Array;
  index?: Uint32Array | Uint16Array;
}

const partOf = (g: BufferGeometry): Part => {
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  const color = g.getAttribute("color")?.array as Float32Array | undefined;
  const index = g.index?.array as Uint32Array | Uint16Array | undefined;
  return { position: g.getAttribute("position")!.array as Float32Array, normal: g.getAttribute("normal")!.array as Float32Array, ...(color ? { color } : {}), ...(index ? { index } : {}) };
};

self.onmessage = (e: MessageEvent<{ data: ArrayBuffer; ext: string } | { lines: LinesInput }>) => {
  if ("lines" in e.data) {
    try {
      (self as unknown as Worker).postMessage({ result: extractLines(e.data.lines) });
    } catch (err) {
      (self as unknown as Worker).postMessage({ error: (err as Error).message || "its lines could not be read" });
    }
    return;
  }
  const { data, ext } = e.data;
  try {
    let parts: Part[];
    if (ext === "STL") parts = [partOf(new STLLoader().parse(data))];
    else if (ext === "PLY") parts = [partOf(new PLYLoader().parse(data))];
    else {
      const meshes: Mesh[] = [];
      new OBJLoader().parse(new TextDecoder().decode(data)).traverse((o) => void ((o as Mesh).isMesh && meshes.push(o as Mesh)));
      parts = meshes.map((m) => partOf(m.geometry));
    }
    const transfer = parts.flatMap((p) => [p.position.buffer, p.normal.buffer, ...(p.color ? [p.color.buffer] : []), ...(p.index ? [p.index.buffer] : [])]);
    (self as unknown as Worker).postMessage({ parts }, transfer as Transferable[]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: (err as Error).message || "it could not be read" });
  }
};
