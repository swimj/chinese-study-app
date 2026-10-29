Assess the authored single-word exercise first: does it express a discernible single use, bundle distinct uses into a laundry list, or provide no defensible intended content? Only a discernible single use needs an association with the supplied active sense inventory. Supplied senses do not require a sense association in every response. This is an admission decision for future content improvement, not a judgment of whether a learner's historical answer was fair. Use the authored exercise and answer contract; learner reactions must not redefine its intended meaning.

Keep the exercise separate from lexical background. The word's dictionary meaning and sense inventory describe what the word can mean; they are not the authored retrieval task. A laundry list requires distinct uses bundled in the exercise itself. An underspecified sentence can still identify a use through its object, situation, and target word; an empty placeholder for a polysemous word supplies no such evidence. Do not choose a sense or a laundry-list classification solely from background metadata.

Return exactly one outcome:
- single_sense: a defensible intended use maps to one supplied sense. Poor wording or missing direction can still have interpretable intent. Return exactly that sense ID.
- laundry_list: the exercise bundles distinct uses into a gloss list rather than one coherent retrieval task. Return no sense IDs. This routes the old exercise toward replacement by a word-level repertoire; do not map its glosses, require inventory coverage of them, or classify it as inventory_gap because an old gloss is missing. Several near-synonymous glosses describing one use are not a laundry list.
- inventory_gap: the exercise has a defensible single intended use that is absent from the supplied inventory. Explain the apparent gap; do not invent IDs or extend the inventory. Return no sense IDs.
- unmappable: the authored material does not give enough evidence to defensibly determine intended content. Explain the limitation and return no sense IDs. Do not guess just to enable repair.

The supplied inventory contains the word’s attested senses; useful defaults and review coverage are selected separately. Map the authored meaning against the full inventory, including peripheral or deliberately unselected senses. Selection does not establish authored intent, and exclusion does not make an existing linguistic sense absent. Judge a single-use cue against its actual intended content, not every possible meaning in lexical background; do not dismiss a genuinely missing intended use just to permit repair.

Return outcome, rationale, and senseIds. A mapping retained in the authored snapshot is historical evidence to assess, not authority to ignore conflicting authored content. An established intended sense does not supply missing instructions to a learner. For example, a photo-printing cloze targeting enlargement can map to enlargement while still failing to communicate larger versus smaller. This call does not decide that fairness question, repair content, or publish changes.


Explain the authored meaning using the supplied sense labels and descriptions.
Copy its supplied reference into senseIds when a single use maps; the
rationale should explain the language judgment rather than repeat that reference. Mapping establishes authored intent; selected coverage
and its necessity are outside this call's judgment.
