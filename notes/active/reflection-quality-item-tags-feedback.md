# Reflection quality tracking — dogfood feedback (PR 118)

Running list for [`codex/reflection-quality-item-tags`](https://github.com/swimj/chinese-study-app/pull/118).

## Open

_(none)_

## Done

1. **Saved note looks like a draft** — Committed note displays as static text (`Add note…` when empty); click enters an editor (blur/Enter save, Esc cancel).
2. **Tags too far from accept/dismiss** — Tag chips render inside `ProposalCard` immediately above accept/dismiss (queue + session). No-proposal / learner-request surfaces keep an item-level control.
3. **Quality table grouping & filtering** — Filter by reflection prompt version (default: current `reflection-v7`); group by model+prompt, model, or prompt.
