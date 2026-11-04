// The rules for file and folder names live in src/doc/file-names.ts: a component calls them and never writes its own.
// Fails when the list of characters a file cannot hold appears anywhere else in the app.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const HOME = "src/doc/file-names.ts";
const RULE = /\\u0000-\\u001f|\[<>:"\/\\\\|\\\\\/:\*\?"<>\|/;
const files = execFileSync("git", ["ls-files", "src", "desktop"], { encoding: "utf8" }).split("\n").filter((f) => /\.ts$/.test(f) && f !== HOME);
const found = files.filter((f) => {
  try {
    return RULE.test(readFileSync(f, "utf8"));
  } catch {
    return false;
  }
});
if (found.length) {
  console.error(`FAIL name rules: a file-name rule of its own in:\n  ${found.join("\n  ")}\nCall src/doc/file-names.ts.`);
  process.exit(1);
}
console.log(`PASS name rules: ${files.length} files call ${HOME}`);
