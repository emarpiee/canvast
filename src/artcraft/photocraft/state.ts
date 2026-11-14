import type { AssetLibrary } from "../../assets/asset-library";
import type { SettingsStore } from "../../settings/settings";
import type { Session } from "../../app/session";
import { fileInLibrary } from "../../app/library-filing";
import { readZip, writeZip } from "../../storage/zip";
import { PREFS_KEY } from "./prefs";
import { readPresets, writePresets } from "./presets";
import type { PresetFile } from "./presets";

/**
 * PhotoCraft's own state kept with the workspace, so it goes into the workspace's folder, its backups and exports, and to other devices:
 * its preferences (Edit > Preferences, Keyboard Shortcuts, Menus, Toolbar: one JSON) in the workspace setting `photocraft.prefs`, and its
 * preset files (brushes, gradients, patterns, swatches it was given) packed into one library item, `photocraft-presets.zip`, in the
 * library's PhotoCraft folder (concealed: listed only when opened), whose hash is `photocraft.presets`. The browser's copies are only
 * where PhotoCraft reads them while it runs: put back from the workspace before it starts, taken in again while it runs and when it stops.
 */
export interface StateDeps {
  settings: SettingsStore;
  session: Session;
  assets: AssetLibrary;
}

const PRESETS_NAME = "photocraft-presets.zip";
const FOLDER = "PhotoCraft";
/** The same files make the same zip (and so the same library item): its dates are fixed. */
const FIXED_DATE = new Date(Date.UTC(2020, 0, 1));

/** What a set of preset files is, cheaply: their keys and sizes (to know whether they changed without packing them). */
const signature = (files: readonly PresetFile[]): string => JSON.stringify(files.map((f) => [f.key, f.blob.size]));

export function createState(deps: StateDeps): { restore(): Promise<void>; keep(): Promise<void>; keepPrefs(text: string | null): void } {
  const { settings, session, assets } = deps;
  let lastSignature: string | null = null;
  let keeping: Promise<void> = Promise.resolve();

  /** The workspace's state, where PhotoCraft reads it (before it starts). */
  async function restore(): Promise<void> {
    try {
      const prefs = settings.get("photocraft.prefs");
      if (prefs) localStorage.setItem(PREFS_KEY, prefs);
      else localStorage.removeItem(PREFS_KEY);
    } catch {
      // (no storage: it starts with its defaults)
    }
    const hash = settings.get("photocraft.presets");
    let files: PresetFile[] = [];
    if (hash) {
      const rec = await assets.record(hash).catch(() => undefined);
      if (rec) {
        const zip = await readZip(rec.blob);
        const keys = JSON.parse(await (zip.get("keys.json")?.data.text() ?? "[]")) as Array<PresetFile["key"]>;
        files = keys.flatMap((key, i) => {
          const e = zip.get(`files/${i}`);
          return e ? [{ key, blob: e.data }] : [];
        });
      }
    }
    await writePresets(files).catch(() => undefined);
    lastSignature = signature(files);
  }

  /** Its preferences as it just saved them. */
  function keepPrefs(text: string | null): void {
    if (text !== null && text !== settings.get("photocraft.prefs") && text.length <= 4_000_000) settings.set("photocraft.prefs", text);
  }

  /** What it keeps now, into the workspace (its preferences, and its presets when they changed). */
  function keep(): Promise<void> {
    keeping = keeping.then(async () => {
      try {
        keepPrefs(localStorage.getItem(PREFS_KEY));
      } catch {
        // (no storage)
      }
      const files = await readPresets().catch(() => null);
      if (!files) return;
      const sig = signature(files);
      if (sig === lastSignature) return;
      const old = settings.get("photocraft.presets");
      let hash = "";
      if (files.length) {
        const zip = await writeZip([{ name: "keys.json", data: new Blob([JSON.stringify(files.map((f) => f.key))]) }, ...files.map((f, i) => ({ name: `files/${i}`, data: f.blob }))], FIXED_DATE);
        const { record } = await assets.importFileDetailed(new File([zip], PRESETS_NAME, { type: "application/zip" }), false);
        hash = record.hash;
        if (hash !== old) await fileInLibrary(session, hash, FOLDER, ["photocraft"]);
        await concealFolder();
      }
      if (hash !== old) {
        settings.set("photocraft.presets", hash);
        if (old) await session.deleteAssets([old]).catch(() => 0); // (the older pack: into the trash, as any deleted item)
      }
      lastSignature = sig;
    }).catch(() => undefined);
    return keeping;
  }

  /** The library's PhotoCraft folder listed only when opened (its items are PhotoCraft's, not yours to sort). Once. */
  async function concealFolder(): Promise<void> {
    const listing = await session.catalog?.list().catch(() => undefined);
    const folder = listing?.folders.find((f) => f.parentId === null && f.name === FOLDER);
    if (!folder) return;
    let ids: string[] = [];
    try {
      ids = JSON.parse(settings.get("library.concealed")) as string[];
    } catch {
      ids = [];
    }
    if (!ids.includes(folder.id)) settings.set("library.concealed", JSON.stringify([...ids, folder.id]));
  }

  return { restore, keep, keepPrefs };
}
