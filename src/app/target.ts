/**
 * One chrome for two views (ADR 0168): the canvas's bars (tool rail, Properties bar, dock, Actions bar, view controls) are mounted once and
 * work on a target that can be switched, the canvas's document, editor and view or those of the Painting view's vector layer
 * (paint/vector-host.ts). A `Switch` gives a stand-in for its current target: reads, writes and calls go to the target in use; a
 * subscription made through it hears only the target in use, and is called once more when the target changes (so a bar shows the other
 * view's state at once).
 */
const CURRENT = Symbol("current");
/** What a stand-in stands for now (anything else as it is): for caches kept by object, which must not mix two targets. */
export const real = <T extends object>(x: T): T => ((x as { [CURRENT]?: T })[CURRENT] ?? x);

export class Switch<T extends object> {
  private cur: T;
  private readonly known: T[] = [];
  /** By subscribing method: the callers subscribed through the stand-in, and their subscriptions on each target. */
  private readonly subs = new Map<string, Set<{ fn: (...a: unknown[]) => void; offs: Map<T, () => void> }>>();
  readonly proxy: T;

  /** `hubs`: the subscribing methods (e.g. "subscribe"), each with the arguments a caller is called with when the target changes. */
  constructor(first: T, private readonly hubs: Readonly<Record<string, readonly unknown[]>>) {
    this.cur = first;
    this.known.push(first);
    for (const h of Object.keys(hubs)) this.subs.set(h, new Set());
    this.proxy = new Proxy({} as T, {
      get: (_, k) => {
        if (k === CURRENT) return this.cur;
        if (typeof k === "string" && k in this.hubs) return (fn: (...a: unknown[]) => void) => this.subscribe(k, fn);
        const v = Reflect.get(this.cur, k, this.cur) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(this.cur) : v;
      },
      set: (_, k, v) => Reflect.set(this.cur, k, v, this.cur),
      has: (_, k) => Reflect.has(this.cur, k),
    });
  }

  get current(): T {
    return this.cur;
  }

  /** Work on `t` from now on (its subscriptions are made the first time). */
  use(t: T): void {
    if (t === this.cur) return;
    if (!this.known.includes(t)) {
      this.known.push(t);
      for (const [h, set] of this.subs) for (const s of set) s.offs.set(t, this.on(t, h, s.fn));
    }
    this.cur = t;
    for (const [h, set] of this.subs) for (const s of [...set]) s.fn(...this.hubs[h]!);
  }

  private on(t: T, h: string, fn: (...a: unknown[]) => void): () => void {
    const off = (t as Record<string, (f: (...a: unknown[]) => void) => unknown>)[h]!.call(t, (...a: unknown[]) => {
      if (this.cur === t) fn(...a);
    });
    return typeof off === "function" ? (off as () => void) : () => undefined;
  }

  private subscribe(h: string, fn: (...a: unknown[]) => void): () => void {
    const s = { fn, offs: new Map<T, () => void>() };
    for (const t of this.known) s.offs.set(t, this.on(t, h, fn));
    this.subs.get(h)!.add(s);
    return () => {
      for (const off of s.offs.values()) off();
      this.subs.get(h)!.delete(s);
    };
  }
}
