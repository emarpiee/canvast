/**
 * The page's side of the brush engine (ADR 0164, 0165): compiles the WebAssembly inlined in the file, starts the worker that runs it,
 * and turns the message protocol (engine-protocol.ts) into calls. One stroke at a time; `end` resolves with the changed tiles.
 */
import wasm from "../../engine/out/brush.wasm";
import type { EndedTile, FromWorker, LoadTile, ToWorker } from "./engine-protocol";

/** The worker's code, bundled on its own by scripts/build.mjs. */
declare const __PAINT_WORKER__: string;

export class BrushEngine {
  /** The live stroke: live tiles (`side` px) at `keys` (tx, ty pairs), pixels one after another. */
  onLive: ((keys: Int32Array, px: Uint8Array, side: number) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  private ended: ((tiles: readonly EndedTile[]) => void) | null = null;
  private loads = new Map<string, Array<() => void>>();
  private side = 64;

  private constructor(private readonly w: Worker) {
    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.t === "live") this.onLive?.(m.keys, m.px, this.side);
      else if (m.t === "ended") {
        this.ended?.(m.tiles);
        this.ended = null;
      } else if (m.t === "loaded") {
        for (const ok of this.loads.get(m.id) ?? []) ok();
        this.loads.delete(m.id);
      } else if (m.t === "error") this.onError?.(m.message);
    };
  }

  private static starting: Promise<BrushEngine> | null = null;
  /** The engine, started once (about 50 to 80 ms to compile). */
  static start(): Promise<BrushEngine> {
    return (BrushEngine.starting ??= (async () => {
      const module = await WebAssembly.compile(wasm as BufferSource);
      const url = URL.createObjectURL(new Blob([__PAINT_WORKER__], { type: "text/javascript" }));
      const w = new Worker(url);
      URL.revokeObjectURL(url);
      const eng = new BrushEngine(w);
      await new Promise<void>((ok, fail) => {
        w.onerror = (e) => fail(new Error(e.message || "the brush engine did not start"));
        const prev = w.onmessage;
        w.onmessage = (ev: MessageEvent<FromWorker>) => {
          if (ev.data.t === "ready") {
            eng.side = ev.data.live;
            w.onmessage = prev;
            ok();
          } else if (ev.data.t === "error") fail(new Error(ev.data.message));
        };
        eng.send({ t: "init", module });
      });
      return eng;
    })());
  }

  private send(m: ToWorker, transfer: Transferable[] = []): void {
    this.w.postMessage(m, transfer);
  }

  /** Make the engine's layer `id` (resolves when loaded; at once when it already is). */
  load(id: string, tiles: readonly LoadTile[]): Promise<void> {
    return new Promise((ok) => {
      this.loads.set(id, [...(this.loads.get(id) ?? []), ok]);
      this.send({ t: "load", id, tiles });
    });
  }

  adopt(id: string): void {
    this.send({ t: "adopt", id });
  }

  begin(brush: object, lock: boolean, page: { w: number; h: number }): void {
    this.send({ t: "begin", brush, lock, w: page.w, h: page.h });
  }

  points(pts: Float32Array): void {
    this.send({ t: "points", pts }, [pts.buffer]);
  }

  end(): Promise<readonly EndedTile[]> {
    return new Promise((ok) => {
      this.ended = ok;
      this.send({ t: "end" });
    });
  }

  cancel(): void {
    this.send({ t: "cancel" });
  }
}
