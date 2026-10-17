/**
 * The file names of the originals, read from the catalog once each and then kept: the one place every list and label asks
 * (the Layers panel, the names above pictures). `get` is synchronous: it answers what is known and starts the lookup of what is not,
 * and subscribers are told when a new name arrives (to redraw).
 */
export class AssetNames {
  private readonly names = new Map<string, string>();
  private readonly asked = new Set<string>();

  private readonly listeners: Array<() => void> = [];

  constructor(private readonly lookup: (hash: string) => Promise<string>) {}

  subscribe(fn: () => void): void {
    this.listeners.push(fn);
  }

  /** The known names by hash (for lists that take a map). */
  get map(): ReadonlyMap<string, string> {
    return this.names;
  }

  get(hash: string): string | undefined {
    const n = this.names.get(hash);
    if (n === undefined && !this.asked.has(hash)) {
      this.asked.add(hash);
      void this.lookup(hash).then((name) => {
        if (!name) return;
        this.names.set(hash, name);
        for (const fn of this.listeners) fn();
      }, () => undefined);
    }
    return n;
  }
}
