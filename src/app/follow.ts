/**
 * Follow the host (ADR 0184). The host's page, while it shares, sends where it is (its canvas and camera) when that changes, a few
 * times a second at most. A guest that turned Follow on goes there; moving the view itself (pointer, wheel, keys) turns Follow off.
 */
import { deserializeCamera, serializeCamera } from "../core/camera";
import type { SerializedCamera } from "../core/camera";
import type { ShareCalls } from "../storage/desktop-bridge";
import { hostEvents, isGuestPage } from "../storage/remote-bridge";
import type { ViewState } from "./view-state";

interface Where {
  canvasId: string | null;
  camera: SerializedCamera;
}
interface Sess {
  readonly current: { canvasId: string } | null;
  openCanvas(id: string): Promise<unknown>;
}

/** The host side: send the view while sharing. */
export function sendView(view: ViewState, session: Sess, share: ShareCalls): void {
  let on = false;
  share.onStatus((st) => (on = st.on));
  void share.call("status").then((st) => (on = !!st?.on));
  let last = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  view.subscribe(() => {
    if (!on || timer) return;
    timer = setTimeout(() => {
      timer = null;
      const where: Where = { canvasId: session.current?.canvasId ?? null, camera: serializeCamera(view.worldCamera()) };
      const text = JSON.stringify(where);
      if (text !== last) void share.call("view", (last = text, where));
    }, 200);
  });
}

/** The guest side: a Follow switch (`button`), and going where the host is while it is on. */
export function followHost(view: ViewState, session: Sess, canvas: HTMLElement, button: HTMLButtonElement): void {
  const token = localStorage.getItem("canvast.guest.token");
  if (!isGuestPage() || !token) return void (button.hidden = true);
  let on = false;
  let latest: Where | null = null;
  const set = (v: boolean): void => {
    on = v;
    button.setAttribute("aria-pressed", String(v));
    if (v && latest) void go(latest);
  };
  const go = async (w: Where): Promise<void> => {
    if (w.canvasId && w.canvasId !== session.current?.canvasId) await session.openCanvas(w.canvasId);
    view.setWorldCamera(deserializeCamera(w.camera));
  };
  hostEvents(location.origin, token).addEventListener("view", (e) => {
    latest = JSON.parse((e as MessageEvent<string>).data) as Where;
    if (on) void go(latest);
  });
  button.addEventListener("click", () => set(!on));
  // (the guest moving the view itself: it stops following)
  for (const type of ["pointerdown", "wheel", "keydown"] as const) canvas.addEventListener(type, () => on && set(false), { passive: true });
}
