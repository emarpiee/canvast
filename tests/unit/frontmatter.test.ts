import { describe, expect, it } from "vitest";
import { metaOfProps, propsOfMeta, splitFrontmatter, withFrontmatter } from "../../src/notes/frontmatter";

const NOTE = `---
title: Plan
tags:
  - design
  - "#todo"
aliases: [Plan A, "Plan: B"]
author: Ana
rating: 4
done: true
created: 2026-11-02
description: The plan for the cover
nested:
  a: 1
  b: 2
poem: |
  two
  lines
---
# Plan

Body.
`;

describe("note properties (YAML frontmatter)", () => {
  it("reads Obsidian's properties and keeps what it does not understand as written", () => {
    const { props, body } = splitFrontmatter(NOTE);
    expect(body).toBe("# Plan\n\nBody.\n");
    expect(metaOfProps(props!)).toEqual({
      tags: ["design", "todo"],
      note: "The plan for the cover",
      fields: [
        { key: "title", value: "Plan" },
        { key: "aliases", value: "Plan A, Plan: B" },
        { key: "author", value: "Ana" },
        { key: "rating", value: "4" },
        { key: "done", value: "true" },
        { key: "created", value: "2026-11-02" },
      ],
    });
    // Unchanged, it writes back to the same properties (lists as lists, the nested map and the block as they were).
    const again = withFrontmatter(body, propsOfMeta(props!, metaOfProps(props!)));
    expect(splitFrontmatter(again).props).toEqual(props);
    expect(again).toContain("nested:\n  a: 1\n  b: 2\npoem: |\n  two\n  lines\n");
  });

  it("writes the item's changes: keys keep their place, gone ones go, new ones come last, quoted where YAML needs it", () => {
    const { props, body } = splitFrontmatter(NOTE);
    const meta = metaOfProps(props!);
    const out = withFrontmatter(body, propsOfMeta(props!, { tags: ["design"], note: "", fields: [...meta.fields.filter((f) => f.key !== "author"), { key: "source", value: "https://x.y/z: a #b" }] }));
    expect(out).toContain("tags:\n  - design\n");
    expect(out).not.toContain("author:");
    expect(out).not.toContain("description:");
    expect(out).toMatch(/source: "https:\/\/x\.y\/z: a #b"\n---\n# Plan/);
    expect(metaOfProps(splitFrontmatter(out).props!).fields.at(-1)).toEqual({ key: "source", value: "https://x.y/z: a #b" });
  });

  it("a note without properties has none; one is made when the item has some", () => {
    expect(splitFrontmatter("# Just text\n---\nmore").props).toBeNull();
    expect(withFrontmatter("Body", propsOfMeta([], { tags: ["a b"], note: "Hi", fields: [{ key: "k", value: "" }] }))).toBe('---\ntags:\n  - a b\ndescription: Hi\nk:\n---\nBody');
    expect(withFrontmatter("Body", [])).toBe("Body");
  });
});

describe("rich text notes' properties", () => {
  it("are the head's <meta>, written and read back, the rest of the file as it was", async () => {
    const { richNoteFile } = await import("../../src/notes/note-file");
    const { richMeta, withRichMeta, fileMeta, withFileMeta } = await import("../../src/notes/frontmatter");
    const file = richNoteFile("Plan", '<p style="text-align:center">Hi</p>');
    expect(richMeta(file)).toBeNull();
    const meta = { tags: ["design", "to do"], note: 'A "plan" <b>', fields: [{ key: "author", value: "Ana & Bo" }] };
    const out = withRichMeta(file, meta);
    expect(richMeta(out)).toEqual(meta);
    expect(out).toContain('<meta name="generator" content="canvast">');
    expect(out).toContain('<p style="text-align:center">Hi</p>');
    expect(richMeta(withRichMeta(out, { tags: [], note: "", fields: [] }))).toBeNull();
    expect(fileMeta("txt", "tags: x")).toBeNull();
    expect(withFileMeta("txt", "plain", meta)).toBe("plain");
    expect(fileMeta("md", withFileMeta("md", "# T\n", meta))).toEqual({ ...meta, inline: [] });
  });
});

describe("#tags in a note's words", () => {
  it("are read as Obsidian reads them, and stay in the words when the YAML is written", async () => {
    const { inlineTags, fileMeta, withFileMeta, splitFrontmatter } = await import("../../src/notes/frontmatter");
    const body = "# Heading\n\nA #design note, #todo/later, #2026 not, issue#3 not, http://x.y/#part not, `#code` not.\n\n```\n#fenced\n```\n#Design again, #café-é.\n";
    expect(inlineTags(body)).toEqual(["design", "todo/later", "café-é"]);
    const file = `---\ntags: [print]\n---\n${body}`;
    expect(fileMeta("md", file)!.tags).toEqual(["print", "design", "todo/later", "café-é"]);
    expect(fileMeta("md", body)).toBeNull(); // (no YAML: its #tags are only added, see the session)
    // The item's tags written back: those in the words stay there only.
    const out = withFileMeta("md", file, { tags: ["print", "design", "todo/later", "café-é", "new"], note: "", fields: [] });
    expect(splitFrontmatter(out).props).toMatchObject([{ key: "tags", value: ["print", "new"] }]);
    // Not tags: a link's part. And a tag the YAML lists too stays listed there.
    expect(inlineTags("[[#Heading]], [words](#part), [[Plan#Goals]], (#real)")).toEqual(["real"]);
    expect(withFileMeta("md", "---\ntags: [a, b]\n---\nbody #a", { tags: ["a", "b"], note: "", fields: [] })).toBe("---\ntags: [a, b]\n---\nbody #a");
  });

  it("a save leaves the properties as the file writes them while their values stay the same", async () => {
    const { fileMeta, withFileMeta, splitFrontmatter, withRichMeta } = await import("../../src/notes/frontmatter");
    const save = (t: string): string => withFileMeta("md", t, fileMeta("md", t)!);
    for (const file of [
      '---\naliases:\n  - "Smith, John"\n  - other\n---\nbody',
      "---\n# why this note\n\ntitle: x # a comment\n---\nbody",
      '---\nversion: "1.0"\ndate: "2024-01-01"\naliases: []\ntags:\nstatus:\n---\nbody',
    ]) expect(save(file)).toBe(file);
    // A value changed is written anew; the others stay.
    expect(withFileMeta("md", '---\na: "1"\nb: "2"\n---\nx', { tags: [], note: "", fields: [{ key: "a", value: "1" }, { key: "b", value: "3" }] })).toBe('---\na: "1"\nb: 3\n---\nx');
    // A note that starts with a rule has no properties; its words stay its words.
    expect(splitFrontmatter("---\n\nFirst paragraph\n\n---\n\nSecond")).toEqual({ props: null, body: "---\n\nFirst paragraph\n\n---\n\nSecond" });
    // A `$&` in a value is that text, in a rich text note's head too.
    expect(withRichMeta("<html><head><title>T</title></head><body>B</body></html>", { tags: [], note: "cost $& and $' end", fields: [] })).toContain('content="cost $&amp; and $\' end"');
  });
});
