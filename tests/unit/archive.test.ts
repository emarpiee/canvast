import { describe, expect, it } from "vitest";
import { NeedsPassword, WrongPassword, archivePage, archiveWords, openArchive } from "../../src/assets/archive";
import { aesCtrLE } from "../../src/assets/zip-crypto";
import { ZIPS } from "../e2e/zips";

const blobOf = (b64: string): Blob => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]);
const README = "Read me first. ".repeat(30);

describe("archives for viewing (ZIP, CBZ)", () => {
  it("lists folders first, then files, in natural order, and its pictures as pages (2 before 10)", async () => {
    const a = await openArchive(blobOf(ZIPS.plain));
    expect(a.entries.map((e) => e.path)).toEqual(["comic", "comic/pages", "comic/pages/2.png", "comic/pages/10.png", "comic/readme.txt"]);
    expect(a.pages.map((e) => e.name)).toEqual(["2.png", "10.png"]);
    expect(a.locked).toBe(false);
    expect(await (await a.read(a.entries.find((e) => e.name === "readme.txt")!)).text()).toBe(README);
    expect(await (await a.read(a.pages[1]!)).text()).toBe("page ten ".repeat(40));
    expect(await archiveWords(blobOf(ZIPS.plain))).toContain("comic/readme.txt");
    expect(await (await archivePage(blobOf(ZIPS.plain)))!.text()).toBe("page two ");
  });

  for (const kind of ["zipCrypto", "aes128", "aes256"] as const) {
    it(`a password (${kind}): asked for, a wrong one refused, the right one reads stored and deflated files`, async () => {
      const a = await openArchive(blobOf(ZIPS[kind]));
      expect(a.locked).toBe(true);
      const readme = a.entries.find((e) => e.name === "readme.txt")!;
      await expect(a.read(readme)).rejects.toBeInstanceOf(NeedsPassword);
      await expect(a.read(readme, "nope")).rejects.toBeInstanceOf(WrongPassword);
      expect(await (await a.read(readme, "secret")).text()).toBe(README);
      expect(await (await a.read(a.pages[0]!, "secret")).text()).toBe("page two ");
      expect(await (await a.read(a.pages[1]!, "secret")).text()).toBe("page ten ".repeat(40));
      expect(await archivePage(blobOf(ZIPS[kind]))).toBeNull(); // (no card picture from a locked page)
    });
  }

  it("AES's block is the standard one: one block of the little-endian counter matches WebCrypto's AES-CTR, for each key size", async () => {
    for (const n of [16, 24, 32]) {
      const key = Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff);
      const data = Uint8Array.from({ length: 16 }, (_, i) => i * 13);
      const counter = new Uint8Array(16);
      counter[0] = 1;
      const k = await crypto.subtle.importKey("raw", key, "AES-CTR", false, ["encrypt"]);
      const want = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CTR", counter, length: 64 }, k, data));
      expect([...aesCtrLE(key, data)]).toEqual([...want]);
    }
  });

  it("refuses what is not a ZIP", async () => {
    await expect(openArchive(new Blob(["not an archive at all, just some text"]))).rejects.toThrow(/not an archive/);
  });
});
