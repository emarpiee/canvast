# ADR 0088: The library sidebar layout

## Status
Accepted (v0.17.0)

## Decision
The library sidebar sits beside the redesigned details panel (ADR 0087) and uses the same language: a panel with the HUD background, border and large radius; inside it the three fixed views (All assets, Favourites, Unfiled) as one quiet group, then Folders, File types, Tags and Canvas tags as cards with one heading style (small, semibold, muted) and one gap (`--sp-5`). Every row is one height (`--sp-12`), counts are a small quiet number at the end, and the open row is the only one in the accent (semibold). Sizes, spacing and colours come from the `:root` tokens only. The markup, the keyboard behaviour and the small-screen collapse are unchanged; the panel frame applies from 901px up, and below that the sidebar stays the folding "Library: …" bar.
