import { describe, expect, it } from "vitest";
import { CODE_LANGUAGES, codeSpans } from "../../src/notes/code-colours";

/** A line that each language colours something in. */
const SAMPLES: Readonly<Record<string, string>> = {
  javascript: "const a = 'x'; // note", typescript: "const a: string = 'x';", html: '<a href="x">y</a>', css: "a { color: red; }", json: '{"a": 1}', python: "def f(): return 'x'",
  java: 'class A { String a = "x"; }', c: 'int main() { return 0; }', cpp: "class A {}; int a = 1;", csharp: 'class A { string a = "x"; }', go: 'func main() { x := "y" }', rust: 'fn main() { let a = "x"; }',
  ruby: "def f; 'x'; end", php: '<?php echo "x"; ?>', swift: 'let a = "x"', kotlin: 'fun main() { val a = "x" }', sql: "SELECT a FROM b WHERE c = 'x';", bash: 'echo "x"', markdown: "# Title", xml: '<a b="c"/>', yaml: "a: 1",
};

describe("colours in a note's code blocks", () => {
  it("colours every language the editor's code block offers, with stretches that fall inside the words", async () => {
    for (const language of Object.keys(SAMPLES)) {
      expect(CODE_LANGUAGES, language).toContain(language);
      const text = SAMPLES[language]!;
      const spans = await codeSpans(text, language);
      expect(spans.length, language).toBeGreaterThan(0);
      for (const s of spans) expect(s.start >= 0 && s.end <= text.length && s.start < s.end, language).toBe(true);
    }
  });

  it("says what each stretch is, by its place in the words; a language it does not know stays plain", async () => {
    const text = "def f(): return 'x'";
    const of = async (group: string): Promise<string[]> => (await codeSpans(text, "python")).filter((s) => s.group === group).map((s) => text.slice(s.start, s.end));
    expect(await of("keyword")).toEqual(["def", "return"]);
    expect(await of("string")).toEqual(["'x'"]);
    expect(await codeSpans(text, "no-such-language")).toEqual([]);
  });
});
