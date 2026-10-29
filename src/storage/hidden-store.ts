/**
 * The desktop build's encrypted hidden items (ADR 0177, "Hidden items: the design"): the vault in `.canvast/hidden.json` and
 * its data key, held in memory from the moment the Hidden password is given until the app closes or the items are locked.
 * The file is read again each time it is needed, so a password changed on another device is the one asked for here.
 */
import type { DesktopBridge } from "./desktop-bridge";
import type { HiddenState, HiddenStore } from "./store";
import type { VaultRecord } from "./hidden-vault";
import { SEALED_COPY_RE, createVault, holdsKey, keyCheck, needsUpgrade, openBytes, openFile, openText, openVault, readVault, rewrapVault, sameKey, sealBytes, sealFile, sealText } from "./hidden-vault";

export const HIDDEN_JSON = ".canvast/hidden.json";
/**
 * A spare of the vault's key (its wrapped key, salt and check; no index), written with it: when `hidden.json` is lost or damaged the
 * password still opens the files, and the index is written again from what this device has.
 */
export const HIDDEN_KEY_SPARE = ".canvast/keys/hidden.json";
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
  private async save(record: VaultRecord): Promise<void> {
    await this.bridge.write(HIDDEN_JSON, new TextEncoder().encode(JSON.stringify(record, null, 1)));
    await this.keepSpare(record);
  }
  private lastSpare = "";
  /** Write the spare of the key when it is not what the vault's key now is. */
  private async keepSpare(record: VaultRecord): Promise<void> {
    const { format, version, kdf, key, check } = record;
    const text = JSON.stringify({ format, version, kdf, key, ...(check ? { check } : {}) }, null, 1);
    if (text === this.lastSpare) return;
    const now = await this.bridge.read(HIDDEN_KEY_SPARE);
    if (!now || new TextDecoder().decode(now) !== text) await this.bridge.write(HIDDEN_KEY_SPARE, new TextEncoder().encode(text));
    this.lastSpare = text;
  }
  /** The vault: `hidden.json`, or the spare of its key when that is lost or damaged (`spare`: its index is not known). */
  private async vault(): Promise<{ record: VaultRecord; spare: boolean } | null> {
    const record = await this.load();
    this.fromSpare = false;
    if (record) return { record, spare: false };
    const spare = await this.load(HIDDEN_KEY_SPARE);
    this.fromSpare = !!spare;
    return spare ? { record: spare, spare: true } : null;
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
    return (await this.vault()) ? "locked" : "none";
  }

  async unlock(password: string): Promise<boolean> {
    const found = await this.vault();
    let record = found?.record ?? null;
    const key = record ? await openVault(record, password) : null;
    if (!key) return false;
    // A vault of an earlier version (PBKDF2) is wrapped again with scrypt now that the password is here: the same key, no file changes.
    if (record && found && !found.spare && needsUpgrade(record)) {
      const up = await rewrapVault(record, password, password);
      if (up) {
        await this.save(up);
        record = up;
      }
    }
    // A copy of hidden.json with another key (two devices set the first password at once) that this password opens too: joined to this one.
    for (const path of await this.copies()) {
      const copy = await this.load(path);
      const other = copy && (await holdsKey(copy, key)) !== true ? await openVault(copy, password) : null;
      if (other && !(await sameKey(other, key))) this.others.set(path, other);
    }
    const was = this.key;
    this.key = key;
    this.own = record;
    await this.keepSpare(record!).catch(() => undefined); // (a workspace of an earlier version gets its spare now)
    if (!was) this.changed();
    return true;
  }

  async setPassword(password: string, current?: string): Promise<void> {
    const record = (await this.vault())?.record ?? null;
    if (!record && (await this.bridge.exists(HIDDEN_JSON)))
      throw new Error("The Hidden items' password file (.canvast/hidden.json) is damaged, and its spare (.canvast/keys/hidden.json) is not there: put a good copy of either back from a backup. A new password would make a new key, and the hidden files could not be opened.");
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
      if (!this.key || current === undefined) throw new Error("the Hidden items are locked: give the current password first");
      const next = await rewrapVault(record, current, password);
      if (!next) throw new Error("That is not the current password, so nothing changed.");
      await this.save(next);
      this.own = next;
    }
    this.changed();
  }

  async remove(): Promise<boolean> {
    if ((await this.countHidden()) > 0) return false;
    await this.bridge.erase(HIDDEN_JSON);
    await this.bridge.erase(HIDDEN_KEY_SPARE);
    this.lastSpare = "";
    this.key = null;
    this.own = null;
    this.others.clear();
    this.changed();
    return true;
  }

  lock(): void {
    if (!this.key) return;
    // (What waits to be written, and anything to do with the key before it goes, is done first: then it is forgotten.)
    const before = this.beforeLock?.() ?? Promise.resolve();
    void before.catch(() => undefined).then(() => {
      this.key = null;
      this.others.clear();
      this.changed();
    });
  }
  /** Run while the key is still open, just before it is forgotten (set by the app). */
  beforeLock: (() => Promise<void>) | null = null;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * The hidden items' entries, or null while locked: those of `hidden.json` and of each copy beside it that opens (a sync tool's
   * conflict copy holds what the other device hid). `whole` is false when `hidden.json` has an index this key does not open (another
   * key, or damaged): an item missing from it then was not shown or erased elsewhere.
   */
  async readIndex(): Promise<{ items: unknown[]; whole: boolean; folders: unknown[] } | null> {
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
    const found = await this.vault();
    const record = found?.record ?? null;
    // (from the spare, the index is not known: nothing missing from it counts as shown or erased elsewhere)
    const main = found?.spare ? null : record && (await holdsKey(record, this.key)) !== false ? await list(record, this.key) : record ? null : [];
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
    let folders: unknown[] = [];
    if (record?.folders && main) {
      try {
        const a = JSON.parse((await openText(this.key, record.folders)) ?? "[]") as unknown;
        folders = Array.isArray(a) ? a : [];
      } catch {
        folders = [];
      }
    }
    return { items: mergeEntries(lists), whole: !!main, folders };
  }

  private fromSpare = false;
  /** The vault's key as its spare is written (no index), for a backup: null when there is none. */
  async keyText(): Promise<string | null> {
    const record = (await this.vault())?.record;
    if (!record) return null;
    const { format, version, kdf, key, check } = record;
    return JSON.stringify({ format, version, kdf, key, ...(check ? { check } : {}) }, null, 1);
  }

  /**
   * A key file a backup brought: with no vault here it becomes the vault (its files open with its password); with another, it is kept
   * beside `hidden.json` as a copy, joined when a password opens both (its files are then sealed again with this key). The same key
   * wrapped the same way is already here.
   */
  async adoptKey(text: string): Promise<void> {
    const theirs = readVault(text);
    if (!theirs) return;
    const mine = await this.vault();
    if (!mine) {
      await this.save(theirs);
      this.changed();
      return;
    }
    if (mine.record.key === theirs.key) return;
    if (this.key && (await holdsKey(theirs, this.key))) return; // (the same key under another password: nothing to join)
    const at = `.canvast/hidden (backup ${new Date().toISOString().slice(0, 10)} ${Math.random().toString(36).slice(2, 6)}).json`;
    await this.bridge.write(at, new TextEncoder().encode(JSON.stringify(theirs, null, 1)));
  }

  /** Whether the index waits to be written even if it did not change: copies were read into it (erased then), or hidden.json was lost. */
  get indexWaiting(): boolean {
    return this.merged.length > 0 || this.fromSpare;
  }

  /**
   * Seal and keep the hidden items' index. Only while open. When `hidden.json` holds another key (another device set the first password
   * at the same time, and its file came last), it is not written over: this device's record goes beside it, joined to it when the
   * Hidden items are next opened with a password both take.
   */
  async writeIndex(text: string, folders = "[]"): Promise<void> {
    if (!this.key) throw new Error("the Hidden items are locked");
    const next = { index: await sealText(this.key, text), check: await keyCheck(this.key), ...(folders !== "[]" ? { folders: await sealText(this.key, folders) } : {}) };
    const record = (await this.vault())?.record ?? null; // (from the spare when hidden.json is lost: it is written again whole)
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
    const { folders: _was, ...base } = record ?? this.own!;
    await this.save({ ...base, ...next });
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
      if (!bytes || !this.key || (await openFile(this.key, bytes))) continue;
      const opened = await openFile(other, bytes);
      if (!opened) continue;
      const plain = opened.bytes;
      await this.bridge.write(path, opened.item ? await sealFile(this.key, plain, opened.item) : await sealBytes(this.key, plain));
      const back = (await this.bridge.read(path)) as Uint8Array<ArrayBuffer> | null;
      const again = back && (await openFile(this.key, back))?.bytes;
      if (!again || again.length !== plain.length || again.some((v, i) => v !== plain[i])) return false;
    }
    return true;
  }

  /** Seal a hidden item's bytes, with what it is (`item`), as a file that stands on its own (version 2). */
  async seal(bytes: Uint8Array<ArrayBuffer>, item: object): Promise<Uint8Array<ArrayBuffer>> {
    if (!this.key) throw new Error("the Hidden items are locked");
    return sealFile(this.key, bytes, item);
  }

  /** The original of a sealed file, or null while locked (or when it does not open). */
  async open(sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
    return (await this.openItem(sealed))?.bytes ?? null;
  }

  /** A sealed file's bytes and the item it holds (null for a version 1 file), or null while locked (or when it does not open). */
  async openItem(sealed: Uint8Array<ArrayBuffer>): Promise<{ bytes: Uint8Array<ArrayBuffer>; item: Record<string, unknown> | null } | null> {
    if (!this.key) return null;
    for (const key of [this.key, ...this.others.values()]) {
      const opened = await openFile(key, sealed);
      if (opened) return opened;
    }
    return null;
  }
}
