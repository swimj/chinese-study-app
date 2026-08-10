# Reflection remediation policy working notes

Status: active working note

Purpose: preserve the emerging policy discussion for SWI-25. This is not a
canonical product contract, a prompt specification, or an accepted handle
inventory. It records hypotheses to test against real reflection cases before
they are promoted elsewhere.

## Problem framing

Reflection currently combines two distinct problems:

```text
session evidence
  -> decide what remediation, if any, is appropriate
  -> realize that remediation as learner-facing explanation and/or content
```

The first is an intervention-policy and learning-mechanism judgment. The
second is a prompting/content-authoring problem. Evaluating them together
makes it difficult to tell whether weak output reflects a wrong intervention,
an unavailable but better intervention, or weak drafting of an otherwise good
intervention.

## Emerging policy hypotheses

### 1. Train transferable capability, not reverse-engineered word mastery

The app should help a learner spend solo time productively building a foundation
that increases the value of broader language practice: reading, conversation,
media, classes, and AI interaction. It is not intended to supply all language
growth itself.

A semantic distinction may be useful evidence or explanation without earning a
durable drill. A reflection intervention should earn itself by plausibly
improving a capability that transfers beyond a curated exercise.

### 2. Natural-circumstance production is the preferred cue direction

The new production-cue model supports a more useful target than increasingly
precise definition engineering: fair retrieval from a natural circumstance,
communicative purpose, register, or minimal context. A cue should make the
intended production capability clearer without becoming a bespoke
dictionary-triangulation puzzle.

**Contrast-independence test:** a non-contrast cue must be justified by the
target word's own useful, natural use and should remain substantially the same
regardless of which near answer happened to trigger reflection. A confusion can
surface a cue defect; it must not become hidden pair-specific content. If a cue
needs to encode the difference from a particular alternative, that is contrast
work and should meet the higher contrast bar.

For a word with several useful natural senses, begin with one high-value,
natural sense rather than an encyclopedic definition. Later cues can build a
small repertoire of ordinary collocations and circumstances. This is meant to
develop use-feel, not expose the learner to a systematic decision procedure.

### 3. Contrast must earn itself through a transfer mechanism

Contrast practice is not rejected categorically. It is a plausible response
when a real, learner-relevant interference axis can be exercised in natural
contexts, for example form/sound similarity, grammar role, collocation,
register/domain, intensity, or ordinary usage distinction.

Before proposing contrast, ask:

> Would succeeding on this exercise make the learner more likely to choose
> naturally in recognizably similar real situations, rather than merely
> distinguish a curated pair after studying an explanation?

If not, the distinction may merit explanation but not durable contrast content.

### 4. Handles must fit the mechanism, not merely be available

The reflection model should reason in this order:

```text
What capability or exercise defect did this event reveal?
  -> What learning mechanism would plausibly help?
    -> Does an existing handle faithfully provide that mechanism?
```

The available handle vocabulary should not pull the model toward a flawed
action. If no handle faithfully implements a warranted mechanism, preserve an
observation, explanation, or bounded unsupported direction rather than
forcing the nearest operation.

### 5. No durable action is a successful reflection outcome

Ordinary retrieval noise, weak evidence, low expected transfer, or a remedy
better supplied by broader language life may all justify leaving normal
scheduling unchanged. Learner explanation can still be valuable. Reflection
should not treat an empty proposal list as incomplete work.

## Current handle reading

| Direction | When it plausibly earns action | Current fit |
| --- | --- | --- |
| No durable action | Ordinary lapse, weak evidence, or no credible transfer mechanism | Supported |
| Learner explanation | Insight is useful but durable content would be artificial or premature | Supported, but easy to underuse |
| Natural-circumstance cue | A useful production capability is elicited through an unfair or unnatural cue | Stronger after V2 cue work |
| Contrast practice | A stable, transferable interference axis can be exercised in natural contexts | Existing, but should be selective |
| Outside-app learning direction | The need is real but belongs in broader exposure or an unbuilt exercise mode | Conceptually valid; current `unhandledNeed` is a weak vehicle |

The present V3 model-facing contract exposes concrete executable operations
more strongly than abstract unmet mechanisms. It is therefore unsurprising if
the model rarely produces useful unhandled needs; this should not be treated as
evidence that no such needs exist.

For grammatical glue and feel-heavy words, learner-facing remediation should
prefer simple examples and instinct-building circumstances over an elaborate
explicit rule. The system may reason about grammar internally, but should not
turn that analysis into a brittle decision tree for the learner.

## Recommendation posture

Where a non-contrived production capability is plausible, recommend the
corresponding natural-circumstance cue directly. Where it is not plausible,
recommend no production action (or a different supported direction) directly.
Do not surface "whether the word is worth practising" as an unresolved choice
in ordinary case analysis; the learner can still accept or reject a proposal.

## Prompt-strategy implication

Prompt tuning should not begin by optimizing prose alone. First separate:

1. remediation adjudication: correct diagnosis, whether action is warranted,
   desired learning mechanism, scope, and proportionality; and
2. remediation realization: grounded explanation, cue text, contrast content,
   or other typed operation payload.

The superseded V0 prompt is evidence for candidate policy guidance, not a
production template. The current V3 prompt remains the live baseline.

## Provisional case readings

These are early human-and-agent readings of real dogfood cases. They are
examples for later calibration, not accepted universal classifications or
ready-made production content.

### 裁缝 / 剪裁 / “to make an item of clothing; to tailor”

**Production-task fit:** cue-needed. Isolated production remains plausible,
but the gloss is broad enough to admit the cutting stage alone.

**Event reading:** `剪裁` tracks a real component of the target activity.
`裁缝` concerns cutting and sewing cloth into clothing (and can name the
person), while `剪裁` is cutting to a size or pattern. This is not arbitrary
retrieval noise.

**Provisional remediation:** a concise cue anchor distinguishing tailoring or
making clothing through cutting *and sewing* from merely cutting material to a
pattern. One event does not yet earn durable contrast practice.

### 预期 / 预料 / “to expect; to anticipate”

**Production-task fit:** context-required, and therefore a cue-needed subtype.
The bare English verb gloss does not identify whether the desired Chinese use
is an expected outcome/target or the act of forecasting.

**Event reading:** `预期` commonly names a prior expectation, especially in
frames such as an outcome meeting or failing to meet an expected target;
`预料` is the act or result of foreseeing/anticipating. The response is
linguistically plausible under the bare English cue.

**Provisional remediation:** a short natural frame or minimal context should
be tried before contrast. For example, a cue can identify an expected outcome
or target rather than a person's act of predicting. Do not classify the miss
as ordinary retrieval noise until that task form has been tested.

### 变换 / 转换 / “to transform; to convert; to vary; to alternate; a transformation”

**Production-task fit:** the supplied all-senses gloss is unfit for an
exact-answer production task. It collapses multiple possible change relations
and grammatical uses into one English prompt.

**Event reading:** `转换` is a close, linguistically plausible response; the
reference dictionary lists it as similar to `变换`. The target can be used for
changing forms, arrangements, or environments, while `转换` often fits a
switch or conversion between states, topics, formats, or forms. The bare cue
does not select a distinction strongly enough to treat this as ordinary
retrieval failure.

**Provisional remediation:** prefer a replacement cue anchored to one useful,
natural target sense or frame. Do not preserve the generic cue merely by
accepting many answers: that would retain an unhelpful exercise. Contrast may
become useful only with evidence that this specific change-relation boundary
recurs and a natural context can teach it.

### 鄙视 / 轻视 / “to despise; to disdain; to look down upon”

**Production-task fit:** provisionally direct-gloss fit. “Despise” and
“disdain” identify a stronger contemptuous judgment than the broadest readings
of `轻视`, even though the words substantially overlap.

**Event reading:** `轻视` is a genuine near response, not arbitrary noise. It
can mean treating a person, thing, risk, or issue as unimportant or beneath
serious regard; `鄙视` more strongly conveys looking down on someone or
something as low or unworthy. The gloss has some soft ambiguity through “look
down upon,” but it is materially more focused than the earlier all-senses
examples.

**Provisional remediation:** no durable content action from one event. It is
reasonable to retain the default task and treat this as a near-synonym
retrieval substitution unless recurrence or learner evidence shows that the
degree/stance boundary is persistently important. Do not create contrast
content merely because a fine semantic distinction can be stated.

### 倔强 / 固执 / “stubborn; obstinate; unbending”

**Production-task fit:** cue-needed. The target remains a plausible useful
production word, but the bare English adjectives do not strongly identify the
target's particular stance.

**Event reading:** `固执` is a genuine near response. `倔强` foregrounds a
strong-willed refusal to yield or bend under pressure and can describe a
person's temperament; `固执` more readily foregrounds inflexible persistence
in one's own view or course. “Unbending” leans toward `倔强`, but “stubborn”
and “obstinate” leave the response plausible.

**Provisional remediation:** try a concise circumstance or anchor about not
yielding despite pressure, rather than a general synonym contrast. One event
does not show that the distinction deserves durable contrast practice.

### 误会 / 误解 / “to misunderstand; to mistake; misunderstanding”

**Production-task fit:** context-required. The supplied English verb and noun
glosses deliberately describe a broad semantic space that both words can
occupy.

**Event reading:** `误会` and `误解` are dictionary-level near synonyms. A
useful provisional distinction is that `误会` naturally frames an interpersonal
misunderstanding or the incident arising between people, while `误解` more
readily frames a mistaken interpretation or judgment of words, facts, policy,
or a situation. Under the bare cue, `误解` is fully plausible.

**Provisional remediation:** use a natural relational circumstance for
`误会`, or a cognitive/interpretive circumstance for `误解`, before treating
either as an exact isolated-production target. Do not preserve the generic cue
simply by accepting both answers. This pair may become a legitimate contrast
candidate if repeated evidence shows that the interpersonal-versus-interpretive
frame is a useful learner boundary.

### 应该 / 应当 / “ought to; should; must”

**Production-task fit:** isolated production is unfit. A bare English modal
does not identify whether the intended capability is everyday advice,
probability/inference, a normative obligation, or a formal/legal requirement.

**Event reading:** `应当` is fully plausible under the supplied gloss. In
ordinary normative use the two words overlap substantially; `应该` also has a
common epistemic/probability use, while `应当` more readily appears in formal
or rule-like statements and can carry a must-like force in legal text. The
generic prompt therefore cannot fairly require one exact answer.

**Provisional remediation:** do not treat the response as a production lapse.
If either word is to be produced, use a sentence-level natural circumstance:
for example, everyday inference or advice for `应该`, versus a formal norm or
requirement for `应当`. This is a strong example of context-based production
rather than isolated gloss recall; contrast may be worthwhile only if the
learner later needs and repeatedly misses the modal/register boundary.

### 医生 / 大夫 / “doctor”

**Production-task fit:** valid multi-answer cue, but not an exact-target-only
cue. In its everyday medical pronunciation and sense, `大夫` means a doctor;
`医生` is an ordinary synonym. The response is therefore correct, rather than
a near miss that calls for remediation.

**Policy refinement:** distinguish a broad cue that genuinely describes a
useful equivalence class from one that hides the intended capability. Here,
accepting either known word is an honest result for the basic referential task
“doctor.” This does not teach a register, regional, or form-of-address
distinction, but that is a separate learning objective requiring its own
natural circumstance. It should not be manufactured from this event as a
contrast exercise.

**Provisional remediation:** accept the response with no durable action. If
the product later wants target-specific command, introduce a separate cue for
that actual distinction rather than converting this generic cue into a false
exact-answer test.

### 与 / 跟 / multi-sense dictionary gloss

**Production-task fit:** context-required, and likely isolated production is
unfit for the supplied task. The gloss combines coordination, comitative and
comparative preposition uses, plus literary verb senses. It does not specify a
sentence function, register, or whether the target's formal written quality is
the capability to practise.

**Event reading:** `跟` is a good everyday answer for several of the prompt's
linking and participant senses. `与` can cover parallel coordination and
interaction/comparison in more formal written language, but the supplied gloss
also introduces literary "give/bestow" senses that `跟` cannot answer. This is
not one recoverable lexical-retrieval question, and the answer cannot be read
as an ordinary lapse.

**Provisional remediation:** do not create a generic contrast or force a
target-only `与` cue on current evidence. Even a minimal frame such as
"她的穿着__身份不符" naturally permits `跟` as well as formal
`与`; the basic relationship can instead be a valid equivalence-class cue with
both answers accepted. Revisit target-specific `与` only if a distinct,
useful capability emerges.

### 筹备 / 预备 / “preparations; to get ready for sth”

**Production-task fit:** cue-needed. `筹备` has a coherent productive use for
organizing and planning an undertaking ahead of time, but the English cue also
fairly elicits the broader `预备` (or `准备`) for getting people or things
ready.

**Event reading:** `预备` is a legitimate near response, not evidence of a
simple retrieval lapse. The useful distinction is not a finely carved
synonym-pair rule: `筹备` is most natural when the learner is arranging a
project, opening, event, or other undertaking; `预备` can cover general
advance readiness.

**Provisional remediation:** use a short circumstance such as "organize an
event or opening in advance." Do not make a durable contrast from one
response; first establish whether the
organizational-planning cue improves fair recall and feels useful in practice.

### 有所 / 有些 / “somewhat; to some extent”

**Production-task fit:** context-required. `有所` is not a free-standing
degree adverb: it normally introduces an implicit or explicit object before a
verb or adjective, as in `有所不同` or `有所改善`, and has a somewhat formal
written quality. `有些` can mean "somewhat" before an adjective or verb, but
can also quantify an unspecified set of things or people.

**Event reading:** `有些` is a plausible answer to the English degree gloss,
while `有所` would need a following predicate to be a complete natural task.
The prompt therefore elides the very syntactic frame that distinguishes the
words; it cannot support target-only production.

**Provisional remediation:** do not read this as an ordinary lapse or create a
bare synonym contrast. Use a formal written circumstance with its predicate
(for example, "show some improvement" or
"be somewhat different"). Use a separate ordinary degree cue for `有些`.

### 有些 / 稍微 / “some; somewhat; rather; a bit”

**Production-task fit:** context-required. The cue combines `有些` as an
unspecified quantity ("some") with its degree use ("somewhat"), whereas
`稍微` is specifically a small degree or amount. It therefore tests two
different grammatical capabilities under one English list.

**Event reading:** `稍微` is fully plausible for the degree portion of the
gloss and is not a retrieval error. It cannot, however, express the ordinary
quantifier use of `有些`, so accepting it would be right only for a deliberately
degree-specific task—not for the current all-senses prompt.

**Provisional remediation:** split the capabilities. Give `有些` a real
quantifier or modest-degree circumstance, and give `稍微` a small-adjustment
or slight-degree circumstance. Do not derive a contrast rule from this event.

### 斗 (dòu) / 拼 / multi-sense dictionary gloss

**Production-task fit:** isolated production is unfit. This is additionally a
lexical-unit problem: the entry is a character/morpheme with distinct senses
that are normally realized through compounds, rather than one everyday
stand-alone production word. The prompt mixes fighting/contending, public
denunciation, and assembling senses.

**Event reading:** `拼` is plausible for both striving/contending and putting
things together, though it cannot cover every listed sense. The target itself
can mean to fight, compete, or assemble in the cited dictionary, so the gloss
does not identify which compound-level capability is intended. This is not an
ordinary retrieval lapse, nor evidence that the learner needs a generic
`斗`-versus-`拼` contrast.

**Provisional remediation:** no cue patch at the bare-character level. If a
specific capability matters, introduce it through a natural compound and
circumstance—such as `鬥爭`/`打鬥` for conflict, or `拼湊` for assembling—and
only then assess whether a production exercise is useful.

### 总体 / 全 / multi-sense dictionary gloss

**Production-task fit:** context-required. `总体` means the whole or overall
view and is naturally used in analytical, planning, or statistical contexts.
The prompt merges this with `全` as a determiner ("entire"), adverb
("completely"), and possible statistical-total reading.

**Event reading:** `全` is a plausible answer to several English glosses, but
not a target-specific response for an overall/whole-system perspective. The
bare list does not distinguish "consider the overall development" from
"completely finish" or "the entire group." This is a cue failure, not an
ordinary lapse.

**Provisional remediation:** use a natural analytical frame for `总体`, such
as "the company's overall development" or "assess the situation as a whole."
Keep `全` in separate determiner/adverb exercises. Do not create a generic
contrast from this one event.

### 适用 / 实用 / “to be applicable”

**Production-task fit:** direct-gloss fit. `适用` is an appropriate answer to
"applicable," especially where something applies to a person, age group,
case, rule, or condition. `实用` instead means practical or useful for actual
use.

**Event reading:** this is a real lexical substitution, plausibly supported by
the near-identical form and sound rather than an ambiguous English cue. It is
the clearest case so far where the default retrieval task is fair and the
response identifies a genuine distinction.

**Provisional remediation:** retain the default task. A later cue could make
the target's natural frame more vivid (for example, "applicable to children
under six"), but that is enrichment rather than a repair required for
fairness. Do not yet install a durable contrast: one event establishes an
error, not that explicit contrast practice will transfer better than ordinary
review.

### 凡是 / 每个 / “each and every; every; all; any”

**Production-task fit:** context-required. `每个` distributes over individual
countable nouns (each person, every item). `凡是` introduces every member of a
described class or condition and naturally leads into a larger construction,
often with a following `都` clause.

**Event reading:** `每个` is a reasonable response to much of the English
quantifier list. It does not demonstrate command of `凡是`'s class/condition
frame, but the prompt does not reveal that frame either. This is a cue failure,
not an ordinary retrieval lapse.

**Provisional remediation:** use a natural generalization, such as "anything
he does not know, he asks about clearly," rather than a bare "every" cue.
Keep `每个` for individual countable-noun contexts. Do not create a contrast
cluster from this event alone.

### 品质 / 品 / multi-sense quality gloss

**Production-task fit:** cue-needed, tending toward context-required. `品质`
is a complete word for the quality of a product or service; the character `品`
has related meanings (type, grade, moral character, judging or tasting) but
does not independently supply the target expression for product/service
quality.

**Event reading:** the response shows a related semantic root, not a valid
target-level production answer. The gloss nevertheless blends personal
character with product/service quality and other English "quality" readings,
which can also invite terms such as `品格`, `素质`, or `质量`. It is therefore
not enough evidence to call this a simple missing-character lapse.

**Provisional remediation:** use a concrete product/service frame—"the quality
of a product affects sales"—if `品质` is intended. Keep character-related
vocabulary in a separate task. Do not make a `品质` versus `品` contrast;
instead, ensure the exercise asks for a complete usable word.

### 集体 / 团体 / multi-role collective gloss

**Production-task fit:** context-required. `团体` is an organization or group
of people with a common purpose. `集体` is a whole made from many individuals
and naturally modifies or frames collective action, decision-making, or work.
The English list mixes those noun and action-level roles.

**Event reading:** `团体` is a good answer to "a group" or "a team," but not
necessarily to collective decision or joint effort. The target's dictionary
example, `集体创作`, points to the collective-action capability that the bare
gloss hides. This is not an ordinary lapse.

**Provisional remediation:** use a circumstance such as "make the decision as
a group" or "collective creation" for `集体`; use `团体` for a
group/organization as a noun. No durable contrast follows from this
single broad-cue response.

## Candidate mini-spike sequence

1. Collect a small set of real or sanitized cases.
2. For each, record a human judgment of the desired capability, plausible
   learning mechanism, and whether any app action is warranted.
3. Evaluate V3 separately on remediation adjudication and content realization.
4. Test a few coherent prompt variants while holding bundle, model,
   schema/validation, and provider configuration constant.
5. Consider a two-pass or specialist content-authoring call only if the
   diagnosis/remediation boundary proves stable while drafting remains weak.

## Open questions

- Which remediation directions deserve first-class representation beyond the
  current handle set, if any?
- When is an explanation sufficient versus an `unhandledNeed` useful?
- What minimum evidence is needed before contrast earns a durable intervention?
- How should natural-circumstance cues be evaluated for fairness and transfer?
- Is the desired improvement primarily better remediation choice, richer
  learner-facing explanation, more natural exercise drafting, or all three?
- Should a temporary research-only remediation brief be introduced to evaluate
  adjudication separately from authoring before any production schema change?
