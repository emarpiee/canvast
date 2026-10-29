// First-party naming policy: external reference-product names must not appear
// in shipped or first-party text. The list is base64-encoded so this check
// does not itself introduce the names into the repository's readable text.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ENCODED = ["ZW5kbGVzcyBwYXBlcg==", "ZW5kbGVzc3BhcGVy", "ZnJhY3RpbGU=", "ZmlnbWE=", "cHVyZXJlZg==", "ZWFnbGU="];
const names = ENCODED.map((s) => Buffer.from(s, "base64").toString("utf8"));
const pattern = new RegExp(`\\b(${names.map((n) => n.replace(/\s+/g, "[\\s_-]*")).join("|")})\\b`, "i");

// Third-party manifests and lockfiles are allowed to contain upstream names.
// docs/creative-tools.md is the owner's own list of other artists' tools, which names them on purpose (asked for 2026-10-29).
const ALLOW = [/^package-lock\.json$/, /^node_modules\//, /^docs\/creative-tools\.md$/];
const extra = process.argv.slice(2);
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .concat(extra)
  .filter((f) => !ALLOW.some((re) => re.test(f)));

const hits = [];
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, i) => {
    if (pattern.test(line)) hits.push(`${f}:${i + 1}`);
  });
}
if (hits.length) {
  console.error(`FAIL naming policy: external product name found at\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log(`PASS naming policy: ${files.length} first-party files clean`);
