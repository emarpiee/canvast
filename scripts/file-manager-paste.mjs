// Copy file, pasted in real file managers: the app puts a file on the clipboard, each file manager opens on an empty folder under a virtual screen, Ctrl+V is pressed
// in it, and the file that arrives is compared with the original. Run by the `File managers` workflow on GitHub, after `npm run build` and `npm run build:desktop`:
//   xvfb-run -a dbus-run-session node scripts/file-manager-paste.mjs [results.md]
import { _electron as electron } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const MANAGERS = [["Nautilus", "nautilus", ["--new-window"]], ["Nemo", "nemo", []], ["Thunar", "thunar", []], ["PCManFM", "pcmanfm", []], ["Dolphin", "dolphin", ["--new-window"]]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const xdo = (...args) => execFileSync("xdotool", args, { encoding: "utf8" }).trim();

const work = mkdtempSync(join(tmpdir(), "cv-paste-"));
const ws = join(work, "workspace");
const bytes = randomBytes(4096);
const app = await electron.launch({
  args: [resolve("dist-desktop"), `--workspace=${ws}`, `--user-data-dir=${work}/userdata`],
  env: { ...process.env, CANVAST_HASH: "#debug", CANVAST_NO_OPEN: "1" },
});
const page = await app.firstWindow();
await page.waitForFunction(() => typeof window.__canvastDebug !== "undefined", null, { timeout: 60_000 });
await page.getByTestId("view-assets").click();
await page.getByTestId("assets-import-input").setInputFiles({ name: "pasted file.zip", mimeType: "application/zip", buffer: bytes });
const card = page.locator('[data-testid="asset-card"][title="pasted file.zip"]');
await card.waitFor();
await sleep(3000); // (its file is in the workspace folder)
await card.click();
await card.click({ button: "right" });
await page.getByRole("menuitem", { name: "Copy file", exact: true }).click();
await sleep(1000);

const rows = [];
for (const [name, cmd, args] of MANAGERS) {
  const dest = mkdtempSync(join(work, `paste-${cmd}-`));
  const proc = spawn(cmd, [...args, dest], { stdio: "ignore", detached: true });
  let result = "❌ no window";
  proc.on("error", () => void (result = "❌ not installed"));
  try {
    let win = "";
    for (let i = 0; i < 40 && !win; i++) {
      await sleep(500);
      try {
        win = xdo("search", "--onlyvisible", "--name", basename(dest)).split("\n").at(-1) ?? "";
      } catch {
        win = "";
      }
    }
    if (win) {
      xdo("windowactivate", "--sync", win);
      await sleep(1500);
      xdo("key", "--clearmodifiers", "ctrl+v");
      result = "❌ nothing arrived";
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        const got = readdirSync(dest);
        if (!got.length) continue;
        const same = got.length === 1 && readFileSync(join(dest, got[0])).equals(bytes);
        if (same) {
          result = `✅ ${got[0]}`;
          break;
        }
        result = `❌ another file: ${got.join(", ")}`;
      }
    }
  } catch (e) {
    result = `❌ ${String(e).split("\n")[0]}`;
  }
  try {
    process.kill(-proc.pid);
  } catch {
    // (it had ended)
  }
  rows.push([name, result]);
  console.log(name, result);
  await sleep(1000);
}
await app.close();
const table = `| File manager | Paste |\n| --- | --- |\n${rows.map(([n, r]) => `| ${n} | ${r} |`).join("\n")}\n`;
if (process.argv[2]) appendFileSync(process.argv[2], table);
console.log(table);
process.exit(rows.every(([, r]) => r.startsWith("✅")) ? 0 : 1);
