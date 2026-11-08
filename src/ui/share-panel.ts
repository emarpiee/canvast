/**
 * Settings > Sharing (desktop, ADR 0184), in three groups: guests (in a browser or the app), the folder for file managers (WebDAV), and
 * both (start with the app, activity). The page holds fixed rows only: every list that grows with use (devices, logins, apps, activity)
 * is a count and a button that opens it in a dialog. Drawn again through `redraw`, so an update never moves the page or what is pressed.
 * A device asking to connect is answered from anywhere in the app.
 */
import type { ShareCalls, ShareStatus } from "../storage/desktop-bridge";
import type { HiddenFiles } from "../storage/store";
import { confirmDialog, listDialog, promptDialog } from "./confirm";
import { ICONS } from "./icons";
import { redraw } from "./redraw";
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

type Dialog = { refresh: () => void; open: () => boolean };
let shown: ((st: ShareStatus) => void) | null = null;

/** The tab's rows, in its panel (`host`, the tab's section), kept up to date while it is shown. Wired once: it returns what draws it again. */
export function mountSharing(host: HTMLElement, share: ShareCalls, row: SettingRow): () => void {
  const title = host.querySelector("h2")?.outerHTML ?? "";
  const check = (id: string, attrs: string, on: boolean, disabled = false): string => `<input type="checkbox" id="${id}" ${attrs} ${on ? "checked" : ""} ${disabled ? "disabled" : ""}>`;
  const code = (s: string): string => `<code>${esc(s)}</code>`;
  const btn = (attrs: string, label: string): string => `<button type="button" class="set-done" ${attrs}>${label}</button>`;
  const remove = (attrs: string, name: string, what: string): string => `<button type="button" class="set-reset" ${attrs} aria-label="Remove ${esc(name)}" title="Remove: ${what}">${ICONS.x}</button>`;
  const card = (testid: string, h: string, rows: string): string => `<div class="set-card" data-testid="${testid}"><h3>${h}</h3>${rows}</div>`;
  let cur: ShareStatus | null = null;
  const dialogs = new Set<Dialog>();
  const update = (st: ShareStatus | null): void => {
    if (!st) return;
    cur = st;
    if (host.isConnected) redraw(host, title + page(st));
    for (const d of dialogs) d.open() ? d.refresh() : dialogs.delete(d);
  };
  const act = (op: Parameters<ShareCalls["call"]>[0], arg?: unknown): void =>
    void share.call(op, arg).then(update, (err: Error) => void confirmDialog({ title: "Not done", lines: [err.message.replace(/^.*Error: /, "")], confirmLabel: "OK", danger: false }));
  const rights = (r: ShareStatus["davLogins"][number]["rights"]): string =>
    [r.add && "add", r.edit && "edit", r.move && "move", r.delete && "delete", r.hidden && "see hidden items"].filter(Boolean).join(", ") || "read only";

  // The lists, each in its dialog.
  const open = (d: Dialog): void => void dialogs.add(d);
  const guestsList = (): void =>
    open(
      listDialog({
        title: "Allowed guests",
        lines: ["Devices that typed the code and that you allowed. Removed, a device can no longer connect."],
        testid: "share-guests-dialog",
        body: () =>
          cur?.devices.map((d) => row({ label: esc(d.name), help: `${d.active ? "Connected now" : "Not connected"} · allowed ${esc(when(d.added))} · last seen ${esc(when(d.seen))}`, control: remove(`data-share-remove="${esc(d.id)}"`, d.name, "it can no longer connect") })).join("") || `<p class="set-help">None yet.</p>`,
        onClick: (t) => {
          const b = t.closest<HTMLElement>("[data-share-remove]");
          if (b) act("remove", b.dataset["shareRemove"]);
        },
      }),
    );
  const login = (id: string): void => {
    const l = (): ShareStatus["davLogins"][number] | undefined => cur?.davLogins.find((x) => x.id === id);
    const right = (key: keyof ShareStatus["davLogins"][number]["rights"], label: string, help: string): string => row({ id: `dav-${id}-${key}`, label, help, control: check(`dav-${id}-${key}`, `data-dav-right="${key}"`, !!l()?.rights[key]) });
    open(
      listDialog({
        title: `Folder login: ${l()?.name ?? ""}`,
        testid: "share-login-dialog",
        body: () =>
          l()
            ? row({ label: "Sign in", help: `User name ${code(l()!.user)}, password ${code(l()!.password)}.`, control: btn('data-dav-act="password"', "New password") + btn('data-dav-act="rename"', "Rename…") + remove('data-dav-act="remove"', l()!.name, "its login stops working") }) +
              right("add", "Add", "New files and folders in Library.") +
              right("edit", "Edit", "Replace a file's contents, or a file moved or copied over it.") +
              right("move", "Move and rename", "Files and folders, within Library.") +
              right("delete", "Delete", "Into the workspace's trash (.trash), never for good.") +
              right("hidden", "See hidden items", "While the Hidden items are open here: each file is decrypted on this computer and sent to this device over the encrypted connection. Its file manager may keep copies or thumbnails.")
            : `<p class="set-help">This login was removed.</p>`,
        onChange: (t) => t.dataset["davRight"] && act("davLogin", { id, right: t.dataset["davRight"], on: t.checked }),
        onClick: (t, _refresh, close) => {
          const a = t.closest<HTMLElement>("[data-dav-act]")?.dataset["davAct"];
          if (a === "password") act("davLogin", { id, newPassword: true });
          if (a === "remove") (act("davLogin", { id, remove: true }), close());
          if (a === "rename") void promptDialog({ title: "Rename this device", lines: ["The name shown here and in the log. Its user name stays."], value: l()?.name ?? "", confirmLabel: "Rename" }).then((name) => name?.trim() && act("davLogin", { id, name }));
        },
      }),
    );
  };
  const loginsList = (): void =>
    open(
      listDialog({
        title: "Devices with their own folder login",
        lines: ["Each signs in with its own user name and password, and may do what its rights say."],
        testid: "share-logins-dialog",
        body: () =>
          cur?.davLogins.map((l) => row({ label: esc(l.name), help: `User name ${code(l.user)} · may ${esc(rights(l.rights))}`, control: btn(`data-dav-edit="${esc(l.id)}"`, "Edit…") })).join("") || `<p class="set-help">None yet.</p>`,
        onClick: (t) => {
          const id = t.closest<HTMLElement>("[data-dav-edit]")?.dataset["davEdit"];
          if (id) login(id);
        },
      }),
    );
  const appsList = (): void =>
    open(
      listDialog({
        title: "Apps using the folder",
        lines: ["Since sharing started: which login, which app, from where."],
        testid: "share-apps-dialog",
        body: () =>
          cur?.davClients.map((c) => row({ label: esc(c.who), help: `${Date.now() - c.last < 120_000 ? "Using it now" : `Last seen ${esc(when(c.last))}`} · ${esc(c.app)} · ${esc(c.address)} · since ${esc(when(c.first))} · ${plural(c.opened, "file")} opened`, control: "" })).join("") ||
          `<p class="set-help">None since sharing started.</p>`,
      }),
    );
  const activityList = (): void =>
    open(
      listDialog({
        title: "Sharing activity",
        lines: ["The latest events, the newest first. The log file has all of them."],
        testid: "share-activity-dialog",
        body: () =>
          (cur?.log.map((e) => row({ label: esc(e.what), help: `${esc(new Date(e.at).toLocaleString())}${e.who ? ` · ${esc(e.who)}` : ""}${e.address ? ` · ${esc(e.address)}` : ""}`, control: "" })).join("") || `<p class="set-help">Nothing yet.</p>`) +
          row({ label: "The whole log", help: "In a file in the app's settings folder (the latest megabyte, and one older file).", control: btn("data-share-open-log", "Open the log file") }),
        onClick: (t) => void (t.closest("[data-share-open-log]") && share.call("openLog")),
      }),
    );

  // The page: fixed rows only.
  const page = (st: ShareStatus): string => {
    const urls = st.addresses.map((a) => `https://${a}:${st.port}`);
    const connected = st.devices.filter((d) => d.active).length;
    const using = st.davClients.filter((c) => Date.now() - c.last < 120_000).length;
    const latest = st.log[0];
    return (
      card(
        "share-card",
        "Guests: in a browser or the app",
        row({ id: "share-on", label: "Share with guests", help: "Others on this network look at your boards, canvases and library, in a browser or in canvast. They cannot change anything.", control: check("share-on", 'data-share-on data-testid="share-on"', st.guests) }) +
          (st.guests
            ? row({ label: "Address", help: `${urls.map(code).join(" ") || "No network found"}. A guest opens it in a browser, or in the app (Switch workspace > Connect to a shared workspace).`, control: "" }) +
              row({ label: "Code", help: "The guest types it; then you are asked to allow the device. It stays the same until you ask for a new one; devices already allowed stay allowed.", control: `<strong data-testid="share-code">${esc(st.code)}</strong> ${btn("data-share-new-code", "New code")}` }) +
              row({ label: "Fingerprint", help: `${code(st.fingerprint)}. A browser warns once about this computer's own certificate: its fingerprint is this one.`, control: "" })
            : "") +
          row({ id: "share-hidden", label: "Share hidden items with guests", help: "Their files go out encrypted, as they are in the folder; a guest needs your Hidden password to open them.", control: check("share-hidden", 'data-share-hidden data-testid="share-hidden"', st.hidden, !st.guests) }) +
          row({ label: "Allowed guests", help: `${plural(st.devices.length, "device")}, ${connected} connected now.`, control: btn('data-share-guests data-testid="share-guests"', "Show…") }),
      ) +
      card(
        "share-dav",
        "Folder for file managers (WebDAV)",
        row({ id: "share-dav-on", label: "Share the folder", help: "File managers and file apps (Dolphin, Nautilus, X-plore…) open your library as a folder. Each device signs in; what it may change is its own.", control: check("share-dav-on", 'data-share-dav-on data-testid="share-dav-on"', st.davOn) }) +
          (st.davOn && st.dav
            ? row({
                label: "Address",
                help: `${code(st.dav.url)} on this computer${st.dav.others.length ? `; ${st.dav.others.map(code).join(" ")} from other devices (Linux file managers write davs:// for https://)` : ""}. On this computer, while the Hidden items are open, it has them too, each decrypted only as it is read; a file manager may keep thumbnails of what it shows.`,
                control: btn('data-share-open-dav data-testid="share-open-dav"', "Open in the file manager"),
              })
            : "") +
          row({
            id: "share-dav-shared",
            label: "Shared password (read only)",
            help: st.dav ? `Any user name, password <code data-testid="share-dav-password">${esc(st.dav.password)}</code> (kept until you change it). It can only look.` : "Any user name and this password can only look.",
            control: `${check("share-dav-shared", 'data-share-dav-shared data-testid="share-dav-shared"', st.davShared)} ${btn("data-share-set-dav", "Set a password…")} ${btn("data-share-new-dav", "New password")}`,
          }) +
          row({ label: "Devices with their own login", help: `${plural(st.davLogins.length, "device")}: each with its own user name, password and rights (adding only, at first).`, control: `${btn('data-share-dav-add data-testid="share-dav-add"', "Add a device…")} ${btn('data-share-logins data-testid="share-logins"', "Show…")}` }) +
          row({ label: "Apps using the folder", help: `${plural(st.davClients.length, "app")} since sharing started, ${using} using it now.`, control: btn('data-share-apps data-testid="share-apps"', "Show…") }),
      ) +
      card(
        "share-log",
        "Both: start and activity",
        row({ id: "share-auto", label: "Start sharing when the app opens", help: "What was on when the app closed starts again: guests, the folder, or both. The hidden items are never shared with guests at a start.", control: check("share-auto", 'data-share-auto data-testid="share-auto"', st.autoStart) }) +
          row({ label: "Activity", help: latest ? `Latest: ${esc(latest.what)}${latest.who ? ` · ${esc(latest.who)}` : ""} · ${esc(new Date(latest.at).toLocaleString())}` : "Nothing yet.", control: btn('data-share-activity data-testid="share-activity"', "Show…") }),
      )
    );
  };

  host.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-share-on]")) act("guests", t.checked);
    if (t.matches("[data-share-dav-on]")) act("dav", t.checked);
    if (t.matches("[data-share-dav-shared]")) act("davShared", t.checked);
    if (t.matches("[data-share-auto]")) act("autoStart", t.checked);
    if (t.matches("[data-share-hidden]")) act("hidden", t.checked);
  });
  host.addEventListener("click", (e) => {
    const at = e.target as HTMLElement;
    if (at.closest("[data-share-open-dav]")) void share.call("openDav");
    if (at.closest("[data-share-guests]")) guestsList();
    if (at.closest("[data-share-logins]")) loginsList();
    if (at.closest("[data-share-apps]")) appsList();
    if (at.closest("[data-share-activity]")) activityList();
    if (at.closest("[data-share-new-code]")) act("newCode");
    if (at.closest("[data-share-new-dav]")) act("newDavPassword");
    if (at.closest("[data-share-dav-add]"))
      void promptDialog({ title: "Add a device to the folder", lines: ["A name for it (Phone, Laptop…). It gets its own user name and password; it can add files at first, and you choose the rest."], value: "", confirmLabel: "Add" }).then((name) => {
        if (!name?.trim()) return;
        void share.call("davAdd", name).then((st) => {
          update(st);
          const made = st?.davLogins.at(-1);
          if (made) login(made.id); // (its rights, at once)
        });
      });
    if (at.closest("[data-share-set-dav]"))
      void promptDialog({ title: "Password for the file managers' folder", lines: ["At least 8 characters. File managers and apps ask for it (any user name). It stays until you change it."], value: "", confirmLabel: "Set", secret: true }).then((pw) => pw !== null && act("setDavPassword", pw));
  });
  if (!shown) share.onStatus((st) => shown?.(st)); // (one listener, whichever panel is shown)
  shown = update;
  return () => void share.call("status").then(update);
}
