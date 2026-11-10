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
  "flip": { section: "#pictures", use: "Mirror a drawing to see its proportions with fresh eyes.", alt: "De Gheyn's two studies of a saddled horse beside a mirrored copy, labelled original and flipped, the Flip buttons in the bar above" },
  "corners": { section: "#pictures", use: "Give a print rounded corners and a thin outline, as a card on a mood board.", alt: "Hokusai's Mystical Bird with rounded corners and a cream outline, the corner radius in the bar above" },
  "adjust-values": { section: "#adjust", use: "Make a value study: the same painting in grey with more contrast, to read its light and dark masses.", alt: "Van Gogh's Wheat Field with Cypresses beside a greyscale copy with high contrast, labelled colour and values, the Adjust panel open" },
  "adjust-shadow": { section: "#adjust", use: "Give prints a soft drop shadow so they read as paper laid on a table.", alt: "Three Hokusai prints with a soft drop shadow, the shadow settings of the Adjust panel open" },
  "sheets": { section: "#sheets", use: "Plan the shots of a scene on sheets of a film ratio: each sheet cuts its picture to 16:9.", alt: "Three 16:9 sheets named Shot 1 to Shot 3 holding three landscape drawings, the Ratio menu open" },
  "auto-layout": { section: "#auto-layout", use: "Let a sheet lay its pictures out in a grid that stays tidy as you add more.", alt: "The horse board's sheet selected, its pictures in a three-column grid, the auto layout controls in the bar above" },
  "arrange": { section: "#arranging-and-snapping", use: "Put a loose pile of studies into a grid in one step.", alt: "Four Degas dancer drawings scattered, with the Arrange menu open on its grid choices" },
  "align": { section: "#arranging-and-snapping", use: "Line studies up along their bottom edges.", alt: "Three Degas dancers aligned on their bottom edges, the Align menu open" },
  "layers": { section: "#layers", use: "Keep a master study in groups: the reference locked, the construction and the line of action on their own.", alt: "A study over Delacroix's horse: construction ovals and a line of action drawn on it, the Layers panel listing the groups, the reference locked" },
  "reveal": { section: "#reveal-and-the-ctrl-list", use: "Find and pick a print buried under others in a pile.", alt: "A pile of Hokusai prints with Ctrl held: the list of what lies under the pointer, one print outlined", pointer: true },
  "canvas-tags": { section: "#tags-on-the-canvas", use: "Tag the studies on a canvas by what they teach, and find them again.", alt: "Studies tagged gesture and anatomy, the Tags panel listing the tags with their counts" },

  // Drawing and vector editing
  "pen": { section: "#pen", use: "Find the gesture: draw a line of action over each figure, from the head through the weight to the foot that carries it.", alt: "Three Degas dancers with a red line of action drawn over each with the Pen, the Pen's kinds in the bar above" },
  "shape-kinds": { section: "#shapes", use: "Block in a composition as flat value shapes before painting.", alt: "A landscape thumbnail made of shapes in four greys: sky, sun, two hills and a near ground, the Shape tool's kinds in the bar above" },
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
  "balloon-kinds": { section: "#speech-balloons", use: "Pick the balloon that fits the line: speech, thought, a shout or a caption box.", alt: "Four lettered balloons: a speech balloon, a thought cloud with bubbles, a burst shouting Look out! and a yellow caption box, the Preset choice of the Speech balloon panel" },
  "balloons": { section: "#speech-balloons", use: "Point a balloon's tail at the speaker.", alt: "A speech balloon over Le Prince's peasants fording a stream, its tail pointing at them, selected with its handles, the Speech balloon panel open" },
  "text": { section: "#text", use: "Set a cover's type: a title and a subtitle in fonts of your own.", alt: "Hokusai's Great Wave with the title THE CROSSING being set in Bangers above it and a subtitle in Cormorant Garamond italic, the text bar above" },

  // The Library
  "library": { section: "#the-library", use: "Keep every reference once, in folders by subject, and see a print's details beside the grid.", alt: "The Library in the light theme: folders Japanese prints, Horses, Dancers, Landscapes and Botanical in the sidebar, the gallery of prints and drawings, Hokusai's Great Wave selected with its tags and folder in the details" },
  "library-list": { section: "#the-gallery", use: "Read a collection as a list, with each file's size, pixels and tags.", alt: "The Library as a list: name, pixels, type, size and tags of each drawing and print, Rosa Bonheur's study selected" },
  "sidebar": { section: "#folders-and-tags", use: "Pin the folder you work from most, nest tags by subject and keep the searches you repeat.", alt: "The Library's sidebar: Japanese prints pinned first among the folders, tags nested as animal/horse, animal/bird and figure/dance, and two saved searches" },
  "search": { section: "#search", use: "Find all the figure and animal drawings in a tall format with one search.", alt: "The search #drawing (#figure OR #animal) orientation:portrait finding Degas's standing dancers, with the chip of what is filtered" },
  "search-help": { section: "#search", use: "Look up the search words while typing.", alt: "The search help card: each operator and keyword with an example" },
  "viewer-grey": { section: "#the-viewer", use: "Check a print's values: see it in greyscale in the viewer.", alt: "Hokusai's Great Wave in the viewer, shown in greyscale, the strip of the folder's other prints below" },
  "organize": { section: "#organize", use: "File a reference and tag it in one dialog.", alt: "The Organize dialog for Mary Delany's Botanical Study: the folders as a tree with Botanical chosen, and the Tags tab" },
  "bulk": { section: "#selecting-and-details", use: "Tag or file several drawings at once.", alt: "Four Degas dancer drawings selected, the details panel listing their tags with how many have each, their folder, and what can be done to all four" },
  "similar": { section: "#similar-images", use: "Find a second scan of the same print hiding in the collection.", alt: "Similar images: Hokusai's Great Wave beside a smaller, warmer second scan of it" },
  "art-files": { section: "#art-files", use: "Keep paintings in progress from other apps beside their references: their picture shows without opening them.", alt: "A Krita file and an OpenRaster file in the Library, each showing the picture it keeps, the Krita painting-over of a Degas dancer selected" },
  "font": { section: "#fonts", use: "Keep the fonts of a project with its pictures and see each one set.", alt: "The Bangers font selected in the Library: its card in its own letters and a sample in the details" },
};
