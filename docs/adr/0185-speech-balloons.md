# ADR 0185: Speech balloons and text tied to shapes

- Status: **accepted** (2026-11-09)
- Related: ADR 0103 (boolean groups, derived results), ADR 0105 (shapes that keep their numbers)

## Decision

- A balloon is a path with `shape: "balloon"` and `params.balloon` (body, tails). Its outline is made from those numbers (`doc/balloon-geometry.ts`), so moving, scaling, undo and saving are a shape's. Editing its nodes ends this, as for any shape.
- A connector is a path with `params.link`, naming two balloons. It is made again in the transaction that changes them (`doc/balloon-link.ts`), so undo cannot find it out of step. A neck also has a fill-only piece above the balloons, which removes their outlines where it joins them.
- Text in a shape or along a path names its parent (`inShape.shape`, `onPath.path`). The parent decides where the words go: `withShapeTexts`, in `DocumentStore.transaction`, fits them in the same transaction. When the parent is deleted the text is plain again.

## Consequences

- Texts tied before the parent was recorded do not follow until set again.
- The words of a balloon fit its body, without the tails.
