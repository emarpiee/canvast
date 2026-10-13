/**
 * One-writer lease per workspace, so the same workspace open in two tabs
 * cannot corrupt itself (ADR 0006). This is a convenience layer; the
 * authoritative guard is the per-canvas revision check in every commit.
 *
 * Mechanisms, in order of preference:
 * 1. Web Locks (`navigator.locks`): an exclusive lock held for the tab's
 *    lifetime. A read-only tab queues a request and is promoted automatically
 *    when the writer closes; "take over" steals the lock.
 * 2. localStorage heartbeat: a lease record renewed every second and
 *    considered expired after 4 s; `storage` events report take-overs.
 * 3. Neither available: the tab assumes it is the writer, and conflicts are
 *    caught by the revision check.
 */
export type LeaseState = "acquiring" | "writer" | "readonly";
export type LeaseMechanism = "web-locks" | "local-heartbeat" | "none";

const LOCK_NAME = "canvast-workspace-writer";
const LS_KEY = "canvast-writer-lease";
const HEARTBEAT_MS = 1000;
const EXPIRY_MS = 4000;

interface LsLease {
  tab: string;
  expires: number;
}

export class WriterLease {
  state: LeaseState = "acquiring";
  readonly mechanism: LeaseMechanism;
  private readonly tab = Math.random().toString(36).slice(2);
  private readonly listeners = new Set<() => void>();
  private release: (() => void) | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (locks && typeof locks.request === "function") this.mechanism = "web-locks";
    else if (localStorageWorks()) this.mechanism = "local-heartbeat";
    else this.mechanism = "none";
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(s: LeaseState): void {
    if (s === this.state) return;
    this.state = s;
    for (const fn of this.listeners) fn();
  }

  /** Try to become the writer; resolves with the resulting state. */
  async acquire(): Promise<LeaseState> {
    if (this.mechanism === "web-locks") {
      const got = await this.requestLock({ ifAvailable: true });
      if (!got) {
        this.set("readonly");
        // Queue for the lock: promoted automatically when the writer closes.
        void this.requestLock({});
      }
    } else if (this.mechanism === "local-heartbeat") {
      const cur = readLs();
      if (!cur || cur.expires < Date.now() || cur.tab === this.tab) this.startHeartbeat();
      else {
        this.set("readonly");
        this.watchLs();
      }
    } else {
      this.set("writer");
    }
    return this.state;
  }

  /** Become the writer even if another tab holds the lease (it turns read-only). */
  async takeOver(): Promise<void> {
    if (this.mechanism === "web-locks") await this.requestLock({ steal: true });
    else if (this.mechanism === "local-heartbeat") this.startHeartbeat();
    else this.set("writer");
  }

  /**
   * Request the lock. Resolves true once held (the holder keeps it until
   * stolen or the page closes), false if `ifAvailable` and it was taken.
   */
  private requestLock(opts: LockOptions): Promise<boolean> {
    return new Promise((resolveAcquired) => {
      const locks = (navigator as Navigator & { locks: LockManager }).locks;
      locks
        .request(LOCK_NAME, opts, (lock) => {
          if (!lock) {
            resolveAcquired(false);
            return undefined;
          }
          this.set("writer");
          resolveAcquired(true);
          return new Promise<void>((release) => (this.release = release));
        })
        .catch(() => {
          // Our lock was stolen by another tab's take-over.
          if (this.state === "writer") {
            this.set("readonly");
            void this.requestLock({});
          }
          resolveAcquired(false);
        });
    });
  }

  private startHeartbeat(): void {
    const beat = (): void => {
      const cur = readLs();
      if (cur && cur.tab !== this.tab && cur.expires >= Date.now() && this.state === "writer") {
        // Someone else took over.
        this.stopHeartbeat();
        this.set("readonly");
        this.watchLs();
        return;
      }
      writeLs({ tab: this.tab, expires: Date.now() + EXPIRY_MS });
    };
    writeLs({ tab: this.tab, expires: Date.now() + EXPIRY_MS });
    this.set("writer");
    this.stopHeartbeat();
    this.heartbeat = setInterval(beat, HEARTBEAT_MS);
    addEventListener("pagehide", () => {
      const cur = readLs();
      if (cur?.tab === this.tab) localStorage.removeItem(LS_KEY);
    });
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  /** Read-only tab: become writer when the lease expires or is released. */
  private watchLs(): void {
    const poll = setInterval(() => {
      if (this.state !== "readonly") return clearInterval(poll);
      const cur = readLs();
      if (!cur || cur.expires < Date.now()) {
        clearInterval(poll);
        this.startHeartbeat();
      }
    }, HEARTBEAT_MS);
  }
}

function localStorageWorks(): boolean {
  try {
    localStorage.setItem("canvast-probe", "1");
    localStorage.removeItem("canvast-probe");
    return true;
  } catch {
    return false;
  }
}

function readLs(): LsLease | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v ? (JSON.parse(v) as LsLease) : null;
  } catch {
    return null;
  }
}

function writeLs(l: LsLease): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(l));
  } catch {
    // storage unavailable: the revision check still guards commits
  }
}
