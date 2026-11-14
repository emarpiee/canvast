import { panelHtml } from "../../ui/panel";

/**
 * PhotoCraft's view (artcraft/photocraft/app.ts), one of the app's views beside Canvas, Library and Settings: the whole window under the
 * top bar (where its tab, and the × that closes it, are), a line while it starts or makes a project, and its frame filling the rest. It
 * stays while another view is shown; its keys are its own while it has the focus. What it saved is said by the app's notices.
 */
export interface PhotoCraftView {
  /** Where its frame goes. */
  readonly body: HTMLElement;
  show(): void;
  hide(): void;
  /** A line above it while it starts or makes a project ("" hides it). */
  status(text: string): void;
  /** A project is being made for it (`data-busy` on the view, for whoever waits for it to open). */
  busy(on: boolean): void;
}

export function mountPhotoCraftView(): PhotoCraftView {
  const root = document.createElement("section");
  root.className = "layers-panel photocraft-view";
  root.setAttribute("aria-label", "PhotoCraft");
  root.dataset["testid"] = "photocraft-view";
  root.hidden = true;
  root.innerHTML = panelHtml({ sub: `<p class="photocraft-status" role="status" aria-live="polite"></p>`, body: "" });
  document.body.append(root);
  const line = root.querySelector<HTMLElement>(".photocraft-status")!;
  const sub = root.querySelector<HTMLElement>(".panel-sub")!;
  const put = (text: string): void => {
    line.textContent = text;
    sub.hidden = !text;
  };
  put("");
  return {
    body: root.querySelector<HTMLElement>(".panel-body")!,
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    status: put,
    busy(on) {
      root.toggleAttribute("data-busy", on);
    },
  };
}
