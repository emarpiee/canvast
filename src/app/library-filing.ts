import type { Session } from "./session";
import { newObjectId } from "../doc/model";

/**
 * File a new library picture (a screenshot, an extracted frame) in a library folder by name (made the first time, at the top level) and put
 * tags on it (ADR 0080, 0081). An empty folder name files it nowhere. Returns where it went, in words.
 */
export async function fileInLibrary(session: Session, hash: string, folderName: string, tags: readonly string[]): Promise<string> {
  const catalog = session.catalog;
  if (!catalog) return "the library";
  const name = folderName.trim();
  if (!name) {
    if (tags.length) await session.organize((c) => c.updateMeta(hash, { addTags: tags }));
    return "the library";
  }
  const listing = await catalog.list();
  const have = listing.folders.find((f) => f.parentId === null && f.name.toLowerCase() === name.toLowerCase());
  const id = have?.id ?? newObjectId();
  if (!have) await session.organize((c) => c.createFolder(name, null, id));
  await session.organize((c) => c.updateMeta(hash, { addFolders: [id], ...(tags.length ? { addTags: tags } : {}) }));
  return `the “${have?.name ?? name}” folder`;
}
