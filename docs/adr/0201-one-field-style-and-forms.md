# ADR 0201: One look for every field, and sub-menus as forms

- Status: **accepted** (2026-11-14)
- Related: ADR 0198 (floating bars and popovers: a popover is a form), 0156 (panels)

## Context

Fields (numbers, text, lists) were styled place by place: about 30 rules each set their own height, padding, border, radius and font,
some with an underline and no box, some with spin arrows, numbers left- or right-aligned. The sub-menus opened from a chip (Outline
options, Paragraph and box options, Font options, Columns and rows) were laid out by hand, not as the forms of ADR 0198, with checkboxes
where the chips have switches.

## Decision

- **One field rule** at the top of `src/styles.css` (`:where(select, input…)`): `--field-h` tall, the `--hud-edge` edge, `--r-sm`
  corners, the value font. Numbers are right-aligned with tabular figures and have no spin arrows (they are dragged, typed or stepped
  with the arrow keys). A place sets only its width (and a height where a row needs another one), never the look.
- **Sub-menus are forms**: `formRows(pop)` (`ui/bar-sections.ts`) marks each row's kind (value, choice, switch, more), moves a unit into
  the name, and orders the rows as a chip's form (`arrangeForm`); `keepOrder` for a menu whose rows have an order of their own (Columns
  and rows). Its on/off options are switches (`role="switch"`, `aria-pressed`).
- **Names** in forms are small and muted (`--font-meta`, the muted text colour), so the values read first.
- The colour picker follows the one field look when it is in the app.

## Consequences

- A new field needs no CSS but its width. `fieldLooks(page)` (`tests/e2e/harness.ts`) reads every shown field's look; `scrub-audit.spec`
  checks there is one look and that numbers are right-aligned. `floatingRules` checks every shown sub-menu form as a chip's form.
