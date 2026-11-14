# Workflow times: Screenshots and Showcase GIF

How long the runs that make the README's pictures and its animation take on GitHub's runners (`ubuntu-latest`, 4 cores), to plan a
retake. Times vary with the shared machines; plan with some margin.

## Screenshots (`.github/workflows/screenshots.yml`)

Every picture, run 43529875886 on 0.58.30 (2026-11-14): **13 min 24 s** from start to end, 91 pictures, all passed.

| Step | Time |
| --- | --- |
| Set-up (checkout, Node, `npm ci`, apt packages, Chromium) | 57 s |
| The builds (web, desktop, tools) | 2 s |
| Draw the showcase | 1 min 30 s |
| Take the pictures (4 workers) | 10 min 38 s |
| WebP and upload | 12 s |

| Pictures | Time |
| --- | --- |
| A picture on average | 24.5 s (about 6 s of the run each, with 4 workers) |
| The slowest | pen-stabilizer 51.9 s, pdf-extract 51.9 s, model-lines 48.7 s, properties 47.1 s, viewer-grey 46.5 s, rename-many 46.5 s |
| One picture alone (`-f grep=…`) | about 2 min 10 s in all (set-up and showcase 1 min 50 s, the picture about 12 s) |

Estimate: about 3 min of fixed cost plus 7 s per picture.

