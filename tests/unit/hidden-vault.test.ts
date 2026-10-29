import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DesktopBridge } from "../../src/storage/desktop-bridge";
import { HIDDEN_JSON, HIDDEN_KEY_SPARE, HiddenVault } from "../../src/storage/hidden-store";
import { SCRYPT_DEFAULT, SEAL_OVERHEAD, SEALED_COPY_RE, createVault, isFileV2, needsUpgrade, openFile, sealFile, useScrypt, hiddenFileName, holdsKey, openBytes, openText, openVault, readVault, rewrapVault, sameKey, sealBytes, sealText } from "../../src/storage/hidden-vault";

const FAST = { name: "PBKDF2", iterations: 100_000 } as const; // (a version 1 vault, at the lowest a record may say)
// scrypt as the desktop app's main process does it (Node's native one), with the same parameters.
const nodeScrypt = async (password: string, salt: Uint8Array, N: number, r: number, p: number) =>
  new Uint8Array(scryptSync(Buffer.from(password, "utf8"), Buffer.from(salt), 32, { N, r, p, maxmem: 256 * N * r + 2 ** 24 }));
useScrypt(nodeScrypt);

describe("hidden vault", () => {
  it("seals and opens bytes and the index with the data key; the right password opens it, a wrong one does not", async () => {
    const { record, key } = await createVault("correct horse", FAST);
    const bytes = new Uint8Array([1, 2, 3, 250, 0, 9]);
    const sealed = await sealBytes(key, bytes);
    expect(sealed.length).toBe(bytes.length + SEAL_OVERHEAD);
    const again = await openVault(JSON.parse(JSON.stringify(record)), "correct horse");
    expect(Array.from((await openBytes(again!, sealed))!)).toEqual(Array.from(bytes));
    expect(await openVault(record, "wrong")).toBeNull();
    const index = await sealText(key, '[{"name":"Secret.png"}]');
    expect(JSON.stringify(index)).not.toContain("Secret");
    expect(await openText(again!, index)).toBe('[{"name":"Secret.png"}]');
    expect(readVault(JSON.stringify({ ...record, index }))).not.toBeNull();
  });

  it("a changed byte, another key, or a damaged record is refused", async () => {
    const a = await createVault("one", FAST);
    const b = await createVault("one", FAST);
    const sealed = await sealBytes(a.key, new Uint8Array([5, 6, 7]));
    expect(await openBytes(b.key, sealed)).toBeNull(); // same password, another key
    const flipped = sealed.slice();
    flipped[flipped.length - 1]! ^= 1;
    expect(await openBytes(a.key, flipped)).toBeNull();
    expect(readVault(JSON.stringify({ ...a.record, kdf: { ...a.record.kdf, iterations: 10 } }))).toBeNull();
    expect(readVault(JSON.stringify({ ...a.record, format: "x" }))).toBeNull();
    expect(readVault("not json")).toBeNull();
  });

  it("a new password wraps the same key: files sealed before still open, the old password no longer does", async () => {
    const { record, key } = await createVault("old", FAST);
    const sealed = await sealBytes(key, new Uint8Array([42]));
    expect(await rewrapVault(record, "wrong", "new")).toBeNull(); // (the current password is needed: the key in memory cannot be read out)
    const next = (await rewrapVault(record, "old", "new"))!;
    expect(next.kdf.salt).not.toBe(record.kdf.salt);
    expect(await openVault(next, "old")).toBeNull();
    expect(Array.from((await openBytes((await openVault(next, "new"))!, sealed))!)).toEqual([42]);
  });

  it("a record tells whether a key is its own without the password (two devices that set a first password at once have two)", async () => {
    const a = await createVault("same", FAST);
    const b = await createVault("same", FAST);
    expect(await holdsKey(a.record, a.key)).toBe(true);
    expect(await holdsKey(a.record, b.key)).toBe(false);
    expect([await sameKey(a.key, a.key), await sameKey(a.key, b.key)]).toEqual([true, false]);
    // The key in memory is never extractable: no code in the page can read it out.
    expect([a.key.extractable, (await openVault(a.record, "same"))!.extractable]).toEqual([false, false]);
    await expect(crypto.subtle.exportKey("raw", a.key)).rejects.toThrow();
    const rewrapped = readVault(JSON.stringify(await rewrapVault(a.record, "same", "next")))!;
    expect(await holdsKey(rewrapped, a.key)).toBe(true); // (kept under a new password)
    // A record of an earlier version has no check: its index tells, and with none, only the password can.
    const { check: _c, ...old } = a.record;
    expect(await holdsKey({ ...old, index: await sealText(a.key, "[]") }, b.key)).toBe(false);
    expect(await holdsKey(old, a.key)).toBeNull();
  });

  it("hidden file names are random and say nothing", () => {
    const a = hiddenFileName();
    expect(a).toMatch(/^\.hidden\/[0-9a-f]{32}\.bin$/);
    expect(hiddenFileName()).not.toBe(a);
    // A sync tool's copy of a sealed file is still a sealed file (never sealed again); a readable file is not.
    for (const copy of [a.replace(".bin", " (1).bin"), a.replace(".bin", ".sync-conflict-20261029-1200-ABC.bin"), a]) expect(copy).toMatch(SEALED_COPY_RE);
    expect(".hidden/Secret.png").not.toMatch(SEALED_COPY_RE);
  });

  it("scrypt as the app calls it gives RFC 7914's test value; a new vault uses it (version 2), and an old one is upgraded when opened", async () => {
    const rfc = Array.from(await nodeScrypt("pleaseletmein", new TextEncoder().encode("SodiumChloride"), 16_384, 8, 1), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(rfc).toBe("7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2"); // (RFC 7914 §12, its first 32 bytes)
    const made = await createVault("pw");
    expect([made.record.version, made.record.kdf]).toEqual([2, { name: "scrypt", ...SCRYPT_DEFAULT, salt: made.record.kdf.salt }]);
    expect(readVault(JSON.stringify(made.record))).not.toBeNull();
    expect(await openVault(made.record, "nope")).toBeNull();
    // A version 1 vault (PBKDF2) in a folder: opening it wraps the same key with scrypt, its spare too; files sealed before still open.
    const files = new Map<string, Uint8Array>();
    const bridge = {
      read: async (p: string) => files.get(p) ?? null,
      write: async (p: string, b: Uint8Array) => void files.set(p, b),
      exists: async (p: string) => files.has(p),
      erase: async (p: string) => void files.delete(p),
      list: async (dir: string) => [...files.keys()].filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/")).map((p) => p.slice(dir.length + 1)),
    } as unknown as DesktopBridge;
    const old = await createVault("pw", FAST);
    const sealed = await sealBytes(old.key, new Uint8Array([7, 8, 9]));
    files.set(HIDDEN_JSON, new TextEncoder().encode(JSON.stringify(old.record)));
    expect(needsUpgrade(old.record)).toBe(true);
    const vault = new HiddenVault(bridge, async () => 0);
    expect(await vault.unlock("pw")).toBe(true);
    const now = readVault(new TextDecoder().decode(files.get(HIDDEN_JSON)!))!;
    const spare = readVault(new TextDecoder().decode(files.get(HIDDEN_KEY_SPARE)!))!;
    expect([now.version, now.kdf.name, spare.version, spare.key]).toEqual([2, "scrypt", 2, now.key]);
    expect(Array.from((await vault.open(sealed))!)).toEqual([7, 8, 9]);
    expect(Array.from((await openBytes((await openVault(now, "pw"))!, sealed))!)).toEqual([7, 8, 9]);
  });

  it("a version 2 file holds its item and its bytes in chunks; any size round-trips, and a cut, a swap, a flipped bit or another key fails", async () => {
    const { key } = await createVault("pw", FAST);
    const other = (await createVault("pw", FAST)).key;
    const item = { name: "Plan.png", folderPath: ["Work", "Secret"], tags: ["a"] };
    const C = 1024; // (small chunks, so a few kilobytes make several)
    const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255);
    for (const n of [0, 1, C - 1, C, C + 1, 3 * C, 3 * C + 5]) {
      const sealed = await sealFile(key, bytes(n), item, C);
      expect(isFileV2(sealed)).toBe(true);
      const opened = (await openFile(key, sealed))!;
      expect([opened.bytes.length, opened.item]).toEqual([n, item]);
      expect(Array.from(opened.bytes)).toEqual(Array.from(bytes(n)));
    }
    const sealed = await sealFile(key, bytes(3 * C + 5), item, C);
    const start = sealed.length - (3 * C + 5) - 4 * 16;
    expect(await openFile(other, sealed)).toBeNull(); // another key
    expect(await openFile(key, sealed.slice(0, start + 2 * (C + 16)))).toBeNull(); // cut at a chunk's end: the last is missing
    expect(await openFile(key, sealed.slice(0, -1))).toBeNull();
    const swapped = sealed.slice();
    swapped.set(sealed.subarray(start + C + 16, start + 2 * (C + 16)), start);
    swapped.set(sealed.subarray(start, start + C + 16), start + C + 16);
    expect(await openFile(key, swapped)).toBeNull(); // two chunks swapped
    for (const at of [10, start - 1, start + 5, sealed.length - 1]) {
      const flipped = sealed.slice();
      flipped[at]! ^= 1;
      expect(await openFile(key, flipped)).toBeNull(); // the header, a chunk, the last tag
    }
    // A version 1 file still opens (no item in it).
    expect(await openFile(key, await sealBytes(key, bytes(9)))).toEqual({ bytes: bytes(9), item: null });
    // Nothing of the item or the bytes is readable in the file.
    expect(new TextDecoder().decode(sealed)).not.toContain("Plan");
  });
});
