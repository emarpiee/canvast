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

## Showcase GIF (`.github/workflows/showcase-gif.yml`)

Run 43536039426 on 0.58.31 (2026-11-14): **21 min 34 s** from start to end, 25 clips, all passed.

| Step | Time |
| --- | --- |
| Set-up (checkout, Node, `npm ci`, apt packages, Chromium, the build) | 44 s |
| Record the clips (one worker, frame by frame) | 14 min 0 s |
| Render the video (3,600 frames at 1920 × 1080, then the soundtrack) | 5 min 50 s (frames about 5 min 3 s, sound and mux 45 s) |
| The GIF (palette, GIF, `gifsicle`) | 51 s |
| Upload | 3 s |

| Clips | Time |
| --- | --- |
| The slowest | endless 2.6 min, comic 1.4 min, refs 1.0 min, values 52.8 s, shapes 50.9 s, draw 49.3 s |
| The rest | 9.6 s (lock) to 42.6 s (themes); about 22 s on average |

| Result | Size |
| --- | --- |
| `canvast-60s.mp4` | 52.9 MB (1920 × 1080, 60 fps, 60 s, AAC sound) |
| GIF before `gifsicle` | 38.2 MB |
| `canvast-60s.gif` | 23.5 MB (720 × 405, 12 fps, 720 frames, 128 colours) |

Estimate: about 22 min for a whole run. The clips cannot be recorded one at a time on GitHub (each run records all of them), so a fix to one
clip costs a whole run. A clip that fails stops the run after about 15 min, before the render.
