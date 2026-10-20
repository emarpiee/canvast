## What and why

<!-- One or two sentences: what changes for the user, and why. Link the issue: Fixes #. -->

## Checks

- [ ] `npm test` passed on a snapshot build (or the specs this touches, listed below)
- [ ] New logic, a reported bug or a new rule has a test; nothing redundant added
- [ ] README updated (usage, shortcuts, Limitations, technical notes) or checked and unaffected
- [ ] `CHANGELOG.md` and `docs/status.md` updated; ADR added in `docs/adr/` for a design decision
- [ ] No hardcoded CSS values (`npm run check:tokens`); icon registry updated for a new icon
- [ ] Works offline from `file://`; no new runtime dependency or network request
- [ ] Tried in Chromium and Firefox (or says below why not)

## Tests run

<!-- Commands and results, for example: npm run test:snap -- tests/e2e/storage.spec.ts → 4 passed -->

## Risks and what was not checked

<!-- Data the change could lose or expose, browsers or devices not tried. -->
