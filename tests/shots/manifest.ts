// Every README picture: the section it belongs to (its anchor), what an artist uses the feature for there, and the alt text, which says
// exactly what the picture shows. `npm run check:shots` fails when the README links a picture that is not here, or one here is not linked.
export interface ShotSpec {
  readonly section: string;
  readonly use: string;
  readonly alt: string;
  /** The pointer stays where the shot left it (a hover is part of the picture). */
  readonly pointer?: boolean;
}

export const SHOTS: Record<string, ShotSpec> = {
  // Reference boards
  "board": { section: "#what-you-can-do", use: "Collect drawings by different masters on one board to compare how each handles the same subject.", alt: "A board titled Horses: three masters, with Delacroix's Study of a Horse, Rosa Bonheur's study for The Horse Fair and de Gheyn's two studies of a saddled horse, a handwritten note under each" },
  "import-menu": { section: "#bringing-files-in", use: "Bring a whole folder of references in at once.", alt: "The Library's Import button open on its two choices: files, or a whole folder" },
  "crop": { section: "#pictures", use: "Crop a study down to the part you are learning from, without changing the file.", alt: "Rosa Bonheur's study for The Horse Fair being cropped to the group of horses on the left, the cut part dimmed" },
  "flip": { section: "#pictures", use: "Mirror a drawing to see its proportions with fresh eyes.", alt: "De Gheyn's two studies of a saddled horse beside a mirrored copy, labelled original and flipped, the Flip buttons in the Picture chip's options above the copy" },
  "corners": { section: "#pictures", use: "Give a print rounded corners and a thin outline, as a card on a mood board.", alt: "Hokusai's Mystical Bird with rounded corners and a cream outline, the corner radius in the Shape chip's options above it" },
  "adjust-values": { section: "#adjust", use: "Make a value study: the same painting in grey with more contrast, to read its light and dark masses.", alt: "Van Gogh's Wheat Field with Cypresses beside a greyscale copy with high contrast, labelled colour and values, the Adjust panel open" },
  "adjust-shadow": { section: "#adjust", use: "Give prints a soft drop shadow so they read as paper laid on a table.", alt: "Three Hokusai prints with a soft drop shadow, the shadow settings of the Adjust panel open" },
  "sheets": { section: "#sheets", use: "Put a print and its label on a sheet: the sheet holds them, moves them as one and cuts what goes past its edges.", alt: "Mary Delany's Botanical Study and its label on a cream sheet, the sheet selected with its ratio in the Size chip's options above it" },
  "auto-layout": { section: "#auto-layout", use: "Let a sheet lay its pictures out in a grid that stays tidy as you add more.", alt: "The horse board's sheet selected, its pictures in a three-column grid, the gap and padding handles on it, the Layout chip's options open above it" },
  "layout-masonry": { section: "#auto-layout", use: "Pack references of every shape into tidy columns with no holes.", alt: "Hokusai prints, Degas dancers and botanical studies in four masonry columns of one width on a light sheet" },
  "layout-justified": { section: "#auto-layout", use: "Lay a row of landscapes out as a gallery, each row one height and as wide as the board.", alt: "Landscapes, Hokusai prints and a Degas dancer in justified rows on a dark sheet, each row one height" },
  "layout-tracks": { section: "#auto-layout", use: "Plan a page: a wide panel across all the columns, the columns sized by rule.", alt: "A grid of dancer and horse studies, a wide horse study by Rosa Bonheur spanning all three columns, with the Columns and rows popover open: the middle column set to a share of the room" },
  "arrange": { section: "#arranging-and-snapping", use: "Put a loose pile of studies into a grid in one step.", alt: "Four Degas dancer drawings scattered, with the Arrange menu open on its grid choices" },
  "align": { section: "#arranging-and-snapping", use: "Line studies up along their bottom edges.", alt: "Three Degas dancers aligned on their bottom edges, the Align menu open" },
  "layers": { section: "#layers", use: "Keep a master study in groups: the reference locked, the construction and the line of action on their own.", alt: "A study over Delacroix's horse: construction ovals and a line of action drawn on it, the Layers panel listing the groups, the reference locked" },
  "reveal": { section: "#reveal-and-the-ctrl-list", use: "Find and pick a print buried under others in a pile.", alt: "A pile of Hokusai prints with Ctrl held: the list of what lies under the pointer, one print outlined", pointer: true },
  "media": { section: "#video-audio-and-gifs", use: "Plan a camera move for an animatic: a slow pan across a painting, played on the board.", alt: "A clip of a slow camera pan across Van Gogh's Wheat Field with Cypresses playing on the canvas, its player bar below it", pointer: true },
  "extract-frame": { section: "#video-audio-and-gifs", use: "Keep a key frame of a clip as a still picture, to draw from or to place in a storyboard.", alt: "A camera pan across Van Gogh's Wheat Field with Cypresses as a clip on the canvas, and beside it the frame extracted from it as a picture" },
  "canvas-tags": { section: "#tags-on-the-canvas", use: "Tag the studies on a canvas by what they teach, and find them again.", alt: "Studies tagged gesture and anatomy, the Tags panel listing the tags with their counts" },

  // Drawing and vector editing
  "pen": { section: "#pen", use: "Find the gesture: draw a line of action over each figure, from the head through the weight to the foot that carries it.", alt: "Three Degas dancers with a red line of action drawn over each with the Pen, the Pen's kinds in the Brush chip's options" },
  "pen-stabilizer": { section: "#pen", use: "Draw a long, calm contour: the stabilizer smooths the wobble of the hand.", alt: "Delacroix's Study of a Horse beside a long ink line of a horse's back drawn with the Pen, the Stabilizer on in the Brush chip's options" },
  "shape-kinds": { section: "#shapes", use: "Block in a composition as flat value shapes before painting.", alt: "A landscape thumbnail made of shapes in four greys: sky, sun, two hills and a near ground, the Shape tool's kinds in the Shape chip's options" },
  "shapes": { section: "#combining-shapes", use: "Build an icon from simple shapes: a wave crest is a circle and a block joined, with circles cut out for the curl and the claws.", alt: "On the left the loose parts, a blue circle and block with cream circles over them; on the right the crest they make once subtracted, the Shapes menu open" },
  "nodes": { section: "#paths-and-nodes", use: "Refine a combined shape by its nodes: here the claws of the wave crest.", alt: "The wave crest in node editing, the nodes of its claws selected" },
  "mask": { section: "#masks", use: "Frame a reference in an oval, as on a botanical print, without cutting the file.", alt: "Mary Delany's cut-paper Botanical Study inside an oval clipping mask, with a label set in Cormorant Garamond, the Masks menu open" },
  "fill-gradient": { section: "#fill-and-outline", use: "Paint a sky as a gradient from dusk to dawn colours.", alt: "A rectangle filled with a linear gradient, the fill picker open on its gradient stops" },
  "pattern": { section: "#pattern-and-guides", use: "Make an endpaper for a book: a scale pattern made as vectors on a sheet.", alt: "A sheet filled with a scale pattern, the Pattern panel open on the Scales generator" },
  "guides": { section: "#pattern-and-guides", use: "Read a composition: lay a golden spiral over the print to see where the eye travels.", alt: "Hokusai's Great Wave with a golden spiral guide over it, the Pattern panel on its Guides tab" },
  "palette": { section: "#styles", use: "Take the colours of a reference as a palette to paint with.", alt: "Hokusai's Great Wave and, in the Styles panel, a palette of its main colours made from the picture" },
  "colour-picker": { section: "#the-colour-picker", use: "Match a colour by eye: mix a swatch until it sits beside the Prussian blue of the print.", alt: "Hokusai's Great Wave, a blue swatch beside it, and the colour picker open on the swatch's fill" },
  "path-tools": { section: "#more-vector-tools", use: "Set a title along a curve for a cover.", alt: "The words Under the wave off Kanagawa set along a curved line, the Path tools menu open" },

  // Comics and storyboards
  "comic": { section: "#a-page-of-panels", use: "Lay out a comic page from four pictures and letter it.", alt: "A comic page of four panels: Hokusai's Seaside Village in Winter with the caption Winter. The village waits for the boats.; Le Prince's Landscape with Peasants Fording a Stream with a balloon saying The ford is high this year.; Verhaecht's Mountainous Landscape with the caption Three days over the pass.; and Hokusai's Great Wave with a burst shouting Hold on! over the boats" },
  "balloon-kinds": { section: "#speech-balloons", use: "Pick the balloon that fits the line: speech, thought, a shout or a caption box.", alt: "Four lettered balloons: a speech balloon, a thought cloud with bubbles, a burst shouting Look out! and a yellow caption box, the Preset in the selected balloon's Body chip" },
  "balloons": { section: "#speech-balloons", use: "Point a balloon's tail at the speaker.", alt: "A speech balloon over Le Prince's peasants fording a stream, its tail pointing at them, selected with its handles, its Tail chip's options open" },
  "text": { section: "#text", use: "Set a cover's type: a title and a subtitle in fonts of your own.", alt: "Hokusai's Great Wave with the title THE CROSSING being set in Bangers above it and a subtitle in Cormorant Garamond italic, the Text chip's options open" },

  // The Library
  "library": { section: "#the-library", use: "Keep every reference once, in folders by subject, and see a print's details beside the grid.", alt: "The Library in the light theme: folders Japanese prints, Horses, Dancers, Landscapes and Botanical in the sidebar, the gallery of prints and drawings, Hokusai's Great Wave selected with its tags and folder in the details" },
  "library-list": { section: "#the-gallery", use: "Read a collection as a list, with each file's size, pixels and tags.", alt: "The Library as a list: name, pixels, type, size and tags of each drawing and print, Rosa Bonheur's study selected" },
  "sidebar": { section: "#folders-and-tags", use: "Pin the folder you work from most, nest tags by subject and keep the searches you repeat.", alt: "The Library's sidebar: Japanese prints pinned first among the folders, tags nested as animal/horse, animal/bird and figure/dance, and two saved searches" },
  "search": { section: "#search", use: "Find the figure drawings in a tall format with one search.", alt: "The search #drawing #figure orientation:portrait finding Degas's dancer drawings, with the chip of what is filtered" },
  "search-help": { section: "#search", use: "Look up the search words while typing.", alt: "The search help card: each operator and keyword with an example" },
  "viewer-grey": { section: "#the-viewer", use: "Check a print's values: see it in greyscale in the viewer.", alt: "Hokusai's Great Wave in the viewer, shown in greyscale, the strip of the folder's other prints below" },
  "organize": { section: "#organize", use: "File a reference and tag it in one dialog.", alt: "The Organize dialog for Mary Delany's Botanical Study: the folders as a tree with Botanical chosen, and the Tags tab" },
  "bulk": { section: "#selecting-and-details", use: "Tag or file several drawings at once.", alt: "Four Degas dancer drawings selected, the details panel listing their tags with how many have each, their folder, and what can be done to all four" },
  "similar": { section: "#similar-images", use: "Find a second scan of the same print hiding in the collection.", alt: "Similar images: Hokusai's Great Wave beside a smaller, warmer second scan of it" },
  "art-files": { section: "#art-files", use: "Keep paintings in progress from other apps beside their references: their picture shows without opening them.", alt: "A Krita file and an OpenRaster file in the Library, each showing the picture it keeps, the Krita painting-over of a Degas dancer selected" },
  "font": { section: "#fonts", use: "Keep the fonts of a project with its pictures and see each one set.", alt: "The Bangers font selected in the Library: its card in its own letters and a sample in the details" },

  // Notes
  "notes-editor": { section: "#notes", use: "Keep study notes on a reference: its facts as properties, the print embedded, a checklist of what to look at and a copy plan.", alt: "A markdown note, The Great Wave: study notes, open in the notes editor: the print embedded, a checklist of the crest, Mount Fuji and the three boats, and a table of the copy plan" },
  "notes-links": { section: "#links-and-tags", use: "Link notes to each other and see what links to a note.", alt: "The note Seaside Village in Winter selected in the Library, its details listing the study notes of The Great Wave under Linked from" },
  "note-properties": { section: "#properties-1", use: "Keep a work's facts (artist, date, medium, series) as properties you can search.", alt: "The details of The Great Wave's study notes: properties artist Katsushika Hokusai, date ca. 1830–32, medium Woodblock print, series and status, and its tags" },
  "notes-panel": { section: "#notes-on-a-canvas", use: "Keep the notes beside the picture they are about, and edit them there.", alt: "The Great Wave on a canvas beside the card of its study notes, the note open in the Note panel" },

  // Privacy and hidden items
  "context-menu": { section: "#context-menus", use: "Reach what fits the thing under the pointer with a right click.", alt: "The context menu of a print on the canvas: its commands in groups, each with an icon and a short description" },
  "library-hide": { section: "#hidden-items-and-passwords", use: "Hide a drawing you must not show (work under NDA, say) before sharing the screen.", alt: "Degas's Dancer Onstage selected in the Library, the pointer on the Hide button beside the star in its details", pointer: true },
  "hidden-list": { section: "#hidden-mode", use: "Work on the hidden drawings in hidden mode: the Library lists only them.", alt: "Hidden mode: the Library listing only the four hidden Degas drawings, the Hidden mode chip with its pin, Exit and Lock at the start of the status bar" },
  "padlock": { section: "#hiding", use: "A hidden drawing already placed on a canvas shows a padlock, not its picture.", alt: "A canvas with Hokusai's Great Wave and, beside it, the hidden Degas drawing drawn as a padlock" },
  "export-hidden": { section: "#exports-and-backups-ask", use: "Decide whether a backup carries the hidden items.", alt: "The question before a backup: one hidden item would be in it; Leave them out, chosen, or Include them" },
  "privacy": { section: "#hidden-mode", use: "Set the opening word, remembering, and the two passwords.", alt: "Settings, Privacy: the word that opens the Hidden items, remembering the Hidden password, and both passwords set" },
  "lock-screen": { section: "#hidden-mode", use: "A workspace with a password shows nothing until it is given.", alt: "The lock screen: This workspace is locked, a password field and Open" },

  // The endless canvas
  "hero": { section: "#the-endless-canvas", use: "Go anywhere on one canvas: the showcase's Solar System at home.", alt: "The showcase canvas at home: the Solar System, with the title canvast and its two lines" },
  "deep-zoom": { section: "#try-the-showcase-powers-of-two", use: "Zoom in past any limit: one million levels below home, everything still works.", alt: "A heart one million zoom levels below the Solar System, with the title One million zoom levels" },
  "zoom-out": { section: "#try-the-showcase-powers-of-two", use: "Zoom out as far as in: the multiverse a thousand levels above.", alt: "The multiverse, a thousand zoom levels above the Solar System: bubbles of universes, ours marked" },
  "tour": { section: "#bookmarks-and-tours", use: "Play a canvas's bookmarks as a tour, for a talk or a review.", alt: "A tour of the showcase's bookmarks, in the light theme: the bookmark list and the tour's bar at the bottom" },
  "switcher": { section: "#boards-and-canvases", use: "Keep a project's boards and canvases in one place and jump between them.", alt: "The board and canvas menu: a Picture book board with Cover, Spread 1 and Spread 2, and a References board with Horses and Landscapes" },
  "bookmarks": { section: "#bookmarks-and-tours", use: "Bookmark each study on a long reference canvas to go back to it in one click.", alt: "The Bookmarks panel listing four bookmarks of a canvas of horse drawings and a print, each with its picture" },
  "canvas-search": { section: "#search-on-the-canvas", use: "Find the studies tagged #gesture on a busy canvas.", alt: "Search on the canvas for #gesture, the tagged dancer drawings found" },
  "command-palette": { section: "#the-command-palette", use: "Run any command by name: typing flip finds the flip commands for the selected print.", alt: "The command palette with flip typed, listing the flip commands, Hokusai's Great Wave selected behind it" },
  "settings": { section: "#settings", use: "Make the app yours: theme, theme colour, density and the canvas.", alt: "Settings, Appearance, in the light theme: theme, theme colour, colourfulness and the canvas and info bar rows" },
  "shortcuts": { section: "#keyboard-and-pointer-reference", use: "Change any shortcut, with a warning when two clash.", alt: "Settings, Shortcuts: every command with its keys, in the dark theme" },
  "info-bar": { section: "#the-info-bar", use: "See what the app is doing: zoom, frame times and memory, with Information shown set to Technical.", alt: "The info bar with Information shown set to Technical: the exact zoom, frame times and what the pictures, tiles and undo history hold in memory" },
  // Your workspace and data
  "storage": { section: "#saving", use: "See that the work is saved and verified, how much space it takes, and make a backup.", alt: "Settings, Storage: the space used, the saving state, and the backup buttons" },
  "advanced-export": { section: "#advanced-export", use: "Back up only part of a collection: three prints, ticked.", alt: "Advanced export: a search field, three Hokusai prints ticked among the items, and the size of what is chosen" },
  "delete-all": { section: "#what-can-delete-data", use: "Start from scratch, safely: it asks, offers a backup and wants DELETE typed.", alt: "The Delete all data dialog: what will be deleted, the backup offered, and the field for DELETE" },
  "take-over": { section: "#several-tabs", use: "A second tab on the same workspace follows the first and can take over.", alt: "A second tab on the same canvas, read-only, offering Take over" },
  // Exporting and sharing
  "export": { section: "#export", use: "Export a comic page at print size, as PNG, WebP, JPEG or PDF.", alt: "The Export dialog for a page of four prints: its preview, the size presets in pixels and inches at 300 ppi, the formats and the background" },
  "export-each": { section: "#export", use: "Export several pictures at once: leave some out, name the files by a pattern, and add a 2× copy of each.", alt: "Export with four prints selected: three ticked and one left out (faded), the file names made from the pattern ###-{name} (001-, 002-…) listed under it with their @2x copies, and the Output choice of separate files, PDF pages or one picture" },

  // PDFs, 3D models and backups
  "pdf-view": { section: "#pdfs-and-3d-models", use: "Read a study handout beside your pictures, without another app.", alt: "A PDF handout, Reading a woodblock print, open in the Library's PDF view: its first page, the page box, and its thumbnails" },
  "pdf-extract": { section: "#pdfs-and-3d-models", use: "Copy a diagram out of a handout to draw over it, as a picture of its own.", alt: "A PDF handout's card on a canvas and, beside it, its second page extracted as a picture" },
  "model-view": { section: "#pdfs-and-3d-models", use: "Turn a simple 3D object under a light, as the start of a still-life lighting study.", alt: "A turned vase in the 3D view, lit from one side, its camera and surface settings beside it under the View tab" },
  "model-lines": { section: "#line-art-of-a-3d-model", use: "Draw a model as a technical illustration or a print: its outline, creases and the edges behind, with hatching or dots where the light does not fall.", alt: "The vase drawn as an etching in the 3D view: an ink outline, cross-hatched shadows on its dark side, on cream paper, with the Lines tab beside it" },
  "model-line-styles": { section: "#line-art-of-a-3d-model", use: "Give a model the look of a blueprint or a comic in one choice, and keep your own looks for other models.", alt: "The Line styles menu of the 3D view open over the vase: Blueprint, Ink, Architectural, Etching, Patent, Comic dots, Pencil and Toon, then Save these lines as a style", pointer: true },
  "model-narrow": { section: "#line-art-of-a-3d-model", use: "Check a figure's pose on a phone: the model above, its settings below.", alt: "The 3D view on a phone: the vase in ink lines above, the Lines tab as a sheet under it, and the bar's other buttons folded into its ⋯ button" },
  "import-choice": { section: "#importing-a-backup", use: "Bring a backup back: update this workspace, or add its boards beside what is here.", alt: "The How to import question over Settings, Storage: Update this workspace, and Add as new boards, each with what it does" },

  // The Library, details
  "properties": { section: "#properties", use: "Catalogue a reference with what the museum says of it: artist, date, medium, source.", alt: "Hokusai's Great Wave selected, its details listing the properties artist Katsushika Hokusai, date ca. 1830–32, medium Woodblock print and source The Met Open Access" },
  "rename": { section: "#rename", use: "Give a reference a name you will search for.", alt: "The Rename dialog for the anonymous Botanical Studies drawing, its name ready to change" },
  "rename-many": { section: "#rename", use: "Number the studies of one life class with the day they were drawn.", alt: "Rename 4 items for four Degas dancer drawings: Enumerate with the pattern dancers-{date:YYYYMMDD}-###, the token chips, the Date row set to This date, 2 November 2026, and the preview from dancers-20261102-001" },
  "thumbnail": { section: "#custom-thumbnail", use: "Choose the picture a card shows: a detail that tells two studies apart.", alt: "The thumbnail choice for de Gheyn's two studies of a saddled horse: upload a picture, choose one from the library, or keep the original" },
  "take-out": { section: "#taking-files-out", use: "Take a reference out of the app: download it or export it.", alt: "The right-click menu of Van Gogh's Wheat Field with Cypresses in the Library: its download, export and other commands" },

  // canvast tools
  "tools-menu": { section: "#canvast-tools-without-the-app", use: "Open your hidden items, hide files or share a folder on any computer with Node.js, without the app.", alt: "A terminal running node canvast-tools.mjs: its numbered menu in plain words" },

  // The desktop app
  "desktop": { section: "#the-workspace-folder-desktop-app", use: "Keep a project as a plain folder that any sync or backup tool can carry, and switch between projects.", alt: "The desktop app on a workspace folder named Picture book: its References canvas of four prints, and the board and canvas menu with Switch workspace open" },
  "trash": { section: "#deleting-and-trash", use: "Bring back a file deleted by mistake: the workspace folder keeps deleted files in its Trash.", alt: "The Trash in the Library of the desktop app: deleted drawings as cards, one selected with Restore and Delete for good" },
  "sharing": { section: "#sharing-on-the-local-network", use: "Show a project on a tablet on the same network, read-only, without copying it there.", alt: "Settings, Sharing in the desktop app: sharing the workspace on the local network, its address, code and the devices allowed" },
};
