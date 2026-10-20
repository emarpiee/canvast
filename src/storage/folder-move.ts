/** Move originals between the browser's storage and the library folder (ADR 0159), one at a time, each proven before the other copy goes. */
import type { AssetRecord } from "../assets/asset-library";
import { done, idbGet, req } from "./idb";
import { externalFolder, externalHashes, folderFileName } from "./external-folder";
import { isQuotaError } from "./quota";

export interface MoveReport {
  moved: number;
  failed: number;
  /** The first reason, in plain words. */
  why: string;
}

const EMPTY = (): Blob => new Blob([]);

async function eachKey(db: IDBDatabase, wantExternal: boolean): Promise<string[]> {
  const ext = new Set(await externalHashes(db));
  const tx = db.transaction("assets", "readonly");
  const all = (await req(tx.objectStore("assets").getAllKeys())) as string[];
  return all.filter((k) => ext.has(k) === wantExternal);
}

async function run(db: IDBDatabase, keys: string[], one: (hash: string) => Promise<boolean>, progress: (done: number, total: number) => void): Promise<MoveReport> {
  const r: MoveReport = { moved: 0, failed: 0, why: "" };
  for (const [i, k] of keys.entries()) {
    progress(i, keys.length);
    try {
      if (await one(k)) r.moved++;
    } catch (e) {
      r.failed++;
      r.why ||= isQuotaError(e) ? "the browser's storage is full" : (e as Error).message || (e as Error).name;
      if (isQuotaError(e)) break; // the next ones would fail the same way
    }
  }
  progress(keys.length, keys.length);
  void db;
  return r;
}

/** Originals now in the browser go to the folder: written, read back and compared, then replaced by a stub. */
export async function moveToFolder(db: IDBDatabase, progress: (done: number, total: number) => void = () => undefined): Promise<MoveReport> {
  return run(db, await eachKey(db, false), async (hash) => {
    const rec = await idbGet<AssetRecord>(db, "assets", hash);
    if (!rec || rec.ext) return false;
    const file = folderFileName(hash, rec.name, rec.type);
    await externalFolder.write(hash, rec.blob, file);
    const tx = db.transaction("assets", "readwrite", { durability: "strict" });
    const committed = done(tx);
    const cur = await req(tx.objectStore("assets").get(hash) as IDBRequest<AssetRecord | undefined>);
    // Changed in the meantime (another tab): leave it, the file is only an extra copy.
    if (cur && !cur.ext && cur.blob.size === rec.blob.size) tx.objectStore("assets").put({ ...cur, size: cur.blob.size, blob: EMPTY(), ext: 1, file }, hash);
    await committed;
    return true;
  }, progress);
}

/** Originals in the folder come back into the browser's storage; the files are removed once stored. */
export async function moveFromFolder(db: IDBDatabase, progress: (done: number, total: number) => void = () => undefined): Promise<MoveReport> {
  return run(db, await eachKey(db, true), async (hash) => {
    const rec = await idbGet<AssetRecord>(db, "assets", hash);
    if (!rec?.ext) return false;
    const blob = await externalFolder.read(hash, rec.size, rec.type, rec.file);
    if (!blob) throw new Error("a file is missing from the library folder");
    const tx = db.transaction("assets", "readwrite", { durability: "strict" });
    const committed = done(tx);
    const { ext: _ext, file: _file, ...plain } = rec;
    tx.objectStore("assets").put({ ...plain, blob } satisfies AssetRecord, hash);
    await committed;
    await externalFolder.remove(hash, rec.file);
    return true;
  }, progress);
}

/** Files made before names had extensions (a bare hash) are written again as `<hash>.<ext>`, proven, and the old one removed. */
export async function addExtensions(db: IDBDatabase, progress: (done: number, total: number) => void = () => undefined): Promise<MoveReport> {
  const keys: string[] = [];
  for (const h of await externalHashes(db)) if (!(await idbGet<AssetRecord>(db, "assets", h))?.file) keys.push(h);
  return run(db, keys, async (hash) => {
    const rec = await idbGet<AssetRecord>(db, "assets", hash);
    if (!rec?.ext || rec.file) return false;
    const blob = await externalFolder.read(hash, rec.size, rec.type);
    if (!blob) throw new Error("a file is missing from the library folder");
    const file = folderFileName(hash, rec.name, rec.type);
    await externalFolder.write(hash, blob, file);
    const tx = db.transaction("assets", "readwrite", { durability: "strict" });
    const committed = done(tx);
    const cur = await req(tx.objectStore("assets").get(hash) as IDBRequest<AssetRecord | undefined>);
    if (cur?.ext && !cur.file) tx.objectStore("assets").put({ ...cur, file }, hash);
    await committed;
    await externalFolder.remove(hash); // the bare-hash file
    return true;
  }, progress);
}
