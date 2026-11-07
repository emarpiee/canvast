import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createVault, nameKeys, sealFile, sealName, sealText, useScrypt } from "../../src/storage/hidden-vault";
import { openBackupIndex, openBackupItems, openBackupKey } from "../../src/storage/sealed-open";

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
    // (the index, sealed as in hidden.json: what each item was, its date and note among it)
    const index = await sealText(key, JSON.stringify([{ hash: sha(art), name: "study.kra", type: "application/octet-stream", size: art.length, pixelW: 1, pixelH: 1, importedAt: 1_700_000_000_000, note: "for later", tags: ["wip"], hidden: true }]));
    const plan = {
      hiddenKey: JSON.stringify({ ...record, index }),
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
    const said = await openBackupIndex(plan, opened!);
    expect([said.get(sha(art))?.importedAt, said.get(sha(art))?.note, said.get(sha(art))?.tags]).toEqual([1_700_000_000_000, "for later", ["wip"]]);
    expect((await openBackupIndex({ hiddenKey: JSON.stringify(record) }, opened!)).size).toBe(0); // (a backup made before it carried one)
  });
});
