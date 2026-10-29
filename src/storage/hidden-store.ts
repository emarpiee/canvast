/**
 * The desktop build's encrypted hidden items (ADR 0177, "Hidden items: the design"): the vault in `.canvast/hidden.json` and
 * its data key, held in memory from the moment the Hidden password is given until the app closes or the items are locked.
 * The file is read again each time it is needed, so a password changed on another device is the one asked for here.
 */
import type { DesktopBridge } from "./desktop-bridge";
import type { HiddenState, HiddenStore } from "./store";
import type { VaultRecord } from "./hidden-vault";
import { SEALED_COPY_RE, createVault, holdsKey, keyCheck, openBytes, openText, openVault, readVault, rewrapVault, sealBytes, sealText } from "./hidden-vault";

export const HIDDEN_JSON = ".canvast/hidden.json";
/**
 * A copy of `hidden.json` beside it: a sync tool's when two devices wrote it at once (`hidden (1).json`, `hidden.sync-conflict-….json`…),
 * or this app's when `hidden.json` holds another key. Read into the index, then erased once the index has its items.
 */
export const isHiddenCopy = (p: string): boolean => p !== HIDDEN_JSON && /^\.canvast\/hidden[^/]*\.json$/i.test(p) && !p.includes(".tmp-");

/** Raw entries of the index by item, one per hash: a recovered one (its name lost) gives way to one with its name. */
function mergeEntries(lists: unknown[][]): unknown[] {
  const byHash = new Map<string, unknown>();
  const recovered = (i: unknown): boolean => String((i as { name?: unknown }).name ?? "").startsWith(RECOVERED_PREFIX);
  for (const list of lists)
    for (const i of list) {
      const hash = (i as { hash?: unknown } | null)?.hash;
      if (typeof hash !== "string") continue;
      const had = byHash.get(hash);
      if (!had || (recovered(had) && !recovered(i))) byHash.set(hash, i);
    }
  return [...byHash.values()];
}
/** The start of the name given to a hidden file found with no entry (its name was lost): `recovered-<hash>.<ext>`. */
export const RECOVERED_PREFIX = "recovered-";

async function sameKey(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.exportKey("raw", a), crypto.subtle.exportKey("raw", b)]);
  return new Uint8Array(x).every((v, i) => v === new Uint8Array(y)[i]);
}

export class HiddenVault implements HiddenStore {
  private key: CryptoKey | null = null;
  private readonly listeners = new Set<() => void>();
  /** The record this device opened or made: kept beside `hidden.json` when that turns out to hold another key. */
  private own: VaultRecord | null = null;
  /** Where this device keeps its record then. */
  private ownCopy: string | null = null;
  /** Copies of `hidden.json` that hold another key the same password opened: their files are sealed again with this key. */
  private readonly others = new Map<string, CryptoKey>();
  /** The copies read into the last index: erased once it is written. */
  private merged: string[] = [];
  private readonly told = new Set<string>();
  /** Told in plain words what needs the person (a copy that does not open). */
  onNotice: ((text: string) => void) | null = null;

  constructor(
    private readonly bridge: DesktopBridge,
    /** How many items are hidden now (the password cannot be removed while there are any). */
    private readonly countHidden: () => Promise<number>,
  ) {}

  private async load(path = HIDDEN_JSON): Promise<VaultRecord | null> {
    const bytes = await this.bridge.read(path);
    return bytes ? readVault(new TextDecoder().decode(bytes)) : null;
  }
  private async copies(): Promise<string[]> {
    return (await this.bridge.list(".canvast")).map((n) => `.canvast/${n}`).filter(isHiddenCopy);
  }
  private save(record: VaultRecord): Promise<void> {
    return this.bridge.write(HIDDEN_JSON, new TextEncoder().encode(JSON.stringify(record, null, 1)));
  }
  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** The data key, while the hidden items are open. */
  get dataKey(): CryptoKey | null {
    return this.key;
  }

  isOpen(): boolean {
    return !!this.key;
  }

  async state(): Promise<HiddenState> {
    if (this.key) return "open";
    return (await this.load()) ? "locked" : "none";
  }

  async unlock(password: string): Promise<boolean> {
    const record = await this.load();
    const key = record ? await openVault(record, password) : null;
    if (!key) return false;
    // A copy of hidden.json with another key (two devices set the first password at once) that this password opens too: joined to this one.
    for (const path of await this.copies()) {
      const copy = await this.load(path);
      const other = copy && (await holdsKey(copy, key)) !== true ? await openVault(copy, password) : null;
      if (other && !(await sameKey(other, key))) this.others.set(path, other);
    }
    const was = this.key;
    this.key = key;
    this.own = record;
    if (!was) this.changed();
    return true;
  }

  async setPassword(password: string): Promise<void> {
    const record = await this.load();
    if (!record) {
      // Sealed files, or a copy of hidden.json, with no hidden.json: another device set the password and its hidden.json is still on
      // its way. A key made now would be a second one, and the files of one of them would never open on the other device.
      if ((await this.copies()).length || (await this.bridge.list(".hidden")).some((n) => SEALED_COPY_RE.test(`.hidden/${n}`)))
        throw new Error("The workspace folder has hidden items encrypted on another device, but not their password file (.canvast/hidden.json) yet: your sync tool may still be bringing it. Wait until it is there, then open the Hidden items with that device's password.");
      const made = await createVault(password);
      await this.save(made.record);
      this.key = made.key;
      this.own = made.record;
    } else {
      if (!this.key) throw new Error("the Hidden items are locked: give the current password first");
      const next = await rewrapVault(record, this.key, password);
      await this.save(next);
      this.own = next;
    }
    this.changed();
  }

  async remove(): Promise<boolean> {
    if ((await this.countHidden()) > 0) return false;
    await this.bridge.erase(HIDDEN_JSON);
    this.key = null;
    this.own = null;
    this.others.clear();
    this.changed();
    return true;
  }

  lock(): void {
    if (!this.key) return;
    this.key = null;
    this.others.clear();
    this.changed();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * The hidden items' entries, or null while locked: those of `hidden.json` and of each copy beside it that opens (a sync tool's
   * conflict copy holds what the other device hid). `whole` is false when `hidden.json` has an index this key does not open (another
   * key, or damaged): an item missing from it then was not shown or erased elsewhere.
   */
  async readIndex(): Promise<{ items: unknown[]; whole: boolean } | null> {
    if (!this.key) return null;
    const list = async (r: VaultRecord, key: CryptoKey): Promise<unknown[] | null> => {
      if (!r.index) return [];
      const text = await openText(key, r.index);
      try {
        const a = text === null ? null : (JSON.parse(text) as unknown);
        return Array.isArray(a) ? a : null;
      } catch {
        return null;
      }
    };
    const lists: unknown[][] = [];
    const record = await this.load();
    const main = record && (await holdsKey(record, this.key)) !== false ? await list(record, this.key) : record ? null : [];
    if (main) lists.push(main);
    const merged: string[] = [];
    for (const path of await this.copies()) {
      const copy = await this.load(path);
      if (!copy) continue;
      const key = (await holdsKey(copy, this.key)) ? this.key : this.others.get(path);
      const got = key ? await list(copy, key) : null;
      if (got) {
        lists.push(got);
        merged.push(path);
      } else if (copy.index && !this.told.has(path)) {
        this.told.add(path);
        this.onNotice?.(`Hidden items from another device (${path.slice(9)}) are encrypted with another password. Open them with scripts/hidden-items.mjs and that password (see the README, “Hidden items”), or give both devices the same password.`);
      }
    }
    this.merged = merged;
    return { items: mergeEntries(lists), whole: !!main };
  }

  /** Whether copies were read into the index and wait for it to be written (then they are erased). */
  get copiesWaiting(): boolean {
    return this.merged.length > 0;
  }

  /**
   * Seal and keep the hidden items' index. Only while open. When `hidden.json` holds another key (another device set the first password
   * at the same time, and its file came last), it is not written over: this device's record goes beside it, joined to it when the
   * Hidden items are next opened with a password both take.
   */
  async writeIndex(text: string): Promise<void> {
    if (!this.key) throw new Error("the Hidden items are locked");
    const next = { index: await sealText(this.key, text), check: await keyCheck(this.key) };
    const record = await this.load();
    const ours = record ? ((await holdsKey(record, this.key)) ?? record.key === this.own?.key) : !!this.own;
    if (!ours) {
      if (!this.own) throw new Error("the Hidden items are locked");
      this.ownCopy ??= `.canvast/hidden (this device ${Math.random().toString(36).slice(2, 8)}).json`;
      await this.bridge.write(this.ownCopy, new TextEncoder().encode(JSON.stringify({ ...this.own, ...next }, null, 1)));
      if (!this.told.has(this.ownCopy)) {
        this.told.add(this.ownCopy);
        this.onNotice?.("Another device set a Hidden password for this workspace folder at the same time as this one. This device's hidden items are kept beside it: lock the Hidden items and open them again with that device's password, the same as this one, to join them.");
      }
      return;
    }
    await this.save({ ...(record ?? this.own!), ...next });
    // The copies read into this index are no longer needed: the files of another key are sealed again with this one first.
    for (const path of this.merged) {
      const other = this.others.get(path);
      if (other && !(await this.sealAgain(other))) continue; // (kept, with its key, for the next write)
      await this.bridge.erase(path);
      this.others.delete(path);
      if (path === this.ownCopy) this.ownCopy = null;
    }
    this.merged = [];
  }

  /** Seal each file of `.hidden/` that only `other` opens again with this key, read back to prove it. Whether all were. */
  private async sealAgain(other: CryptoKey): Promise<boolean> {
    for (const name of await this.bridge.list(".hidden")) {
      const path = `.hidden/${name}`;
      if (!SEALED_COPY_RE.test(path)) continue;
      const bytes = (await this.bridge.read(path)) as Uint8Array<ArrayBuffer> | null;
      if (!bytes || !this.key || (await openBytes(this.key, bytes))) continue;
      const plain = await openBytes(other, bytes);
      if (!plain) continue;
      await this.bridge.write(path, await sealBytes(this.key, plain));
      const back = (await this.bridge.read(path)) as Uint8Array<ArrayBuffer> | null;
      const again = back && (await openBytes(this.key, back));
      if (!again || again.length !== plain.length || again.some((v, i) => v !== plain[i])) return false;
    }
    return true;
  }

  async seal(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    if (!this.key) throw new Error("the Hidden items are locked");
    return sealBytes(this.key, bytes);
  }

  /** The original of a sealed file, or null while locked (or when it does not open). */
  async open(sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
    if (!this.key) return null;
    for (const key of [this.key, ...this.others.values()]) {
      const bytes = await openBytes(key, sealed);
      if (bytes) return bytes;
    }
    return null;
  }
}
