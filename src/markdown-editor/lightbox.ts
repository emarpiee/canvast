// A picture full size over the page, as notes apps show it: fitted to the window, then zoomed (the buttons, + and −, the wheel), fitted
// again or at its own size (0 / 1), dragged to pan; the arrows go to the note's other pictures; Escape, the close button or a press beside
// it closes.
export interface LightboxPicture {
  src: string;
  alt: string;
}
export interface LightboxWords {
  close: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  actualSize: string;
}

const ICON = (d: string): string => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export function openLightbox(pictures: readonly LightboxPicture[], index: number, words: LightboxWords): void {
  if (!pictures.length) return;
  const restore = document.activeElement as HTMLElement | null;
  const box = document.createElement("div");
  box.className = "me-lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.tabIndex = -1;
  const img = document.createElement("img");
  img.draggable = false;
  const bar = document.createElement("div");
  bar.className = "me-lightbox-bar";
  const button = (cls: string, label: string, inner: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `me-btn ${cls}`;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = inner;
    // view-state: (the full-size view's own controls change nothing in the note)
    b.addEventListener("click", (e) => (e.stopPropagation(), run()));
    return b;
  };
  const level = document.createElement("output");
  level.className = "me-lightbox-level";
  let at = index, scale = 1, fit = 1, x = 0, y = 0;
  const place = (): void => {
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    level.textContent = `${Math.round(scale * 100)}%`;
    img.classList.toggle("is-zoomed", scale > fit + 1e-6);
  };
  /** Zoom to `k` round the point (cx, cy) of the window (its middle by default). */
  const zoomTo = (k: number, cx = innerWidth / 2, cy = innerHeight / 2): void => {
    const next = Math.min(16, Math.max(0.05, k));
    const ox = cx - innerWidth / 2 - x, oy = cy - innerHeight / 2 - y;
    x -= ox * (next / scale - 1);
    y -= oy * (next / scale - 1);
    scale = next;
    if (scale <= fit) x = y = 0;
    place();
  };
  const toFit = (): void => void ((scale = fit), (x = y = 0), place());
  bar.append(
    button("me-lightbox-out", words.zoomOut, ICON('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>'), () => zoomTo(scale / 1.25)),
    level,
    button("me-lightbox-in", words.zoomIn, ICON('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>'), () => zoomTo(scale * 1.25)),
    button("me-lightbox-fit", words.fit, ICON('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'), toFit),
    button("me-lightbox-actual", words.actualSize, ICON('<path d="M5 8l2-2v12M13 8l2-2v12M10 10v.01M10 14v.01"/>'), () => zoomTo(1)),
    button("me-lightbox-close", words.close, ICON('<path d="M18 6 6 18M6 6l12 12"/>'), () => done()),
  );
  box.append(img, bar);
  const show = (i: number): void => {
    at = (i + pictures.length) % pictures.length;
    img.alt = pictures[at]!.alt;
    box.setAttribute("aria-label", pictures[at]!.alt);
    img.onload = () => {
      // (fitted: the whole picture in the window, never larger than its own size)
      fit = Math.min(1, (innerWidth * 0.92) / img.naturalWidth, (innerHeight * 0.86) / img.naturalHeight);
      toFit();
    };
    img.src = pictures[at]!.src;
  };
  const done = (): void => {
    box.remove();
    document.removeEventListener("keydown", keys, true);
    restore?.focus?.();
  };
  const keys = (e: KeyboardEvent): void => {
    if (e.key === "Escape") done();
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") show(at + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") show(at - 1);
    else if (e.key === "+" || e.key === "=") zoomTo(scale * 1.25);
    else if (e.key === "-" || e.key === "_") zoomTo(scale / 1.25);
    else if (e.key === "0") toFit();
    else if (e.key === "1") zoomTo(1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  // view-state: (the wheel zooms round the pointer)
  box.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomTo(scale * Math.pow(1.0015, -e.deltaY), e.clientX, e.clientY);
  }, { passive: false });
  // view-state: (a press beside the picture closes; on it, a drag pans and a click toggles fitted and its own size)
  box.addEventListener("pointerdown", (e) => {
    if (bar.contains(e.target as Node)) return;
    if (e.target !== img) return void done();
    e.preventDefault();
    const x0 = e.clientX - x, y0 = e.clientY - y, sx = e.clientX, sy = e.clientY;
    let moved = false;
    img.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => {
      moved ||= Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3;
      if (!moved) return;
      x = ev.clientX - x0;
      y = ev.clientY - y0;
      place();
    };
    img.addEventListener("pointermove", move);
    img.addEventListener("pointerup", (ev) => {
      img.removeEventListener("pointermove", move);
      if (!moved) (scale > fit + 1e-6 ? toFit() : zoomTo(1, ev.clientX, ev.clientY));
    }, { once: true });
  });
  document.addEventListener("keydown", keys, true);
  document.body.append(box);
  show(index);
  box.focus();
}
