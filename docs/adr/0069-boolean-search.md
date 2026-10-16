# ADR 0069: AND, OR, XOR and NOT in search

## Status
Accepted (v0.17.0)

## Context
Search joined words with an implicit AND only. Finding "red or blue but not cat" meant several searches.

## Decision
- `src/search/query.ts` parses one query into a tree (`parseQuery`) and evaluates it per item with a term predicate (`evalQuery`). The library search, smart folders and the canvas search (name, tag, bookmark) all use it; each decides only what one term matches.
- Syntax: space, `AND`, `&` = and; `OR`, `|` = or; `XOR`, `^` = exactly one; `NOT`, `!`, leading `-` = not; `( )` group; `"..."` is one phrase. Precedence NOT, AND, XOR, OR. Operator words are upper case, so a lower-case "or" is still a word, and `red-cat` keeps its hyphen.
- An unreadable query (unclosed bracket, missing operand) is never an error: it falls back to every word joined by AND (`Parsed.fallback`).
- In the canvas tag mode a term matches when any of the item's tags contains it, and NOT/XOR apply to the whole tag list.
- Renaming a tag also rewrites `#tag` inside smart-folder searches that use brackets or operators.
- Discoverability: a ? button beside both search boxes (`src/ui/search-help.ts`) opens a card listing every operator with an example; clicking an example fills the box and searches. Nobody has to read the docs.
- The canvas search opens on **All**: a word matches an item's name, its group's name, its kind or any of its tags, and a matching bookmark follows the items; `#word` matches tags only. `/`, `#` and `@` (or the tabs) narrow it to names, tags or bookmarks. Backspace on an empty box goes back to All.

## Consequences
Old saved searches keep their meaning (plain words are still AND). A phrase in quotes now matches as one piece.
