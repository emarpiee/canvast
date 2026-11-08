/**
 * Settings > Sharing (desktop, ADR 0184): share this workspace read-only on the local network, its address, code and certificate
 * fingerprint, whether the hidden items' encrypted files go too, and the devices allowed (each can be removed). A device asking to
 * connect is answered from anywhere in the app.
 */
import type { ShareCalls, ShareStatus } from "../storage/desktop-bridge";
import type { HiddenFiles } from "../storage/store";
import { confirmDialog } from "./confirm";
import { ICONS } from "./icons";
import { plural } from "../doc/plural";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const when = (t: number | null): string => (t ? new Date(t).toLocaleString() : "never");

/** The file managers' folder asks for hidden items: answered from this page, which holds their key while they are open (once, at start). */
export function installShareFolder(share: ShareCalls, files: HiddenFiles): void {
  share.onDav((a) => {
    const value = a.op === "list" ? files.list() : a.arg ? files.read(a.arg.path, a.arg.from, a.arg.to) : Promise.resolve(null);
    void value.catch(() => null).then((v) => share.call("davAnswer", { id: a.id, value: v }));
  });
}

/** Ask the person whether a device may connect, whenever one asks (once, at start). */
export function installShareAsk(share: ShareCalls): void {
  share.onAsk((a) => {
    void confirmDialog({
      title: `Let ${a.name} see this workspace?`,
      lines: ["It typed this computer's sharing code. Allowed, it can look at every board, canvas and library item, without changing anything, until you remove it in Settings > Sharing."],
      facts: [["Device", a.name], ["Address", a.address.replace(/^::ffff:/, "")]],
      confirmLabel: "Allow",
      danger: false,
    }).then((ok) => share.call("answer", { id: a.id, ok }));
  });
}

let shown: ((st: ShareStatus) => void) | null = null;

/** The tab's body, kept up to date while it is shown. */
/** A switch row of the settings (their one look is settings-view.ts's). */
export type SwitchRow = (o: { id: string; attrs: string; label: string; help: string; on: boolean; disabled?: boolean }) => string;

export function mountSharing(host: HTMLElement, share: ShareCalls, row: SwitchRow): void {
  const draw = (st: ShareStatus): void => {
    if (!host.isConnected) return;
    const urls = st.addresses.map((a) => `https://${a}:${st.port}`);
    host.innerHTML = `<div class="set-card set-info" data-testid="share-card"><h3>Share this workspace</h3>
      ${row({ id: "share-on", attrs: 'data-share-on data-testid="share-on"', label: "Share on the local network", help: "Others on this network can look at your boards, canvases and library, in a browser or the app. They cannot change anything.", on: st.on })}
      ${
        st.on
          ? `<dl data-testid="share-facts"><dt>Address</dt><dd>${urls.map((u) => `<code>${esc(u)}</code>`).join("<br>") || "No network found"}</dd>
          <dt>Code</dt><dd><strong data-testid="share-code">${esc(st.code)}</strong></dd>
          <dt>Fingerprint</dt><dd><code>${esc(st.fingerprint)}</code></dd>
          ${st.dav ? `<dt>Folder</dt><dd><code data-testid="share-dav-url">${esc(st.dav.url)}</code><br>Password: <code data-testid="share-dav-password">${esc(st.dav.password)}</code><br><button type="button" class="set-done" data-share-open-dav data-testid="share-open-dav">Open in the file manager</button></dd>` : ""}</dl>
          <p class="set-help">The folder shows your library's files to file managers, read-only (on another computer, with this computer's address). On this computer only, and while the Hidden items are open, it also has a Hidden folder: each file is decrypted only as it is read. A file manager may keep thumbnails of what it shows.</p>
          <p class="set-help">A guest opens the address and types the code, and you are asked to allow the device. A browser warns once about the certificate: it is this computer's own; its fingerprint is the one above. Sharing stops when the app closes.</p>`
          : ""
      }
      ${row({ id: "share-hidden", attrs: 'data-share-hidden data-testid="share-hidden"', label: "Share hidden items too", help: "Their files go out encrypted, as they are in the folder; a guest needs your Hidden password to open them.", on: st.hidden, disabled: !st.on })}</div>
      <div class="set-card" data-testid="share-devices"><h3>Allowed devices</h3>
      ${
        st.devices.length
          ? `<ul class="share-devices">${st.devices
              .map(
                (d) => `<li class="share-device"><span class="share-dot${d.active ? " is-on" : ""}" title="${d.active ? "Connected now" : "Not connected"}"></span><span class="share-name">${esc(d.name)}</span><span class="set-help">Allowed ${esc(when(d.added))} · last seen ${esc(when(d.seen))}</span>
                <button type="button" class="set-reset" data-share-remove="${esc(d.id)}" aria-label="Remove ${esc(d.name)}" title="Remove: it can no longer connect">${ICONS.trash2}</button></li>`,
              )
              .join("")}</ul>`
          : `<p class="set-help">None yet.</p>`
      }
      <p class="set-help">${plural(st.devices.filter((d) => d.active).length, "device")} connected now.</p></div>`;
  };
  host.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-share-on]")) void share.call(t.checked ? "start" : "stop").then((st) => st && draw(st));
    if (t.matches("[data-share-hidden]")) void share.call("hidden", t.checked).then((st) => st && draw(st));
  });
  host.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-share-open-dav]")) void share.call("openDav");
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-share-remove]");
    if (b) void share.call("remove", b.dataset["shareRemove"]).then((st) => st && draw(st));
  });
  if (!shown) share.onStatus((st) => shown?.(st)); // (one listener, whichever body is shown)
  shown = draw;
  void share.call("status").then((st) => st && draw(st));
}
