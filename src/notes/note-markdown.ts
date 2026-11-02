import { helper } from "suneditor";

/** A markdown note as HTML, with the notes editor's own converter (SunEditor's GFM reader). Imported lazily where Node must not load it. */
export const markdownHtml = (text: string): string => helper.markdown.markdownToHtml(text, "P");
