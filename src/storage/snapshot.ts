import type { SerializedCamera } from "../core/camera";
import { deserializeCamera, serializeCamera } from "../core/camera";
import type { CanvasObject, SerializedObject } from "../doc/model";
import { deserializeObject, serializeObject } from "../doc/model";
import type { DocumentStore } from "../doc/document-store";
import type { ViewState } from "../app/view-state";
import { idbGet, idbPut } from "./idb";

/**
 * Phase 0B persistence: the whole document as one snapshot record, written
 * after committed transactions (debounced; never per drag event), and the
 * camera in a separate small record. Transient previews are never part of the
 * document, so they cannot be saved by accident.
 */
export const SNAPSHOT_SCHEMA = 1;

export interface SnapshotRecord {
  schema: number;
  app: "canvast";
  savedAt: number;
  revision: number;
  objects: SerializedObject[];
}

export type SaveStatus = "saved" | "pending" | "saving" | "error" | "unavailable";

const DOC_DEBOUNCE_MS = 250;
const CAMERA_DEBOUNCE_MS = 600;

export interface LoadResult {
  objects: CanvasObject[];
  camera: ReturnType<typeof deserializeCamera> | null;
  skipped: string[];
}

export async function loadSnapshot(db: IDBDatabase): Promise<LoadResult> {
  const skipped: string[] = [];
  const rec = await idbGet<SnapshotRecord>(db, "snapshots", "main");
  const objects: CanvasObject[] = [];
  if (rec) {
    if (rec.schema !== SNAPSHOT_SCHEMA) throw new Error(`unsupported snapshot schema ${rec.schema}`);
    for (const s of rec.objects) {
      try {
        objects.push(deserializeObject(s));
      } catch (e) {
        skipped.push(`${String(s?.id)}: ${(e as Error).message}`);
      }
    }
  }
  let camera = null;
  const cam = await idbGet<SerializedCamera>(db, "snapshots", "camera");
  if (cam) {
    try {
      camera = deserializeCamera(cam);
    } catch (e) {
      skipped.push(`camera: ${(e as Error).message}`);
    }
  }
  return { objects, camera, skipped };
}

export class SnapshotWriter {
  status: SaveStatus;
  lastError = "";
  savedRevision = -1;
  private docTimer: ReturnType<typeof setTimeout> | null = null;
  private camTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly db: IDBDatabase | null,
    private readonly doc: DocumentStore,
    private readonly view: ViewState,
  ) {
    this.status = db ? "saved" : "unavailable";
    this.savedRevision = doc.revision;
    if (!db) return;
    doc.subscribe((source) => {
      if (source === "load") {
        this.savedRevision = doc.revision;
        return;
      }
      this.setStatus("pending");
      if (this.docTimer) clearTimeout(this.docTimer);
      this.docTimer = setTimeout(() => void this.flush(), DOC_DEBOUNCE_MS);
    });
    view.subscribe(() => {
      if (this.camTimer) clearTimeout(this.camTimer);
      this.camTimer = setTimeout(() => void this.saveCamera(), CAMERA_DEBOUNCE_MS);
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Write the current document now (also used by tests and before unload). */
  async flush(): Promise<void> {
    if (!this.db) return;
    if (this.docTimer) {
      clearTimeout(this.docTimer);
      this.docTimer = null;
    }
    while (this.inFlight) await this.inFlight;
    if (this.savedRevision === this.doc.revision) {
      if (this.status !== "error") this.setStatus("saved");
      return;
    }
    const revision = this.doc.revision;
    const rec: SnapshotRecord = {
      schema: SNAPSHOT_SCHEMA,
      app: "canvast",
      savedAt: Date.now(),
      revision,
      objects: this.doc.ordered().map(serializeObject),
    };
    this.setStatus("saving");
    this.inFlight = idbPut(this.db, "snapshots", "main", rec)
      .then(() => {
        this.savedRevision = revision;
        this.lastError = "";
        this.setStatus(this.doc.revision === revision ? "saved" : "pending");
      })
      .catch((e: unknown) => {
        this.lastError = e instanceof Error ? e.message : String(e);
        this.setStatus("error");
      })
      .finally(() => {
        this.inFlight = null;
      });
    await this.inFlight;
    if (this.savedRevision !== this.doc.revision && this.status !== "error") await this.flush();
  }

  async saveCamera(): Promise<void> {
    if (!this.db) return;
    try {
      await idbPut(this.db, "snapshots", "camera", serializeCamera(this.view.camera));
    } catch {
      // Camera position is a convenience; document saves report errors.
    }
  }

  private setStatus(s: SaveStatus): void {
    if (s === this.status) return;
    this.status = s;
    for (const fn of this.listeners) fn();
  }
}
