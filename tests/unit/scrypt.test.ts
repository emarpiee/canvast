import { describe, expect, it } from "vitest";
import { scryptSync } from "node:crypto";
import { scryptJs } from "../../src/storage/scrypt";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

describe("scrypt in JavaScript (the browser opens a desktop backup's hidden items)", () => {
  it("gives RFC 7914's test vector", async () => {
    const out = await scryptJs("password", new TextEncoder().encode("NaCl"), 1024, 8, 16, 64);
    expect(hex(out)).toBe("fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640");
  });
  it("is what Node's native scrypt gives, as the desktop app's", async () => {
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const out = await scryptJs("pässwörd", salt, 4096, 8, 1);
    expect(hex(out)).toBe(scryptSync(Buffer.from("pässwörd", "utf8"), salt, 32, { N: 4096, r: 8, p: 1 }).toString("hex"));
  });
});
