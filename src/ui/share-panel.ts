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
export function installShareFolder(share: ShareCalls, files: HiddenFiles, thumb: (hash: string) => Promise<{ blob: Blob; w: number; h: number; face?: string | undefined } | null>): void {
  share.onDav((a) => {
    const value =
      a.op === "thumb"
        ? thumb(String(a.arg)).then(async (t) => (t ? { b64: btoa(Array.from(new Uint8Array(await t.blob.arrayBuffer()), (c) => String.fromCharCode(c)).join("")), type: t.blob.type, w: t.w, h: t.h, ...(t.face ? { face: t.face } : {}) } : null))
        : a.op === "list"
          ? files.list()
          : a.arg && typeof a.arg === "object"
            ? files.read(a.arg.path, a.arg.from, a.arg.to)
            : Promise.resolve(null);
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

/** A row of the settings (their one look is settings-view.ts's): its name and help, and its control. */
export type SettingRow = (o: { id?: string; label: string; help: string; control: string }) => string;

let shown: ((st: ShareStatus) => void) | null = null;

/** The tab's cards, in its panel (`host`, after its heading), kept up to date while it is shown. */
export function mountSharing(host: HTMLElement, share: ShareCalls, row: SettingRow): void {
  const check = (id: string, attrs: string, on: boolean, disabled = false): string => `<input type="checkbox" id="${id}" ${attrs} ${on ? "checked" : ""} ${disabled ? "disabled" : ""}>`;
  const code = (s: string): string => `<code>${esc(s)}</code>`;
  const draw = (st: ShareStatus): void => {
    if (!host.isConnected) return;
    for (const c of host.querySelectorAll(":scope > .set-card")) c.remove();
    const urls = st.addresses.map((a) => `https://${a}:${st.port}`);
    const live = st.on
      ? row({ label: "Address", help: `${urls.map(code).join(" ") || "No network found"}. A guest opens it in a browser, or in the app (Switch workspace > Connect to a shared workspace).`, control: "" }) +
        row({ label: "Code", help: "The guest types it; then you are asked to allow the device. New each time sharing starts.", control: `<strong data-testid="share-code">${esc(st.code)}</strong>` }) +
        row({ label: "Fingerprint", help: `${code(st.fingerprint)}. A browser warns once about this computer's own certificate: its fingerprint is this one.`, control: "" }) +
        (st.dav
          ? row({
              label: "Folder for file managers",
              help: `${code(st.dav.url)} on this computer${st.dav.others.length ? `; ${st.dav.others.map(code).join(" ")} from other devices (Library only)` : ""}. Password ${`<code data-testid="share-dav-password">${esc(st.dav.password)}</code>`}. Read-only. On this computer, while the Hidden items are open, it has them too, each decrypted only as it is read; a file manager may keep thumbnails of what it shows.`,
              control: `<button type="button" class="set-done" data-share-open-dav data-testid="share-open-dav">Open in the file manager</button>`,
            })
          : "")
      : "";
    host.insertAdjacentHTML(
      "beforeend",
      `<div class="set-card" data-testid="share-card"><h3>Share this workspace</h3>
      ${row({ id: "share-on", label: "Share on the local network", help: "Others on this network can look at your boards, canvases and library, in a browser or the app. They cannot change anything. Sharing stops when the app closes.", control: check("share-on", 'data-share-on data-testid="share-on"', st.on) })}
      ${live}
      ${row({ id: "share-hidden", label: "Share hidden items too", help: "Their files go out encrypted, as they are in the folder; a guest needs your Hidden password to open them.", control: check("share-hidden", 'data-share-hidden data-testid="share-hidden"', st.hidden, !st.on) })}</div>
      <div class="set-card" data-testid="share-devices"><h3>Allowed devices</h3>
      ${
        st.devices
          .map((d) =>
            row({
              label: esc(d.name),
              help: `${d.active ? "Connected now" : "Not connected"} · allowed ${esc(when(d.added))} · last seen ${esc(when(d.seen))}`,
              control: `<button type="button" class="set-reset" data-share-remove="${esc(d.id)}" aria-label="Remove ${esc(d.name)}" title="Remove: it can no longer connect">${ICONS.x}</button>`,
            }),
          )
          .join("") || `<p class="set-help">None yet.</p>`
      }
      <p class="set-help">${plural(st.devices.filter((d) => d.active).length, "device")} connected now.</p></div>`,
    );
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
