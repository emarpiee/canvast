# ADR 0070: Rename and delete in-canvas tags across the workspace

## Status
Accepted (v0.17.0)

## Context
In-canvas tags (ADR 0062) could be added and removed per selection only. A misspelt tag meant selecting every item that carried it, on every canvas.

## Decision
- Two places, one action: the **Layers panel** (click a tag chip of the selection: Rename on every canvas, Delete from every canvas) and the **Assets sidebar** "Canvas tags" ⋯ menu (Rename, Delete).
- `Session.changeCanvasTag(from, to | null)` changes the workspace. The open canvas goes through its document (`changeTagOnCanvas`), so one undo brings it back. Every other canvas is rewritten by `WorkspaceRepo.changeObjectTag` in one transaction (the `tags` index finds the objects; each touched canvas gets a new revision, and other tabs are told with a commit message).
- Renaming onto an existing tag merges (case-insensitive, first spelling wins); a case-only change is a rename. Delete asks first and says that other canvases cannot be undone.
- Writer tab only; a read-only tab is told why it cannot.

## Consequences
The change on other canvases is not on the undo stack. Library tags (Assets > Tags) stay separate.
