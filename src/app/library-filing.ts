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

/**
 * Pages taken out of a PDF or a ZIP (a comic's page) go where Settings > Saving to the library says: "source", the folder the PDF or ZIP is
 * in (no folder when it is in none: the default); "frames", the extracted frames' folder (`framesFolder`). With their tags, in one step.
 */
export async function filePages(session: Session, hashes: readonly string[], sourceHash: string, to: "source" | "frames", framesFolder: string, tags: readonly string[] = []): Promise<string> {
  const catalog = session.catalog;
  if (!catalog || !hashes.length) return "the library";
  if (to === "frames") {
    let where = "the library";
    for (const h of hashes) where = await fileInLibrary(session, h, framesFolder, tags);
    return where;
  }
  const folder = (await catalog.entry(sourceHash).catch(() => undefined))?.folderIds?.[0];
  const change = { ...(folder ? { addFolders: [folder] } : { clearFolder: true }), ...(tags.length ? { addTags: tags } : {}) };
  await session.organize((c) => c.updateMetaEach(hashes.map((hash) => ({ hash, change }))));
  return folder ? "the same folder" : "no folder, as the original";
}
