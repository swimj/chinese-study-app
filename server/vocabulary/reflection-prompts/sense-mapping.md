# Identify the exercise’s intended sense

Read the authored exercise in `sourceContent` with its target word and accepted answers. Determine the intended use, then compare it with the supplied `senses`.

The exercise’s wording and construction establish what it is trying to practice. The dictionary meaning describes the word more broadly. A compact definition or several near-synonymous glosses can express one use; imperfect wording can still have a discernible intended use.

The canonical inventory tracks uses of the exact target expression, including uncommon, literary or technical uses, but excludes meanings realized only through larger compounds or fixed expressions. Distinguish a target functioning in a grammatical construction from a component of a larger lexical item. A compound-only use is outside the inventory's scope, not a missing sense to add. Assess lexical ownership before matching a label, including when an older supplied entry describes the larger expression's meaning.

Return one outcome:

- `single_sense`: the intended use maps to one supplied sense. Return that sense’s reference in `senseIds`.
- `inventory_gap`: the exercise has a discernible single intended use of the exact target, eligible under this inventory scope, that is absent from the supplied inventory. Briefly describe the missing use and return an empty `senseIds` array.
- `unmappable`: the exercise does not establish a defensible single intended use of the exact target, including when its intended meaning belongs only to a larger compound or fixed expression. Briefly explain why and return an empty `senseIds` array.

Worked mapping decisions:
- Target 垂, a cue meaning “hang or droop downward,” with a supplied physical hanging/drooping sense: `single_sense`. A sentence about lowering one's head can map to that sense when it expresses the same physical use; a different object does not by itself establish a missing sense.
- Target 垂, a cue asking for “critically ill” through 病情____, or a cue completing 病情____危: `unmappable`. The intended lexical item is 垂危. The first completion is also malformed with 垂 alone, but retaining 危 in the second does not make the compound's use a target-level sense. Do not report an `inventory_gap` for that compound-only meaning or map it to an older compound-derived entry.
- Target 垂, a cue asking for “set an example” through 垂范, or target 过时 with a use supported only by 过时不候: `unmappable` for the same lexical-boundary reason. If the target itself is the whole larger expression, assess that expression against its own inventory instead.
- Target 有所, “Has improved to some extent” with 情况____改善: map to the supplied sense describing its unspecified-degree contribution. This is a grammatical construction using the target, so dependence on surrounding language does not make it unmappable. If that eligible intended use is absent, return `inventory_gap`.
- Target 泡沫, a clear cue about an inflated housing market, with only a literal soap-bubble sense supplied: `inventory_gap` for the figurative use. Its omission is different from intentionally excluding a component meaning inside a larger word.
- A cue combining unrelated intended meanings without establishing one use: `unmappable`. A short list of near-synonymous glosses for one coherent meaning can still be `single_sense`; do not confuse imperfect wording with multiple senses.

Return only `outcome`, `rationale`, and `senseIds`. Keep the rationale brief and explain the meaning using readable sense labels or descriptions. Copy references exactly from the supplied inventory into `senseIds`.
