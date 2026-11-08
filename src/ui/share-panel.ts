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
    const card = (testid: string, title: string, rows: string): string => `<div class="set-card" data-testid="${testid}"><h3>${title}</h3>${rows}</div>`;
    // 1. Guests: in a browser or the app, read-only; pairing, the hidden items, the devices allowed.
    const guests = card(
      "share-card",
      "Guests: in a browser or the app",
      row({ id: "share-on", label: "Share with guests", help: "Others on this network look at your boards, canvases and library, in a browser or in canvast. They cannot change anything.", control: check("share-on", 'data-share-on data-testid="share-on"', st.guests) }) +
        (st.guests
          ? row({ label: "Address", help: `${urls.map(code).join(" ") || "No network found"}. A guest opens it in a browser, or in the app (Switch workspace > Connect to a shared workspace).`, control: "" }) +
            row({ label: "Code", help: "The guest types it; then you are asked to allow the device. It stays the same until you ask for a new one; devices already allowed stay allowed.", control: `<strong data-testid="share-code">${esc(st.code)}</strong> <button type="button" class="set-done" data-share-new-code>New code</button>` }) +
            row({ label: "Fingerprint", help: `${code(st.fingerprint)}. A browser warns once about this computer's own certificate: its fingerprint is this one.`, control: "" })
          : "") +
        row({ id: "share-hidden", label: "Share hidden items with guests", help: "Their files go out encrypted, as they are in the folder; a guest needs your Hidden password to open them.", control: check("share-hidden", 'data-share-hidden data-testid="share-hidden"', st.hidden, !st.guests) }),
    );
    const allowed = card(
      "share-devices",
      "Guests: allowed devices",
      (st.devices
        .map((d) =>
          row({
            label: esc(d.name),
            help: `${d.active ? "Connected now" : "Not connected"} · allowed ${esc(when(d.added))} · last seen ${esc(when(d.seen))}`,
            control: `<button type="button" class="set-reset" data-share-remove="${esc(d.id)}" aria-label="Remove ${esc(d.name)}" title="Remove: it can no longer connect">${ICONS.x}</button>`,
          }),
        )
        .join("") || `<p class="set-help">None yet.</p>`) + `<p class="set-help">${plural(st.devices.filter((d) => d.active).length, "device")} connected now.</p>`,
    );
    // 2. The folder for file managers (WebDAV): its address, its logins and each device's rights, the apps using it.
    const folder = card(
      "share-dav",
      "Folder for file managers (WebDAV)",
      row({ id: "share-dav-on", label: "Share the folder", help: "File managers and file apps (Dolphin, Nautilus, X-plore…) open your library as a folder. Each device signs in; what it may change is its own.", control: check("share-dav-on", 'data-share-dav-on data-testid="share-dav-on"', st.davOn) }) +
        (st.davOn && st.dav
          ? row({
              label: "Address",
              help: `${code(st.dav.url)} on this computer${st.dav.others.length ? `; ${st.dav.others.map(code).join(" ")} from other devices (Linux file managers write davs:// for https://)` : ""}. On this computer, while the Hidden items are open, it has them too, each decrypted only as it is read; a file manager may keep thumbnails of what it shows.`,
              control: `<button type="button" class="set-done" data-share-open-dav data-testid="share-open-dav">Open in the file manager</button>`,
            })
          : "") +
        row({
          id: "share-dav-shared",
          label: "Shared password (read only)",
          help: st.dav ? `Any user name, password <code data-testid="share-dav-password">${esc(st.dav.password)}</code> (kept until you change it). It can only look.` : "Any user name and this password can only look.",
          control: `${check("share-dav-shared", 'data-share-dav-shared data-testid="share-dav-shared"', st.davShared)} <button type="button" class="set-done" data-share-set-dav>Set a password…</button> <button type="button" class="set-done" data-share-new-dav>New password</button>`,
        }) +
        row({ label: "A device of its own", help: "Its own user name and password, a name you give it, and its own rights (adding only, at first).", control: `<button type="button" class="set-done" data-share-dav-add data-testid="share-dav-add">Add a device…</button>` }),
    );
    const logins = st.davLogins
      .map((l) => {
        const right = (key: keyof typeof l.rights, label: string, help: string): string => row({ id: `dav-${l.id}-${key}`, label, help, control: check(`dav-${l.id}-${key}`, `data-dav-id="${esc(l.id)}" data-dav-right="${key}"`, l.rights[key]) });
        return card(
          "share-dav-login",
          `Folder: ${esc(l.name)}`,
          row({
            label: "Sign in",
            help: `User name <code>${esc(l.user)}</code>, password <code>${esc(l.password)}</code>.`,
            control: `<button type="button" class="set-done" data-dav-id="${esc(l.id)}" data-dav-act="password">New password</button> <button type="button" class="set-done" data-dav-id="${esc(l.id)}" data-dav-act="rename">Rename…</button> <button type="button" class="set-reset" data-dav-id="${esc(l.id)}" data-dav-act="remove" aria-label="Remove ${esc(l.name)}" title="Remove: its login stops working">${ICONS.x}</button>`,
          }) +
            right("add", "Add", "New files and folders in Library.") +
            right("edit", "Edit", "Replace a file's contents, or a file moved or copied over it.") +
            right("move", "Move and rename", "Files and folders, within Library.") +
            right("delete", "Delete", "Into the workspace's trash (.trash), never for good.") +
            right("hidden", "See hidden items", "While the Hidden items are open here: each file is decrypted on this computer and sent to this device over the encrypted connection. Its file manager may keep copies or thumbnails."),
        );
      })
      .join("");
    const apps = card(
      "share-dav-clients",
      "Folder: apps using it",
      st.davClients
        .map((c) => row({ label: esc(c.who), help: `${Date.now() - c.last < 120_000 ? "Using it now" : `Last seen ${esc(when(c.last))}`} · ${esc(c.app)} · ${esc(c.address)} · since ${esc(when(c.first))} · ${plural(c.opened, "file")} opened`, control: "" }))
        .join("") || `<p class="set-help">None since sharing started.</p>`,
    );
    // 3. Both: starting with the app, and what happened.
    const cap = capList(st.log, 5, logOpen);
    const general = card(
      "share-log",
      "Both: start and activity",
      row({ id: "share-auto", label: "Start sharing when the app opens", help: "What was on when the app closed starts again: guests, the folder, or both. The hidden items are never shared with guests at a start.", control: check("share-auto", 'data-share-auto data-testid="share-auto"', st.autoStart) }) +
        cap.shown.map((e) => row({ label: esc(e.what), help: `${esc(new Date(e.at).toLocaleString())}${e.who ? ` · ${esc(e.who)}` : ""}${e.address ? ` · ${esc(e.address)}` : ""}`, control: "" })).join("") +
        (cap.long ? showMoreButton({ open: logOpen, hidden: cap.hidden, attrs: "data-share-log-more" }) : "") +
        row({ label: "The whole log", help: "Every event with its time, device and address, in a file in the app's settings folder (the latest megabyte, and one older file).", control: `<button type="button" class="set-done" data-share-open-log>Open the log file</button>` }),
    );
    host.insertAdjacentHTML("beforeend", guests + allowed + folder + logins + apps + general);
  };
  host.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-share-on]")) void share.call("guests", t.checked).then((st) => st && draw(st));
    if (t.matches("[data-share-dav-on]")) void share.call("dav", t.checked).then((st) => st && draw(st));
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
