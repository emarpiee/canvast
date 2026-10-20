/**
 * Browser storage limits made visible (README, Limitations). A full store is reported in plain words with what to do,
 * and the browser is asked once not to evict the data. Nothing here raises the cap.
 */

/** Warn when the browser reports this share of its quota used. */
export const NEAR_FULL = 0.8;

export const FULL_MESSAGE = "the browser's storage is full. Export a backup, then delete unused files from the library";

/** True for the error a browser raises when a write does not fit (name differs between browsers). */
export function isQuotaError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || /quota/i.test(String((e as Error | null)?.message ?? ""));
}

type Manager = Pick<StorageManager, "estimate" | "persist" | "persisted">;
const manager = (): Partial<Manager> | undefined => (typeof navigator === "undefined" ? undefined : navigator.storage);

/** Share of the quota in use (0 to 1), or null when the browser does not report it. */
export async function usageShare(sm: Partial<Manager> | undefined = manager()): Promise<number | null> {
  try {
    const est = await sm?.estimate?.();
    return est?.usage !== undefined && est.quota ? est.usage / est.quota : null;
  } catch {
    return null;
  }
}

let asked = false;
/** Ask the browser once per page load to keep this data under storage pressure. Chromium grants silently; Firefox may prompt. */
export async function requestPersistence(sm: Partial<Manager> | undefined = manager()): Promise<void> {
  if (asked || !sm?.persist) return;
  asked = true;
  try {
    if (!(await sm.persisted?.())) await sm.persist();
  } catch {
    // the storage panel still offers the button
  }
}

let warned = false;
/** The notice for a nearly full store, once per page load; null otherwise. */
export async function nearFullNotice(sm: Partial<Manager> | undefined = manager()): Promise<string | null> {
  if (warned) return null;
  const share = await usageShare(sm);
  if (share === null || share < NEAR_FULL) return null;
  warned = true;
  return `Storage is ${Math.round(share * 100)}% full. Export a backup from the storage panel and delete unused files from the library before it fills.`;
}

/** Test hook: forget what was asked and warned. */
export function resetQuotaNotices(): void {
  asked = false;
  warned = false;
}
