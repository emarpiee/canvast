import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Where the canvast tools keep their own things (the saved devices, the certificate, the pairing code of the link to AI agents): one
 * place for the tools and the desktop app, so the app finds the code the tools made on this computer (ADR 0205). `CANVAST_TOOLS_HOME`
 * moves it.
 */
export const toolsHome = (): string =>
  process.env["CANVAST_TOOLS_HOME"] ??
  (platform() === "win32" ? join(process.env["APPDATA"] ?? homedir(), "canvast-tools") : platform() === "darwin" ? join(homedir(), "Library", "Application Support", "canvast-tools") : join(process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "canvast-tools"));

/** The file of the pairing code (`{ "code": "ABCD-EFGH-JKLM" }`). */
export const agentsFile = (): string => join(toolsHome(), "agents.json");
