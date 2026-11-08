/**
 * The desktop app as a guest (ADR 0184): a window showing the page a host serves, as a browser would, with no bridge (the page is a
 * guest's: it reads through the host). Its certificate is pinned: the window accepts only the one whose fingerprint the person
 * confirmed, kept in the app's settings folder.
 */
import { BrowserWindow, app, ipcMain, session } from "electron";
import type { BrowserWindow as Win } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import { fingerprintOf } from "./self-cert";
import { findHosts, parseAddress } from "./share-find";

const file = (): string => join(app.getPath("userData"), "hosts.json");
type Pins = Record<string, string>; // "address:port" → fingerprint
function pins(): Pins {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as Pins;
  } catch {
    return {};
  }
}

/** A host's certificate fingerprint, read from its TLS greeting (before anything is trusted). */
function fingerprintAt(address: string, port: number): Promise<string> {
  return new Promise((ok, fail) => {
    const req = request({ host: address, port, path: "/hello", method: "GET", rejectUnauthorized: false, timeout: 5000 }, (res) => {
      const fp = (res.socket as TLSSocket).getPeerCertificate().fingerprint256;
      res.resume();
      res.on("end", () => (fp ? ok(fp) : fail(new Error("no certificate"))));
    });
    req.on("timeout", () => req.destroy(new Error("The computer did not answer.")));
    req.on("error", (e) => fail(new Error(`Could not reach ${address}:${port} (${e.message}).`)));
    req.end();
  });
}


export function installGuestCalls(win: Win): void {
  ipcMain.handle("canvast:guest", async (e, op: unknown, arg: unknown) => {
    if (e.sender !== win.webContents) throw new Error("not this window");
    if (op === "find") return findHosts();
    if (op === "check") {
      const at = typeof arg === "string" ? parseAddress(arg) : null;
      if (!at) return { error: "Type the address as Settings > Sharing shows it on the other computer, such as 192.168.1.5:47000." };
      try {
        const fingerprint = await fingerprintAt(at.address, at.port);
        return { ...at, fingerprint, known: pins()[`${at.address}:${at.port}`] === fingerprint };
      } catch (err) {
        return { error: (err as Error).message };
      }
    }
    if (op === "open") {
      const a = arg as { address?: unknown; port?: unknown; fingerprint?: unknown } | null;
      if (typeof a?.address !== "string" || !Number.isInteger(a.port) || typeof a.fingerprint !== "string") throw new Error("a host expected");
      const key = `${a.address}:${a.port as number}`;
      writeFileSync(file(), JSON.stringify({ ...pins(), [key]: a.fingerprint }));
      openGuestWindow(a.address, a.port as number, a.fingerprint);
      return null;
    }
    throw new Error("not a guest call");
  });
}

function openGuestWindow(address: string, port: number, fingerprint: string): void {
  // (its own storage per host, apart from the workspace's)
  const ses = session.fromPartition(`persist:guest-${fingerprint.replace(/:/g, "").slice(0, 32)}`);
  ses.setCertificateVerifyProc((req, done) => {
    if (req.hostname !== address.replace(/^\[|\]$/g, "")) return done(-3); // (anything else: as Chromium decides)
    const der = Buffer.from(req.certificate.data.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
    done(fingerprintOf(der) === fingerprint ? 0 : -2);
  });
  const w = new BrowserWindow({ width: 1400, height: 900, title: `Shared · ${address}`, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  w.setMenuBarVisibility(false);
  void w.loadURL(`https://${address}:${port}/`);
}
