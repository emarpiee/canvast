# ADR 0137 and 0138 — Speed and crop of video and GIF; what a file says about itself

- Status: accepted (v0.18.1)

## 0137 — Playing speed and crop for video and GIF

- **Speed** (`media.speed`, 0.25 to 4, absent = 1): chosen in the player's Media & Playback settings (a list from 0.25× to 4×), stored on the instance (one undo step), given to the player's element (`playbackRate`) and to a GIF's frame timer (each frame's delay divided by it). A range of seconds is still in the file's own seconds.
- **Crop** works for video and GIF as for a still: the same handles and the same stored window (`crop`, whole source pixels). The player's element is made as big as the whole picture would be at the cropped scale, put so the window is where the object is, and clipped to the window (`clip-path: inset(...)`), turned about the object's pivot; the canvas draws a paused frame through the same window. Audio has none.

## 0138 — The file's own facts in the details panel

`src/assets/metadata.ts` reads, without decoding, what a file says: JPEG and WebP EXIF (make, model, software, date, exposure, aperture, ISO, focal length, lens, orientation, the place a photo was taken: shown so a person sees what a file gives away before sharing it), colour profiles (ICC from a JPEG, WebP or PNG: name and colour space), PNG kind, print size, gamma and text, a GIF's size, a video's codec, size and length. The Assets view shows it in "What the file says" (read when the details open, from the first 2 MB of an image or the whole of a video up to 100 MB). Nothing is changed in the file.

- **Orientation.** A JPEG whose EXIF asks for a quarter turn is shown turned: the browser decodes with the orientation (`imageOrientation: from-image`), and the picture's size (`pixelW`, `pixelH`) is that of the turned picture. A test with a made file keeps this.
- **Colour profiles** are applied by the browser when it decodes (a wide-gamut picture is converted to the screen's colours); canvast shows the profile's name and does not convert by itself.
- **Image pyramids** are not kept: a picture too big to decode whole is decoded as a reduced copy at the size the view needs (ADR 0027, 0030), which is what a pyramid would give at the cost of the storage of every level.
