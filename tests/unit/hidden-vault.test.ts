import { describe, expect, it } from "vitest";
import { SEAL_OVERHEAD, SEALED_COPY_RE, createVault, hiddenFileName, holdsKey, openBytes, openText, openVault, readVault, rewrapVault, sealBytes, sealText } from "../../src/storage/hidden-vault";

const FAST = 100_000; // (the lowest a record may say; the app uses 600,000)

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
    const next = await rewrapVault(record, (await openVault(record, "old"))!, "new");
    expect(next.kdf.salt).not.toBe(record.kdf.salt);
    expect(await openVault(next, "old")).toBeNull();
    expect(Array.from((await openBytes((await openVault(next, "new"))!, sealed))!)).toEqual([42]);
  });

  it("a record tells whether a key is its own without the password (two devices that set a first password at once have two)", async () => {
    const a = await createVault("same", FAST);
    const b = await createVault("same", FAST);
    expect(await holdsKey(a.record, a.key)).toBe(true);
    expect(await holdsKey(a.record, b.key)).toBe(false);
    const rewrapped = readVault(JSON.stringify(await rewrapVault(a.record, a.key, "next")))!;
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
});
