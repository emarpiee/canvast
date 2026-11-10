// README picture of the canvast tools: the real menu the tool prints when it starts (run here, then shown in a terminal window).
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, OUT } from "./scene";

test("tools-menu", async ({ page }) => {
  // (its menu as it prints it, then q to leave)
  const text = execFileSync("node", [resolve("dist-tools/canvast-tools.mjs")], { input: "q\n", encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  await page.setViewportSize({ width: 900, height: 520 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#1b1d22;font:15px/1.5 ui-monospace,"DejaVu Sans Mono",monospace;color:#e6e6e6}
    .win{margin:22px;border-radius:10px;overflow:hidden;box-shadow:0 10px 30px #0008;background:#0f1115}
    .bar{background:#2a2d34;padding:9px 14px;color:#aab;font:13px system-ui,sans-serif}.bar b{display:inline-block;width:11px;height:11px;border-radius:50%;background:#ff5f57;margin-right:6px}
    .bar b+b{background:#febc2e}.bar b+b+b{background:#28c840}
    pre{margin:0;padding:16px 20px;white-space:pre-wrap}.p{color:#7ee787}</style>
    <div class="win"><div class="bar"><b></b><b></b><b></b> &nbsp; Terminal</div><pre><span class="p">$</span> node canvast-tools.mjs\n${esc(text.trim())} <span class="p">▌</span></pre></div>`);
  mkdirSync(OUT, { recursive: true });
  await page.locator(".win").screenshot({ path: resolve(OUT, "tools-menu.png") });
});
