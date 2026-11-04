/** Two library folders become one: the items of one, and its subfolders, go into the other, and it goes. On the catalog, so it is one step of the library's undo. */
import type { AssetFolder } from "../assets/asset-catalog";
import { meta } from "../assets/asset-catalog";
import { sameOnDisk } from "../doc/file-names";
import { numberedName } from "../doc/file-names";
import { newObjectId } from "../doc/model";
import type { CatalogStore } from "../storage/store";

/** A name beside these folders that a disk does not take for any of them: `Refs-2`. */
export function freeFolderName(folders: readonly AssetFolder[], parentId: string | null, name: string, except?: string): string {
  const here = folders.filter((f) => f.id !== except && (f.parentId ?? null) === parentId);
  for (let n = 2; ; n++) {
    const next = numberedName(name.trim(), n);
    if (!here.some((f) => sameOnDisk(f.name, next))) return next;
  }
}

/** Every item of `fromId` filed in `intoId`, each subfolder joined to its like there or moved there, and `fromId` gone. No item leaves the library. */
export async function mergeFolderInto(c: CatalogStore, fromId: string, intoId: string): Promise<void> {
  const listing = await c.list();
  const folders = listing.folders;
  const inFolder = (id: string): string[] => listing.entries.filter((e) => meta(e).folderIds[0] === id).map((e) => e.hash);
  const made: AssetFolder[] = [];
  const join = async (from: string, into: string): Promise<void> => {
    const items = inFolder(from);
    if (items.length) await c.updateMetaEach(items.map((hash) => ({ hash, change: { addFolders: [into] } })));
    for (const sub of folders.filter((f) => f.parentId === from)) {
      const like = [...folders, ...made].find((f) => f.id !== sub.id && f.parentId === into && sameOnDisk(f.name, sub.name));
      const target = like?.id ?? newObjectId();
      if (!like) made.push(await c.createFolder(sub.name, into, target));
      await join(sub.id, target);
    }
  };
  await join(fromId, intoId);
  await c.deleteFolder(fromId); // (its subfolders with it: all empty now)
}
