// The toolbar's default icons (24 × 24, a 2 px stroke in currentColor). A host gives its own with the `icons` option.
export type IconName =
  | "live" | "source" | "preview"
  | "bold" | "italic" | "strike" | "highlight" | "code" | "link"
  | "heading1" | "heading2" | "heading3" | "bulletList" | "orderedList" | "taskList" | "quote" | "callout" | "codeBlock" | "mathBlock" | "table" | "rule"
  | "picture" | "find" | "save" | "clearFormat";

const svg = (body: string): string => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const heading = (n: number): string => svg(`<path d="M4 12h8M4 18V6M12 18V6"/><text x="15" y="19" font-size="10" font-weight="700" fill="currentColor" stroke="none">${n}</text>`);

export const DEFAULT_ICONS: Readonly<Record<IconName, string>> = {
  live: svg('<path d="M12 20h9"/><path d="M16.4 3.6a2 2 0 0 1 2.9 2.9L7 18.8l-4 1 1-4Z"/>'),
  source: svg('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'),
  preview: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  bold: svg('<path d="M6 12h9a4 4 0 0 1 0 8H6V4h8a4 4 0 0 1 0 8"/>'),
  italic: svg('<path d="M19 4h-9M14 20H5M15 4 9 20"/>'),
  strike: svg('<path d="M16 4H9a3 3 0 0 0-2.8 4M14 12a4 4 0 0 1 0 8H6M4 12h16"/>'),
  highlight: svg('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
  code: svg('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  heading1: heading(1),
  heading2: heading(2),
  heading3: heading(3),
  bulletList: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  orderedList: svg('<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
  taskList: svg('<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4M13 6h8M13 12h8M13 18h8"/>'),
  quote: svg('<path d="M3 21c3 0 7-1 7-8V5c0-1.2-.8-2-2-2H4c-1.2 0-2 .8-2 2v6c0 1.2.8 2 2 2h3c0 4-2 6-4 6Z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.2-.8-2-2-2h-4c-1.2 0-2 .8-2 2v6c0 1.2.8 2 2 2h3c0 4-2 6-4 6Z"/>'),
  callout: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 8v4M12 16h.01"/>'),
  mathBlock: svg('<path d="M18 5H7l5 7-5 7h11"/>'),
  clearFormat: svg('<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21"/><path d="M22 21H7M5 11l9 9"/>'),
  codeBlock: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m10 9-3 3 3 3M14 15l3-3-3-3"/>'),
  table: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M12 3v18"/>'),
  rule: svg('<path d="M5 12h14"/>'),
  picture: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>'),
  find: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  save: svg('<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7"/>'),
};
