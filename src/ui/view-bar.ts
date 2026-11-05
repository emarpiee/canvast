/** A button of a file view's bar (the row above a PDF's pages or a 3D model): one look and size for all of them. `act` names what it does (`data-act`). */
export const barButton = (act: string, icon: string, label: string, title: string, attrs = ""): string =>
  `<button type="button" class="layer-btn" data-view-act="${act}" data-testid="view-${act}" aria-label="${label}" title="${title}"${attrs ? ` ${attrs}` : ""}>${icon}</button>`;
