// Naming policy: external reference-product names must not appear in the app's source (src/, desktop/) or in the built app
// (a built file is passed as an argument: test-snap and the release pass theirs). Docs, the README and scripts may name them. The list is base64-encoded so this check
// does not itself introduce the names into the repository's readable text.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ENCODED = ["ZW5kbGVzcyBwYXBlcg==", "ZW5kbGVzc3BhcGVy", "ZnJhY3RpbGU=", "ZmlnbWE=", "cHVyZXJlZg==", "ZWFnbGU="];
const names = ENCODED.map((s) => Buffer.from(s, "base64").toString("utf8"));
const pattern = new RegExp(`\\b(${names.map((n) => n.replace(/\s+/g, "[\\s_-]*")).join("|")})\\b`, "i");

// Third-party manifests and lockfiles are allowed to contain upstream names.
const SOURCE = [/^src\//, /^desktop\//];
const extra = process.argv.slice(2);
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => SOURCE.some((re) => re.test(f)))
  .concat(extra);

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
console.log(`PASS naming policy: ${files.length} source files clean`);
