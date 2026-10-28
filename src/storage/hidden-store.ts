/**
 * The desktop build's encrypted hidden items (ADR 0177, "Hidden items: the design"): the vault in `.canvast/hidden.json` and
 * its data key, held in memory from the moment the Hidden password is given until the app closes or the items are locked.
 * The file is read again each time it is needed, so a password changed on another device is the one asked for here.
 */
import type { DesktopBridge } from "./desktop-bridge";
import type { HiddenState, HiddenStore } from "./store";
import type { VaultRecord } from "./hidden-vault";
import { createVault, openBytes, openText, openVault, readVault, rewrapVault, sealBytes, sealText } from "./hidden-vault";

export const HIDDEN_JSON = ".canvast/hidden.json";

export class HiddenVault implements HiddenStore {
  private key: CryptoKey | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly bridge: DesktopBridge,
    /** How many items are hidden now (the password cannot be removed while there are any). */
    private readonly countHidden: () => Promise<number>,
  ) {}

  private async load(): Promise<VaultRecord | null> {
    const bytes = await this.bridge.read(HIDDEN_JSON);
    return bytes ? readVault(new TextDecoder().decode(bytes)) : null;
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

  async state(): Promise<HiddenState> {
    if (this.key) return "open";
    return (await this.load()) ? "locked" : "none";
  }

  async unlock(password: string): Promise<boolean> {
    const record = await this.load();
    const key = record ? await openVault(record, password) : null;
    if (!key) return false;
    const was = this.key;
    this.key = key;
    if (!was) this.changed();
    return true;
  }

  async setPassword(password: string): Promise<void> {
    const record = await this.load();
    if (!record) {
      const made = await createVault(password);
      await this.save(made.record);
      this.key = made.key;
    } else {
      if (!this.key) throw new Error("the Hidden items are locked: give the current password first");
      await this.save(await rewrapVault(record, this.key, password));
    }
    this.changed();
  }

  async remove(): Promise<boolean> {
    if ((await this.countHidden()) > 0) return false;
    await this.bridge.erase(HIDDEN_JSON);
    this.key = null;
    this.changed();
    return true;
  }

  lock(): void {
    if (!this.key) return;
    this.key = null;
    this.changed();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The hidden items' index (JSON), or null while locked or when there is none. */
  async readIndex(): Promise<string | null> {
    const record = await this.load();
    return record?.index && this.key ? openText(this.key, record.index) : null;
  }

  /** Seal and keep the hidden items' index. Only while open. */
  async writeIndex(text: string): Promise<void> {
    const record = await this.load();
    if (!record || !this.key) throw new Error("the Hidden items are locked");
    await this.save({ ...record, index: await sealText(this.key, text) });
  }

  async seal(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    if (!this.key) throw new Error("the Hidden items are locked");
    return sealBytes(this.key, bytes);
  }

  /** The original of a sealed file, or null while locked (or when it does not open). */
  async open(sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
    return this.key ? openBytes(this.key, sealed) : null;
  }
}
