import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createVault, nameKeys, sealFile, sealName, useScrypt } from "../../src/storage/hidden-vault";
import { openBackupItems, openBackupKey } from "../../src/storage/sealed-open";

const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

describe("a desktop backup's hidden items, opened in the browser", () => {
  it("opens their key with their password (scrypt in JavaScript), and each file with its name and folders; a wrong password or a changed file does not", async () => {
    useScrypt(null); // (the browser: no native scrypt)
    const { record, key } = await createVault("open sesame", { name: "scrypt", N: 16_384, r: 8, p: 1 });
    const keys = await nameKeys(key);
    const art = new TextEncoder().encode("a painting") as Uint8Array<ArrayBuffer>;
    const long = "A name long enough to be kept beside its file. ".repeat(4).trim();
    const folder = (await sealName(keys, "Refs")).seg;
    const file = (await sealName(keys, "study.kra")).seg;
    const longSeg = await sealName(keys, long);
    expect(longSeg.long).toBe(true);
    const plan = {
      hiddenKey: JSON.stringify(record),
      sealed: [
        { hash: sha(art), data: new Blob([await sealFile(key, art, { hash: sha(art) })]), at: `.hidden/${folder}/${file}` },
        { hash: sha(art), data: new Blob([await sealFile(key, art, { hash: sha(art) })]), at: `.hidden/${longSeg.seg}` },
        { hash: "0".repeat(64), data: new Blob([await sealFile(key, art, {})]), at: `.hidden/${file}` }, // (not what its hash says)
      ],
      sealedNames: [{ at: `.hidden/${longSeg.seg}.name`, data: new Blob([await sealFile(key, new TextEncoder().encode(long) as Uint8Array<ArrayBuffer>, {})]) }],
    };
    expect(await openBackupKey(plan, "wrong")).toBeNull();
    const opened = await openBackupKey(plan, "open sesame");
    expect(opened).not.toBeNull();
    const items = [];
    for await (const it of openBackupItems(plan, opened!)) items.push(it && { name: it.name, folders: it.folders, text: new TextDecoder().decode(it.bytes) });
    expect(items).toEqual([{ name: "study.kra", folders: ["Refs"], text: "a painting" }, { name: long, folders: [], text: "a painting" }, null]);
  });
});
