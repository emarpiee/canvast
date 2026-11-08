/**
 * Settings > Sharing (desktop, ADR 0184): share this workspace read-only on the local network, its address, code and certificate
 * fingerprint, whether the hidden items' encrypted files go too, and the devices allowed (each can be removed). A device asking to
 * connect is answered from anywhere in the app.
 */
import type { ShareCalls, ShareStatus } from "../storage/desktop-bridge";
import type { HiddenFiles } from "../storage/store";
import { confirmDialog, promptDialog } from "./confirm";
import { ICONS } from "./icons";
import { capList, showMoreButton } from "./show-more";
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
let logOpen = false;

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
        row({ label: "Code", help: "The guest types it; then you are asked to allow the device. It stays the same until you ask for a new one; devices already allowed stay allowed.", control: `<strong data-testid="share-code">${esc(st.code)}</strong> <button type="button" class="set-done" data-share-new-code>New code</button>` }) +
        row({ label: "Fingerprint", help: `${code(st.fingerprint)}. A browser warns once about this computer's own certificate: its fingerprint is this one.`, control: "" }) +
        (st.dav
          ? row({
              label: "Folder for file managers",
              help: `${code(st.dav.url)} on this computer${st.dav.others.length ? `; ${st.dav.others.map(code).join(" ")} from other devices, as a WebDAV server (Linux file managers write davs:// for https://)` : ""}. Sign in with a login below. On this computer, while the Hidden items are open, it has them too, each decrypted only as it is read; a file manager may keep thumbnails of what it shows.`,
              control: `<button type="button" class="set-done" data-share-open-dav data-testid="share-open-dav">Open in the file manager</button>`,
            })
          : "")
      : "";
    host.insertAdjacentHTML(
      "beforeend",
      `<div class="set-card" data-testid="share-card"><h3>Share this workspace</h3>
      ${row({ id: "share-on", label: "Share on the local network", help: "Others on this network can look at your boards, canvases and library, in a browser or the app. They cannot change anything. Sharing stops when the app closes.", control: check("share-on", 'data-share-on data-testid="share-on"', st.on) })}
      ${live}
      ${row({ id: "share-auto", label: "Start sharing when the app opens", help: "Off: you turn it on each time. The hidden items are never shared at a start: you turn that on yourself.", control: check("share-auto", 'data-share-auto data-testid="share-auto"', st.autoStart) })}
      ${row({ id: "share-hidden", label: "Share hidden items too", help: "Their files go out encrypted, as they are in the folder; a guest needs your Hidden password to open them.", control: check("share-hidden", 'data-share-hidden data-testid="share-hidden"', st.hidden, !st.on) })}</div>
      <div class="set-card" data-testid="share-dav-logins"><h3>Folder logins</h3>
      ${row({
        id: "share-dav-shared",
        label: "Shared password (read only)",
        help: st.dav ? `Any user name, password <code data-testid="share-dav-password">${esc(st.dav.password)}</code> (kept until you change it). It can only look.` : "Any user name and this password can only look. Shown while sharing.",
        control: `${check("share-dav-shared", 'data-share-dav-shared data-testid="share-dav-shared"', st.davShared)} <button type="button" class="set-done" data-share-set-dav>Set a password…</button> <button type="button" class="set-done" data-share-new-dav>New password</button>`,
      })}
      ${row({ label: "A device of its own", help: "Its own user name and password, a name you give it, and its own rights (adding only, at first).", control: `<button type="button" class="set-done" data-share-dav-add data-testid="share-dav-add">Add a device…</button>` })}</div>
      ${st.davLogins
        .map((l) => {
          const right = (key: keyof typeof l.rights, label: string, help: string): string =>
            row({ id: `dav-${l.id}-${key}`, label, help, control: check(`dav-${l.id}-${key}`, `data-dav-id="${esc(l.id)}" data-dav-right="${key}"`, l.rights[key]) });
          return `<div class="set-card" data-testid="share-dav-login"><h3>${esc(l.name)}</h3>
          ${row({
            label: "Sign in",
            help: `User name <code>${esc(l.user)}</code>, password <code>${esc(l.password)}</code>.`,
            control: `<button type="button" class="set-done" data-dav-id="${esc(l.id)}" data-dav-act="password">New password</button> <button type="button" class="set-done" data-dav-id="${esc(l.id)}" data-dav-act="rename">Rename…</button> <button type="button" class="set-reset" data-dav-id="${esc(l.id)}" data-dav-act="remove" aria-label="Remove ${esc(l.name)}" title="Remove: its login stops working">${ICONS.x}</button>`,
          })}
          ${right("add", "Add", "New files and folders in Library.")}
          ${right("edit", "Edit", "Replace a file's contents, or a file moved or copied over it.")}
          ${right("move", "Move and rename", "Files and folders, within Library.")}
          ${right("delete", "Delete", "Into the workspace's trash (.trash), never for good.")}
          ${right("hidden", "See hidden items", "While the Hidden items are open here: each file is decrypted on this computer and sent to this device over the encrypted connection. Its file manager may keep copies or thumbnails.")}</div>`;
        })
        .join("")}
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
      <p class="set-help">${plural(st.devices.filter((d) => d.active).length, "device")} connected now.</p></div>
      <div class="set-card" data-testid="share-dav-clients"><h3>Apps using the folder</h3>
      ${
        st.davClients
          .map((c) =>
            row({
              label: esc(c.who),
              help: `${Date.now() - c.last < 120_000 ? "Using it now" : `Last seen ${esc(when(c.last))}`} · ${esc(c.app)} · ${esc(c.address)} · since ${esc(when(c.first))} · ${plural(c.opened, "file")} opened`,
              control: "",
            }),
          )
          .join("") || `<p class="set-help">None since sharing started.</p>`
      }</div>
      <div class="set-card" data-testid="share-log"><h3>Activity</h3>
      ${(() => {
        const cap = capList(st.log, 5, logOpen);
        return (
          cap.shown.map((e) => row({ label: esc(e.what), help: `${esc(new Date(e.at).toLocaleString())}${e.who ? ` · ${esc(e.who)}` : ""}${e.address ? ` · ${esc(e.address)}` : ""}`, control: "" })).join("") +
          (cap.long ? showMoreButton({ open: logOpen, hidden: cap.hidden, attrs: "data-share-log-more" }) : "") +
          (st.log.length ? "" : `<p class="set-help">Nothing yet.</p>`)
        );
      })()}
      ${row({ label: "The whole log", help: "Every event with its time, device and address, in a file in the app's settings folder (the latest megabyte, and one older file).", control: `<button type="button" class="set-done" data-share-open-log>Open the log file</button>` })}</div>`,
    );
  };
  host.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-share-on]")) void share.call(t.checked ? "start" : "stop").then((st) => st && draw(st));
    if (t.matches("[data-share-dav-shared]")) void share.call("davShared", t.checked).then((st) => st && draw(st));
    if (t.matches("[data-dav-right]")) void share.call("davLogin", { id: t.dataset["davId"], right: t.dataset["davRight"], on: t.checked }).then((st) => st && draw(st));
    if (t.matches("[data-share-auto]")) void share.call("autoStart", t.checked).then((st) => st && draw(st));
    if (t.matches("[data-share-hidden]")) void share.call("hidden", t.checked).then((st) => st && draw(st));
  });
  host.addEventListener("click", (e) => {
    const at = e.target as HTMLElement;
    if (at.closest("[data-share-open-dav]")) void share.call("openDav");
    if (at.closest("[data-share-open-log]")) void share.call("openLog");
    if (at.closest("[data-share-dav-add]"))
      void promptDialog({ title: "Add a device to the folder", lines: ["A name for it (Phone, Laptop…). It gets its own user name and password; it can add files at first, and you choose the rest."], value: "", confirmLabel: "Add" }).then(
        (name) => name?.trim() && void share.call("davAdd", name).then((st) => st && draw(st)),
      );
    const dav = at.closest<HTMLElement>("[data-dav-act]");
    if (dav) {
      const id = dav.dataset["davId"];
      const act = dav.dataset["davAct"];
      if (act === "password") void share.call("davLogin", { id, newPassword: true }).then((st) => st && draw(st));
      if (act === "remove") void share.call("davLogin", { id, remove: true }).then((st) => st && draw(st));
      if (act === "rename")
        void promptDialog({ title: "Rename this device", lines: ["The name shown here and in the log. Its user name stays."], value: dav.closest(".set-card")?.querySelector("h3")?.textContent ?? "", confirmLabel: "Rename" }).then(
          (name) => name?.trim() && void share.call("davLogin", { id, name }).then((st) => st && draw(st)),
        );
    }
    if (at.closest("[data-share-log-more]")) {
      logOpen = !logOpen;
      void share.call("status").then((st) => st && draw(st));
    }
    if (at.closest("[data-share-new-code]")) void share.call("newCode").then((st) => st && draw(st));
    if (at.closest("[data-share-new-dav]")) void share.call("newDavPassword").then((st) => st && draw(st));
    if (at.closest("[data-share-set-dav]"))
      void promptDialog({ title: "Password for the file managers' folder", lines: ["At least 8 characters. File managers and apps ask for it (any user name). It stays until you change it."], value: "", confirmLabel: "Set", secret: true }).then(
        (pw) => pw !== null && void share.call("setDavPassword", pw).then((st) => st && draw(st), (err: Error) => void confirmDialog({ title: "Not set", lines: [err.message.replace(/^.*Error: /, "")], confirmLabel: "OK", danger: false })),
      );
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-share-remove]");
    if (b) void share.call("remove", b.dataset["shareRemove"]).then((st) => st && draw(st));
  });
  if (!shown) share.onStatus((st) => shown?.(st)); // (one listener, whichever body is shown)
  shown = draw;
  void share.call("status").then((st) => st && draw(st));
}
