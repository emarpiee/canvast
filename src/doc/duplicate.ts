/**
 * A copy of a canvas's stored objects (ADR 0110): every object gets a new id, and everything that names an object or a group follows (the
 * sheet it is on, the object it is attached to, its groups and their names, boolean groups and their result), so the copy
 * is a canvas of its own whose links never lead back to the original. Pure: it works on the stored form.
 */
import { newObjectId } from "./model";
import type { SerializedObject } from "./model";

export function duplicateRecords(records: readonly SerializedObject[], newId: () => string = newObjectId): SerializedObject[] {
  const ids = new Map<string, string>();
  for (const r of records) ids.set(r.id, newId());
  const groups = new Map<string, string>();
  const gid = (g: string): string => groups.get(g) ?? (groups.set(g, newId()), groups.get(g)!);
  const mapKeys = (o: unknown): Record<string, unknown> | undefined =>
    o && typeof o === "object" ? Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [gid(k), v])) : undefined;
  return records.map((r) => {
    const s: SerializedObject = { ...r, id: ids.get(r.id)! };
    if (typeof r["parent"] === "string") s["parent"] = ids.get(r["parent"]) ?? r["parent"];
    if (typeof r["attachmentTargetId"] === "string") s["attachmentTargetId"] = ids.get(r["attachmentTargetId"]) ?? null;
    if (Array.isArray(r["groups"])) s["groups"] = (r["groups"] as string[]).map(gid);
    if (r["groupNames"]) s["groupNames"] = mapKeys(r["groupNames"]);
    if (r["boolOps"]) s["boolOps"] = mapKeys(r["boolOps"]);
    if (typeof r["result"] === "string") s["result"] = gid(r["result"]);
    return s;
  });
}
