/**
 * The desktop build's library index (SQLite, main process): a rebuildable copy of the library's part files, kept so a big library
 * opens and is browsed without reading every part into the page. The part files stay the truth; the database can be deleted.
 */
import Database from "better-sqlite3";

export type LibraryDb = InstanceType<typeof Database>;

export function openLibraryDb(file: string): LibraryDb {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL"); // (safe with WAL: a crash may lose the last moments, never corrupts)
  db.pragma("cache_size = -65536");
  return db;
}
