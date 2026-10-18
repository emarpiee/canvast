import type { Session } from "./session";
import { newObjectId } from "../doc/model";
import { sha256Hex } from "../assets/sha256";

/**
 * Importing a folder (ADR 0134): a folder dropped on the window, or chosen with Import folder, brings in every file inside it (to a
 * limit), and the files are put in library folders that follow the folders they came from (made when missing).
 */
const paths = new WeakMap<File, string[]>();
const MAX_FILES = 5000;
const MAX_DEPTH = 16;

/** The names of the folders a file came from, from the top (empty for a file that was not in a folder). */
export const folderPathOf = (f: File): string[] => paths.get(f) ?? [];

/** The folders and files of a drop, taken at once (the drop's items are gone as soon as the handler ends). */
export function entriesOfDrop(dt: DataTransfer | null): FileSystemEntry[] {
  if (!dt) return [];
  return [...dt.items].flatMap((i) => (i.kind === "file" ? (i.webkitGetAsEntry?.() ?? []) : []));
}

export const hasFolder = (entries: readonly FileSystemEntry[]): boolean => entries.some((e) => e.isDirectory);

const readAll = (dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> =>
  new Promise((resolve, reject) => {
    const reader = dir.createReader();
    const all: FileSystemEntry[] = [];
    const next = (): void =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });

/** Every file under the entries (skipping hidden ones), each remembering its folders. */
export async function filesOfEntries(entries: readonly FileSystemEntry[]): Promise<File[]> {
  const out: File[] = [];
  const walk = async (e: FileSystemEntry, path: string[], depth: number): Promise<void> => {
    if (out.length >= MAX_FILES || e.name.startsWith(".")) return;
    if (e.isFile) {
      const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      if (path.length) paths.set(f, path);
      out.push(f);
    } else if (e.isDirectory && depth < MAX_DEPTH) {
      for (const c of await readAll(e as FileSystemDirectoryEntry)) await walk(c, [...path, e.name], depth + 1);
    }
  };
  for (const e of entries) await walk(e, [], 0);
  return out;
}

/** The files of a folder chosen in a file picker (`webkitdirectory`), each remembering its folders. */
export function filesOfPicker(list: FileList | null): File[] {
  const out: File[] = [];
  for (const f of [...(list ?? [])]) {
    const parts = f.webkitRelativePath.split("/");
    if (parts.some((p, i) => i < parts.length - 1 && p.startsWith(".")) || f.name.startsWith(".") || out.length >= MAX_FILES) continue;
    if (parts.length > 1) paths.set(f, parts.slice(0, -1).slice(0, MAX_DEPTH));
    out.push(f);
  }
  return out;
}

/** Put the files that came from folders in library folders of the same names (nested the same way), after they were imported. */
export async function fileByFolders(session: Session, files: readonly File[]): Promise<void> {
  const catalog = session.catalog;
  const wanted = files.filter((f) => folderPathOf(f).length);
  if (!catalog || !wanted.length) return;
  const made = new Map<string, string>(); // "a/b" → folder id
  const listing = await catalog.list();
  const idOf = async (path: string[]): Promise<string> => {
    let parent: string | null = null;
    for (let i = 0; i < path.length; i++) {
      const key = path.slice(0, i + 1).join("/").toLowerCase();
      let id = made.get(key);
      if (!id) {
        const have = listing.folders.find((f) => f.parentId === parent && f.name.toLowerCase() === path[i]!.toLowerCase());
        id = have?.id ?? newObjectId();
        if (!have) {
          const nid = id;
          const p = parent;
          const name = path[i]!;
          await session.organize((c) => c.createFolder(name, p, nid));
          listing.folders.push({ id: nid, name, parentId: p });
        }
        made.set(key, id);
      }
      parent = id;
    }
    return parent!;
  };
  for (const f of wanted) {
    const hash = await sha256Hex(await f.arrayBuffer());
    if (!listing.entries.some((e) => e.hash === hash) && !(await catalog.list()).entries.some((e) => e.hash === hash)) continue; // not imported (a type it does not take)
    const id = await idOf(folderPathOf(f));
    await session.organize((c) => c.updateMeta(hash, { addFolders: [id] }));
  }
}
