# Gaps against the engineering plan (checked 2026-10-16)

Checked against sections 5 to 7 of the plan and the roadmap. "Gap" means the plan asks for it and the app does not do it yet.

| Plan item | State | Note |
| --- | --- | --- |
| §5 Non-destructive editing: crop, masks, exposure, curves, colour, blur, sharpen, grain, adjustment stacks, copy and paste adjustments | **Gap (large)** | Only opacity and blend modes exist. No crop, no adjustment stack, no filters. |
| §6 Ratings | Gap | Favourite only. |
| §6 Filters by colour, dimensions, orientation or aspect ratio, category chips | Gap | Search matches name, kind, hash start and tags; the usage filter is All / In use / Unused. |
| §6 Duplicate review; approximate visual similarity | Gap | Exact duplicates are merged by hash on import; there is no screen to review them and no similarity. |
| §6 Independent collections | Decided against | One folder per asset plus tags (owner, 2026-10-16, ADR 0057). |
| §6 Search at large scale (incremental index) | Partial | A linear filter over the in-memory list; fine for thousands, to be measured in Phase 8. |
| §6 Metadata inspector | Partial | Name, size, pixels, kind, usage, tags, folder; no EXIF or colour data. |
| §7 Storage | Done with limits | IndexedDB only (no OPFS or SQLite); quota shown in Settings; no file-system save for very large libraries. |
| §7 Portable format at hundreds of gigabytes | Gap | Stored ZIP without ZIP64: 4 GiB and 65,535 entries per archive; archives are built and verified from Blobs, not streamed. |
| §7 Plain ZIP of originals by kind or folder | Done (ADR 0057) | Not in the original plan; added at the owner's request. |
| Phase 8 Scale and compatibility | Not started | Large projects, multi-tab conflicts, qualification matrix. |
| Phase 9 Standalone release | Not started | Reproducible build, licences, clean-machine test. |
| Phase 10 Collaboration | Not started (optional) | Settings says it is off. |
