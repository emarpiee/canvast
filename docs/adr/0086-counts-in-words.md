# ADR 0086: Counts read right for one and for many

## Status
Accepted (v0.17.0)

## Decision
Text with a count never says "item(s)". `doc/plural.ts` has `plural(n, "item")` ("1 item", "3 items"; `plural(n, "canvas", "canvases")` for an irregular form), `be(n)` and `were(n)`. Wording that can be about one or many is made general ("Select the items with this tag"), and sentences agree with the count ("1 original is still missing", "2 originals are still missing"). Every count in the interface goes through these.
