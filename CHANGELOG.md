# Changelog

## 0.0.1 — Phase 0A: endless navigation prototype (2026-10-13)

- Exact dyadic world coordinates (`src/core/dyadic.ts`) and a log2 camera with
  no zoom or pan bounds (`src/core/camera.ts`).
- Exactly reversible anchored zoom and pan, achieved by quantizing zoom steps
  (2^-20 level) and screen offsets (2^-32 px), with a 4,096-level precision
  budget.
- Canvas 2D renderer that works on the CPU: hierarchical grid, axes,
  landmarks.
- Input: wheel, ctrl+wheel pinch, shift+wheel pan, drag, touch pinch/pan,
  keyboard, HUD buttons.
- Single-file build (`npm run build` → `dist/canvast.html`) with a strict CSP
  and a static offline check.
- Unit tests (Vitest) and a Playwright navigation regression harness running
  in default, GPU-disabled, and DPR-2/touch Chromium configurations.
