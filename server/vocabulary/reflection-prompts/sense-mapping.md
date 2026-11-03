# Identify the exercise’s intended sense

Read the authored exercise in `sourceContent` with its target word and accepted answers. Determine the intended use, then compare it with the supplied `senses`.

The exercise’s wording and construction establish what it is trying to practice. The dictionary meaning describes the word more broadly. A compact definition or several near-synonymous glosses can express one use; imperfect wording can still have a discernible intended use.

Return one outcome:

- `single_sense`: the intended use maps to one supplied sense. Return that sense’s reference in `senseIds`.
- `inventory_gap`: the exercise has a discernible single intended use that is absent from the supplied inventory. Briefly describe the missing use and return an empty `senseIds` array.
- `unmappable`: the exercise does not establish a defensible single intended use. Briefly explain why and return an empty `senseIds` array.

Return only `outcome`, `rationale`, and `senseIds`. Keep the rationale brief and explain the meaning using readable sense labels or descriptions. Copy references exactly from the supplied inventory into `senseIds`.
