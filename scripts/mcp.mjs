#!/usr/bin/env node
// canvast's MCP server for an AI agent working in this repository (ADR 0205): `node scripts/mcp.mjs`, which the project files
// `.mcp.json` (Claude Code), `.cursor/mcp.json` (Cursor) and `.vscode/mcp.json` (VS Code) start. It builds the canvast tools when they are
// missing or older than their source, then runs `canvast-tools mcp`. The standard output is the protocol's: everything said goes to the
// standard error. Any other MCP client: the same command.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tools = join(root, "dist-tools", "canvast-tools.mjs");
const sources = [join(root, "scripts", "tools"), join(root, "desktop"), join(root, "scripts", "hidden-items.mjs"), join(root, "package.json")];
const newest = (p) => (statSync(p).isDirectory() ? Math.max(0, ...readdirSync(p).map((n) => newest(join(p, n)))) : statSync(p).mtimeMs);
if (!existsSync(tools) || Math.max(...sources.filter(existsSync).map(newest)) > statSync(tools).mtimeMs) {
  process.stderr.write("canvast: building the canvast tools…\n");
  const built = spawnSync(process.execPath, [join(root, "scripts", "tools", "build-tools.mjs")], { cwd: root, stdio: ["ignore", process.stderr, process.stderr] });
  if (built.status !== 0) {
    process.stderr.write("canvast: the tools could not be built: run npm install in the repository first.\n");
    process.exit(1);
  }
}
const server = spawn(process.execPath, [tools, "mcp", ...process.argv.slice(2)], { cwd: root, stdio: "inherit" });
server.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill(sig));
