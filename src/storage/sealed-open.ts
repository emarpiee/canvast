/**
 * A desktop backup's hidden items, opened where the desktop app is not (the browser build): with their Hidden password, the key file the
 * backup carries gives their key; each file then gives its bytes (checked against its content hash), and its encrypted path its name and
 * folders, as `LibraryMirror.placeOf` reads them in the workspace folder.
 */
import { sha256Hex } from "../assets/sha256";
import type { ImportPlan } from "./archive";
import { SEALED_DIR_RE, nameKeys, openFile, openName, openVault, readVault } from "./hidden-vault";

export interface OpenedHidden {
  hash: string;
  name: string;
  /** Its library folders, from the top (empty: in none). */
  folders: string[];
  bytes: Uint8Array<ArrayBuffer>;
}

/** The key of a backup's hidden items: null when the password is not theirs (or the backup has no key file). */
export async function openBackupKey(plan: Pick<ImportPlan, "hiddenKey">, password: string): Promise<CryptoKey | null> {
  const record = plan.hiddenKey ? readVault(plan.hiddenKey) : null;
  return record ? openVault(record, password) : null;
}

/** Each hidden item of a backup, opened with its key: `null` for one that does not open or is not what its hash says (damaged). */
export async function* openBackupItems(plan: Pick<ImportPlan, "sealed" | "sealedNames">, key: CryptoKey): AsyncGenerator<OpenedHidden | null> {
  const keys = await nameKeys(key);
  const longNames = new Map(plan.sealedNames.map((n) => [n.at, n.data]));
  const nameAt = async (seg: string, longAt: string): Promise<string | null> => {
    if (!SEALED_DIR_RE.test(seg)) return null;
    if (!seg.startsWith("0")) return openName(keys, seg);
    const sealed = longNames.get(longAt);
    const opened = sealed && (await openFile(key, new Uint8Array(await sealed.arrayBuffer())));
    return opened ? new TextDecoder().decode(opened.bytes) : null;
  };
  for (const s of plan.sealed) {
    const opened = await openFile(key, new Uint8Array(await s.data.arrayBuffer()));
    if (!opened || (await sha256Hex(opened.bytes.buffer)) !== s.hash) {
      yield null;
      continue;
    }
    const place = s.at ? await placeOf(s.at, nameAt) : { name: null, folders: [] };
    const own = typeof opened.item?.["name"] === "string" ? (opened.item["name"] as string) : null; // (a file of an earlier version)
    yield { hash: s.hash, name: place.name ?? own ?? `hidden-${s.hash.slice(0, 12)}`, folders: place.folders, bytes: opened.bytes };
  }
}

/** A sealed file's name and folders, from its path in `.hidden/` (a part that does not open keeps its encrypted form). */
async function placeOf(at: string, nameAt: (seg: string, longAt: string) => Promise<string | null>): Promise<{ name: string | null; folders: string[] }> {
  const parts = at.split("/").slice(1); // (after `.hidden`)
  const file = parts.pop() ?? "";
  const folders: string[] = [];
  let dir = ".hidden";
  for (const part of parts) {
    dir += `/${part}`;
    folders.push((await nameAt(part, `${dir}/.name`)) ?? part);
  }
  return { name: await nameAt(file, `${at}.name`), folders };
}
