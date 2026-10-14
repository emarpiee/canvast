# Plan: arrange, align and distribute commands

Status: built (ADR 0036; "date" is the date an image was added to the library). Originally planned for Phase 5 (creative editing), owner request of 2026-10-14. The batch-import grid it shares its layout with is built (ADR 0030).

## Request

Arrange the selected items in a grid, in **A–Z** or **Z–A** order.

## Where it belongs

It is not a performance item. It sits with the selection and transform commands: Phase 2 built rotation, snapping, groups and stacking; the commands that place many objects relative to each other come with Phase 5 (creative editing). The vault plan has it in §14.14 (operations) and in the Phase 5 row.

## What it will do

- **Arrange in grid** on any selection (images, strokes, text, groups as one unit each): the layout of ADR 0030 (`gridLayout`): columns from the number of items and their aspect ratio so the grid is about as wide as it is tall, cells as large as the largest item, each item centred in its cell, reading order left to right then down. Unlike the import, it keeps the items' size and the grid's centre (or top-left) where the selection was, and scales nothing.
- **Order:** by name A–Z or Z–A (file name for an image, the first words for a text, "Stroke" last), and also date added, size and type. A toolbar menu on the selection, and a command each.
- **Exact and undoable:** each item moves by one exact translation (the same `translate` that moves a selection), the whole arrangement is one transaction, and rotation, groups, locks and hidden items follow the existing rules (locked items are not moved).
- **Also in this family:** align left, centre, right, top, middle, bottom and distribute horizontally or vertically, with the same exact translations.

## Not decided

Whether a name is editable for objects (names are what the Layers panel and the sort need); that comes with the object names item of the Layers panel (ADR 0024).
