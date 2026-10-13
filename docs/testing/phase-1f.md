# Phase 1, slice 6 test log — organizing the asset library

## Environment

Same as earlier phases: four E2E projects (`chromium`, `chromium-cpu`,
`chromium-dpr2`, `firefox`).

## Unit tests (`tests/unit/assets.test.ts`, 3 new)

| Test | Assertions |
| --- | --- |
| Tag normalization | `["  Hands ", "#ref", "hands", "", "a  b", "REF"]` gives `["Hands", "ref", "a b"]`. A 65-character tag and 101 tags are refused. |
| Folders | The subtree of a folder includes nested descendants and nothing else; the name path is `["Refs", "Hands", "Palms"]`. |
| Old entries | An entry without organization fields reads as no tags, not a favourite, no folders. |

## End-to-end tests (`tests/e2e/organize.spec.ts`, 4 tests × 4 projects)

| Test | Assertions |
| --- | --- |
| Tags and favourites | Add "Hands, ref". A case-insensitive duplicate adds nothing. The favourite toggle works, and the card shows `#Hands #ref`. The Favourites and `#ref` scopes show 1 asset; All shows 2. Search: `hand` 1, `#ref` 1, `#re` 0 (exact), `png colour` 1 (all words), empty 2. Removing a tag works. After a reload, the tags, favourite and tag list persist. |
| Folders | Create "Refs" and a subfolder "Hands". One asset is filed in both (two folders, one original), the other in Refs. Refs shows 2 (subfolders included), Hands 1, Unfiled 0. Renaming works; an empty name is refused with "A folder needs a name." and nothing changes. Deleting Refs (confirmed, with "stay in the library") removes both folders; both assets are still stored and Unfiled shows 2. |
| Archives | The manifest carries `{ tags: ["Hands"], favorite: true, folders: [["Refs","Hands"]] }` for the organized asset and empty fields for the other. Imported **twice** into a fresh profile: exactly one "Refs" and one "Hands" folder, and the favourite, the one tag and the filing are restored. |
| Read-only tab | The tag input and favourite toggle are disabled, and there is no "+ Folder" button. When the writer adds a tag, the reader's tag list shows it. |

Result: 8/8 in Chromium and Firefox, and **12/12** with the spec repeated 3
times in Chromium.

### Mutation check

Folder resolution on import was changed to always create new folders: the
archive test **fails** (2 "Refs" folders instead of 1). Restored afterwards.

### Defects found

1. **Lost edits from stale screen state** (application). The inspector
   wrote back whole tag and folder lists taken from the last rendered
   listing. Two quick changes raced, and the second write undid the first;
   the same would lose another tab's edits. Edits are now changes applied
   to the stored entry inside one transaction (`updateMeta` with add and
   remove). The test that exposed it (two folder checkboxes in a row) now
   passes.
2. **A half-typed tag was wiped by re-renders** (application). Any refresh,
   such as another tab's edit, rebuilt the inspector. The draft text and
   focus are now kept for the same asset.
3. **Stale build** (process). One run used a `dist/` built before the
   archive change. The test failure showed this; it was rebuilt and re-run.
4. **Test locators** (test). `getByLabel(/^Refs$/)` matched nothing because
   of whitespace in the label template, and typing could start before the
   inspector showed the newly selected asset. Fixed with role and name
   locators, a `pick()` helper that waits for the selection, and a tidier
   template.

## Regression

`npm test` (quick suite, 4 projects) on the v0.6.0 build `07154eec…26b4`:
**217 passed, 3 skipped by design** (the touch test outside the touch
project), **0 failed** (E2E 16.2 min). Unit tests 82/82; the offline and
naming checks pass.

## Not covered (unverified)

- Libraries with tens of thousands of assets (the filter is linear).
- Screen-reader announcements of scope changes (the controls are labelled,
  but a screen reader has not been run).
