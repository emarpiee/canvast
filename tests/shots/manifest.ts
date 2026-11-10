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
};
