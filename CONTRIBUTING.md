# Contributing to canvast

Thank you for helping. Bug reports, ideas and pull requests are all welcome. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Reporting a bug

[Open an issue](https://github.com/emarpiee/canvast/issues/new/choose) with the bug report form. Say:

- what you did, what you expected and what happened instead;
- whether it was the browser version (and which browser) or the desktop app;
- the version, from Settings > About and diagnostics. *Save a report* there adds the details that help most.

A file that shows the problem (a small `.canvast` backup) helps even more. A **security problem** goes privately, not in an issue: see [SECURITY.md](SECURITY.md).

## Asking for a feature

[Open an issue](https://github.com/emarpiee/canvast/issues/new/choose) with the feature request form. Check the README's [Limitations](README.md#limitations) first: it may already be listed, with the reason.

## Sending a change

1. Fork the repository and make a branch for one change.
2. Set it up: Node.js 26.4 (see `.nvmrc`) and `npm ci`; `npm run build` makes `dist/canvast.html` (see [Building from source](README.md#building-from-source)).
3. Make the change, with a test for new logic or a fixed bug (extend the nearest existing test rather than adding a copy).
4. Run `npm test` (typecheck, unit tests, the end-to-end groups your change needs, and the checks). See [Testing](README.md#testing).
5. Keep the README true to the change: usage, shortcuts, Limitations.
6. Open a pull request saying what it changes for the user and why. The template lists the checks. GitHub runs the checks and the whole end-to-end suite on it.

### The project's rules

[`CLAUDE.md`](CLAUDE.md) holds them all (it is written for coding agents, and it is the same rules for people). The ones a change meets most often:

| Rule | In short |
| --- | --- |
| Offline | No network request and no runtime dependency, ever; `npm run check:offline` fails otherwise |
| Exact coordinates | Positions are exact dyadic numbers, never plain floats (see [How it works](README.md#how-it-works)) |
| Design tokens | No fixed colours, sizes or spacing in the CSS: every value is a token in `:root` (`npm run check:tokens`) |
| One icon per function | Two buttons that do different things never share an icon; the registry is `docs/reference/icons.md` |
| Storage through its interfaces | Only the storage implementations use IndexedDB (`npm run check:storage`) |
| Tests from a snapshot | Every test runs from its own build (`npm run test:snap`), never from `dist/` |
| Plain words | The interface says what things do in common words; the README describes only what the app does now |

## What is planned

[BACKLOG.md](BACKLOG.md) lists the work that is not done yet, each item with its priority and status. Before asking for a feature or starting a change, look there: it may be planned, or dropped with the reason. A pull request for an item names its ID (`B7`).

## Builds for other systems

The desktop app is made, tested and shipped for Linux. **Builds for Windows and macOS are open for contribution**, on these terms:

| Term | |
| --- | --- |
| A maintainer | Each system has someone who builds it, tests it on that system and answers its issues. A build with no maintainer is not shipped |
| Built on GitHub | It is made and checked by a workflow on GitHub's own Windows or macOS machines, as the Linux packages are (`release-packages.yml`): never on a personal computer |
| The same rules | The same code, tests and checks; the end-to-end suite runs on that system too. What only that system needs stays in the desktop shell (`desktop/`), behind the bridge the app already uses |
| No step back on Linux | A change for another system that breaks or slows the Linux app is not merged |
| Signing | A build that the system warns about or blocks unsigned (macOS notarization, Windows SmartScreen) is signed, with the maintainer's certificate and the cost theirs, before it is shipped |
| Releases | It is attached to the same releases, from the same version, and listed under *Installation* in the README |
| Support | Bugs on that system go to its maintainer; the README says what is verified there and what is not (Limitations) |
| Retiring | A build whose maintainer leaves, or that fails its checks for two releases, stops being shipped; the README says so |

Open an issue first to say which system you would take on: the details are settled there before any work starts.

## Supporting the developer

If canvast helps your work, you can support its development through [PayPal](https://paypal.me/emarpiee).
