# Security policy

## Supported versions

Only the [latest release](https://github.com/emarpiee/canvast/releases/latest) gets security fixes, in the browser version (`canvast.html`) and the desktop app alike. Updating is the fix: download the new file, or let your AppImage updater fetch it.

## Reporting a vulnerability

Please report it **privately**, not in a public issue: use [**Report a vulnerability**](https://github.com/emarpiee/canvast/security/advisories/new) on the repository's Security tab. Say what you found, how to reproduce it (a small file or steps), which version, and whether it is the browser version (which browser) or the desktop app.

You will get an answer within about a week. Once a fix is released, the report is published as an advisory, with credit to you if you want it.

## What counts

canvast is offline by design, so the things worth reporting are mostly about files and data:

| Area | Examples |
| --- | --- |
| Opening files | A `.canvast` backup, an SVG, a font or a picture that runs code, reads data it should not, or crashes the app every time it is opened |
| The offline promise | Any way the app (browser or desktop) makes a network request, or loads anything from outside itself |
| Hidden items in the desktop app | A way to read encrypted hidden items without the password, or a weakness in their [file format](README.md#hidden-items-the-file-format) |
| The desktop app's folder access | A way for the page to read or write files outside the workspace folder |
| Passwords | A way past the workspace or Hidden items password other than the limits the README already describes |

Not vulnerabilities, because the README already says so: the passwords of the browser version are gates, not encryption; exported backups that include hidden items are not encrypted; someone with access to your computer's storage can read what is not encrypted. See [Privacy and security](README.md#privacy-and-security) and [Limitations](README.md#limitations).
