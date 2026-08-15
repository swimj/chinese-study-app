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

## V4 dogfood observations

Capture live-session results here while the prompt is being calibrated. Record
the target, response, served cue, proposals, and the short policy observation;
avoid treating a single case as an accepted universal rule.

### Run log

#### 预期 / 预计 / “市场__下季度销量会增长”

**Observed judgment:** `预计` was classified as a valid or near-valid alternate;
the original cue was judged to overlap and hide a usage difference. The proposed
repair was `这项改革的实际效果没有达到我们的____。`

**Reading:** this is a better, independently natural cue for `预期` as an
expectation or anticipated benchmark. It should not be treated as evidence that
`预期` and `预计` are interchangeable: both can be verbs in the original market
sentence, but `预计` foregrounds estimating/forecasting while `预期` foregrounds
an actor's expectation. The new frame strongly favors `预期` and does not
exercise that verbal use.

**Calibration observation:** accept the repair provisionally if it is a
high-value target use in its own right, not because it reverse-engineers the
`预计` error. Record a future sense-coverage audit: cue repairs for words with
multiple useful productive senses should be reviewed for whether they quietly
drop an existing useful sense, rather than assuming a single repaired cue
preserves the whole production target.

#### 美味 / 美食 / “delicious; delicious food; delicacy”

**Observed judgment:** `美食` was classified as a valid or near-valid alternate;
the original cue was judged overloaded and to hide a usage difference. The
proposed repair was `这家餐馆的招牌菜十分____，大家都想再来一份。`

**Reading:** the repair is independently justified, not hidden contrast. It
asks for the ordinary adjective `美味` (“delicious”), whereas `美食` is normally
a noun for delicious food/a delicacy. `招牌菜十分美味` is a natural and strongly
selective sentence; `招牌菜十分美食` is not a natural completion.

**Calibration observation:** retain the repair. It does not need to teach a
full `美味`-versus-`美食` decision rule; repeated natural adjective frames can
build the relevant usage feel. The noun capability for `美食` remains separate,
rather than a missing sense of the `美味` task.

#### 单一 / 唯 / “single; only; sole”

**Observed judgment:** `唯` was classified as overlapping with an overloaded
production cue. The proposed repair was `这个方案的内容过于____，缺乏变化。`

**Reading:** this is an ordinary, strongly selective adjective frame for
`单一`: the plan's content is overly uniform and lacks variety. `唯` is a much
more restricted “only” form and cannot naturally complete the predicate. The
original gloss incorrectly bundles a useful adjective capability with a
different “only/sole” capability.

**Calibration observation:** retain the repair as target-centered production
content. It is not a disguised contrast cue; it exposes a common natural use
of `单一`. Do not infer that the separate `唯` capability belongs in this task.

#### 和蔼 / 友善 / “kindly; nice; amiable”

**Proposed repair:** `孩子们都喜欢那位____可亲的老师。`

**Reading:** `和蔼可亲` is a common, natural collocation for a gentle,
approachable teacher; `友善可亲` is not its ordinary form. The cue therefore
gives a useful instance of the target's native usage rather than a
dictionary-triangulation puzzle.

**Calibration observation:** retain provisionally. It is intentionally narrow
and collocational, which can be appropriate for building usage feel, but later
examples should establish whether the cue repertoire reaches beyond this one
fixed phrase.

#### 胜 / 盛 / multi-sense dictionary gloss

**Proposed action:** suppress definition production.

**Reading:** the supplied cue combines victory/defeat, surpassing, being able
to bear a task, scenic beauty, and a Taiwan pronunciation. These are not one
ordinary stand-alone production capability for `胜`; many are realized through
distinct words or compounds such as `胜利`, `战胜`, `胜过`, `胜任`, or `胜景`.
`盛` can plausibly connect to only part of the scenic/abundance territory and
does not make the original task recoverable.

**Calibration observation:** suppression is appropriate. Do not try to repair
the bare character with a single selective cue. If any of its compound-level
capabilities is worth practising later, introduce that complete lexical unit
and a natural circumstance as a separate task.

#### 兴旺 / 鼎盛 / “prosperous; thriving; to prosper; to flourish”

**Proposed repair:** `这个大家庭人丁____，逢年过节总是十分热闹。`

**Reading:** `人丁兴旺` is a conventional, natural expression for a family
with many flourishing descendants. `鼎盛` normally describes something at a
peak or flourishing period, and does not naturally modify `人丁`.

**Calibration observation:** retain. This is a target-centered collocation
worth learning in its own right, rather than an implicitly pair-specific cue.

#### 剪子 / 剪刀 / “clippers; scissors; shears; CL:把”

**Proposed repair:** accept both `剪子` and `剪刀` for a definition cue meaning
“a hand-held tool used to cut paper, cloth, etc.”

**Reading:** this is a genuine equivalence-class task, not a target-only task
that needs a manufactured distinction. Both words are ordinary answers for the
basic referential capability.

**Calibration observation:** preserve the equivalence class, but prefer a
pithy English gloss for this concrete-object cue—for example, “scissors; a
hand-held cutting tool.” English can retrieve an object image and then natural
Mandarin production more directly than a roundabout Chinese definition. The
gloss must still avoid target words or near-answer fragments that disclose the
answer. This is a candidate prompt-policy refinement, not yet a production
contract change.

#### 存款 / 存钱 / “to deposit money; bank savings; bank deposit”

**Proposed repair:** `我把每月工资的一部分存进银行，作为应急的____。`

**Agent explanation:** `存钱` emphasizes the act of saving/depositing money;
`存款` can name money deposited in a bank or bank savings. The proposed cue
practises the noun use.

**Reading:** this is not an equivalence class in the repaired sentence.
`作为应急的存款` naturally means emergency savings/deposits, while `存钱` names
the action and cannot fill that noun slot. The original English gloss bundled
the action and its resulting stored money.

**Calibration observation:** retain. This is another clean grammatical-role
repair; the explanation is concise and learner-useful without requiring a
durable contrast exercise.

### Emerging cue-repertoire policy

A high-frequency collocation can be an excellent first cue, but should not
silently become the whole productive representation of a word that also has
wider ordinary use. When the target supports it, prefer a small repertoire:

- one strong collocational anchor; and
- one or two additional, non-redundant circumstances that exercise a different
  ordinary use, domain, grammatical position, or image.

Each added cue must still earn itself as natural target-centered production;
do not add paraphrased variants merely to increase coverage. Some more open
natural circumstances may fairly admit other words, so target-only tasks still
need a sufficiently selective frame or an honest accepted-answer space.

#### 猛烈 / 迅猛 / “fierce; violent; vigorous; intense”

**Agent reading:** the broad gloss fairly admitted `迅猛`: it foregrounds speed
plus force, while `猛烈` foregrounds force or intensity. The proposed repair
was a weather-impact context: `台风带来的暴雨和大风十分____，街道很快积水。`

**Observation:** the explanation is choppy because it jumps from the diagnosis
straight to a chosen cue. Weather impact is one natural, selective use of
`猛烈`, not established evidence that it is the word's sole or primary scenario.
State the connection explicitly: because the supplied gloss does not select
force/intensity over rapidity, replace it with a high-value circumstance where
the force of wind and rain is what matters. A slightly smoother cue is
`台风来时，风雨十分____，街道很快积水。`

#### 预料 / 预期 / “to forecast; to anticipate; expectation”

**Agent reading:** `预期` is valid for the broad idea of anticipating an
outcome. The proposed multi-answer cue was `事情的发展完全出乎我们的____，大家都
没想到会这样。`, accepting both words.

**Reading:** accept both for this cue. `出乎预料` is an established expression,
and `出乎预期` is also natural when the focus is a prior expectation or expected
benchmark. This is an honest shared circumstance, not a retrieval failure.

**Calibration observation:** do not generalize the accepted set into a claim
that the words are interchangeable everywhere. `预料` more readily foregrounds
foreseeing/predicting; `预期` more readily foregrounds an expectation or
expected outcome, with different productive collocations. Leaving those finer
boundaries for later exposure or a later, independently useful distinction is
appropriate for the current reflection scope.

#### 与 / 参与 / “to take part in”

**Agent proposal:** a minimal context for formal `与会`,
`正式参加会议（书面用语）：____会人员已经入场。`

**Observation:** this is the wrong handle. The useful capability is the
compound `与会`, not bare `与`; the proposed blank merely supplies `会` in the
prompt and expects the target character to complete a compound. That does not
make bare-`与` an honest standalone production task.

**Calibration observation:** suppress definition production for this sense.
This is a regression against the intended lexical-unit rule: when a supplied
sense is mainly realized in a formal compound, do not repair the character's
cue into a hidden compound-completion exercise. A future capability to propose
`与会` as a new word/task could be valuable, but the current handle set cannot
faithfully express it.

#### 区域 / 地段 / “area; region; district”

**Agent proposal:** accept both for `这个商业____交通便利，适合开店。`

**Reading:** that is an honest shared commercial-location circumstance, but
the words have useful distinct lives. `区域` treats a bounded area as a spatial,
administrative, or functional whole; `地段` points to a particular site or
stretch of land, often with a real-estate, access, or location-quality focus.

**Potential cue repertoire:** retain the shared multi-answer cue and add a
target-specific `区域` frame such as `这片____被划为自然保护区。` A correspondingly
strong `地段` frame would be `这套房子面积不大，但____很好，步行五分钟就到地铁站。`

**Calibration observation:** the current repair operation for a `区域` task can
create the shared cue and the target-specific `区域` cue, but cannot create an
independent `地段` task from the same event. The latter is a future
new-word/new-task or cross-task-repair capability, not something to simulate
inside the anchor task.

#### 极了 / 极其 / “extremely; exceedingly”

**Agent reading:** `极其` expresses an extreme degree but normally precedes an
adjective; `极了` follows an adjective or evaluative phrase. The proposed repair
was `这家餐厅的菜好吃____！`

**Reading:** this is a clean, natural target frame: `好吃极了` is ordinary,
whereas `极其` belongs before `好吃` (`极其好吃`) and cannot fill the blank.

**Calibration observation:** retain. The bare English gloss hid a grammatical
placement capability. The explanation connects that diagnosis directly to the
repair without manufacturing a durable contrast exercise.

#### 强制 / 逼 / “to force; to compel; to coerce; forced; compulsory”

**Agent reading:** `逼` can mean forcing someone, more colloquially and with
personal pressure; `强制` is formal enforcement through rules, law, or
authority. The proposed cue was `根据法律规定，企业必须____执行这项标准。`

**Observation:** the policy reading is useful, but the cue is awkward.
`企业必须强制执行` makes the enterprise sound as though it is coercing itself
or another unspecified party. The legal-enforcement frame needs an authority
as agent.

**Better cue:** `对拒不履行判决的人，法院可以依法____执行。`

**Calibration observation:** retain the target-centered formal/legal direction,
but require the generated circumstance to preserve the target's ordinary
argument structure, not merely its register and a familiar collocation.

#### 并且 / 以及 / “and; besides; moreover; furthermore; in addition”

**Agent reading:** `以及` can join nouns or phrases, while `并且` commonly
links an additional clause or action. The proposed repair was
`他不仅完成了任务，____主动帮助了同事。`

**Observation:** the central grammatical diagnosis is good: `以及` does not
fit the additional-action role. But `不仅……并且……` is less conventional than
the familiar `不仅……而且/还……` pattern, and those alternatives make this a weak
target-only recall cue for `并且`.

**Better direction:** use a plain clause-linking example such as `她态度诚恳，
____愿意承担责任。` for exposure to `并且`, while recognizing that `还` can remain
a natural alternate. This is a grammar/usage-feel case where a multi-answer
cue, example exposure, or later contextual selection may be more honest than
forcing exact isolated production.

#### 愚蠢 / 蠢货 / “silly; stupid”

**Agent reading:** `愚蠢` is an adjective for something foolish; `蠢货` is a
noun insult for a stupid person. The proposed cue was
`把这么重要的文件弄丢，真是太____了。`

**Observation:** the sentence excludes the noun insult but remains broadly
open: `粗心`, `糊涂`, or `不小心` can express nearby readings. A syntactic blank
alone does not communicate the independently useful idea that the learner is
being asked to retrieve.

**Better direction:** pair the natural sentence with a brief, target-centered
frame such as `foolish — describing a seriously bad decision or action`, then
`把这么重要的文件弄丢，真是太____了。` The frame is pithy and learner-facing; it
does not name a confusion word or demand a grammar analysis. A later cue can
cover `愚蠢` when describing a person if that is also worth practising.

#### 揣测 / 猜测 / “to guess; to conjecture”

**Agent proposal:** accept both for `在没有证据之前，不要____别人的动机。`

**Reading:** the shared cue is honest. `揣测` often has a more interpretive,
sometimes more speculative focus on another person's motives, intentions, or
inner thoughts; `猜测` is the broader everyday verb for guessing. Yet both are
natural in this admonition, so target-only scoring would be false precision.

**Calibration observation:** fair multi-answer repair should not automatically
end the remediation inquiry. The next prompt iteration should more actively
ask whether the event also warrants a second independently useful,
target-centered cue or example that broadens the learner's feel for the target
(for example, `别总是根据几句话去揣测他的用意。`). That added exposure need not
force an exact contrast or make `猜测` wrong; it can develop a distinct
collocation, register, or interpretive stance. Current handles only repair the
anchor word's task, so a coordinated `猜测` example/task remains a future
cross-task or standalone-exposure capability.

#### 然而 / 不过 / “however; but; yet”

**Agent proposal:** accept both for `他准备得很充分，____还是没能通过考试。`

**Reading:** this is an honest shared cue. Both words can introduce the
contrast between thorough preparation and failing the exam. They are not
universal equivalents: `然而` is more formal and written, and marks a more
deliberate turn; `不过` is more everyday and often a softer qualification. The
cue does not select register or discourse force, so it should not require only
`然而`.

**Calibration observation:** retain the multi-answer resolution while leaving
the broader similarity/difference visible for later exposure. A later formal
written frame can give `然而` its own use-feel, but this event alone does not
earn contrast content.

### Item-level explanation structure

Use the item-level explanation for the learner's overall diagnosis and
resolution, separate from per-proposal rationale. A useful compact sequence is:

1. **Language note:** state the central vocabulary, grammar, register, or
   usage relationship in plain language.
2. **This attempt:** explain how that relationship interacts with the actual
   served cue and submitted answer—why it was fair, unfair, or a real lapse.
3. **Resolution:** say what the app will do (accept, leave scheduling alone,
   repair a cue, or suppress) and what finer distinction, if any, remains for
   later exposure rather than promising false closure.

#### 久 / 长久 / “(of a period of time) long”

**Agent reading:** `长久` fits the broad idea of a long time, but `久` is more
natural in an `等得太久` structure. The proposed repair was
`大家等得太____，终于先回去了。`

**Reading:** retain. `久` naturally completes a verb-plus-degree/result frame
such as `等得太久`; `长久` does not. This is not just an arbitrary collocation:
`长久` more often describes something enduring or long-lasting, as in a
long-lasting friendship or relationship, rather than the amount of time a
single waiting event lasted.

**Calibration observation:** the cue is compact, natural, and sufficiently
selective. Rephrase the learner note away from “master this specific
collocation” toward the usable grammatical idea: use `久` after an action to
say it lasted a long time; use `长久` for something intended or able to endure.

#### 崭新 / 全新 / “brand new”

**Agent proposal:** accept both for `经过全面翻修，这座老车站以____的面貌重新
开放。`

**Reading:** the cue is an honest shared renewed-appearance circumstance, but
the words retain a useful shading. `崭新` means very/extremely new and often
evokes a visibly fresh or gleaming appearance; `全新` means entirely new or
previously unused and also extends readily to abstract innovations or
experiences. The source cue does not need to force that distinction.

**Calibration observation:** retain the shared accepted-answer cue but avoid
letting it erase the target's stronger sense. Add a separate target-centered
frame when the repertoire permits, for example `那辆车虽然开了几年，车身仍然____
发亮。` This makes the vivid fresh-as-new appearance salient without using
`全新` as a negative foil. It is another instance of shared early production
plus later differentiated exposure.

#### 自豪 / 得意 / “proud (of one's achievements etc.)”

**Agent reading:** `自豪` is pride in an achievement, identity, or something
one represents; `得意` more readily carries personal satisfaction or smugness.
The proposed repair was `听到祖国成功发射探测器，他感到非常____。`

**Reading:** `得意` is strongly disfavored here, not merely a close alternate.
The person is reacting to a shared national achievement, so `自豪` expresses
identification and pride; `得意` would recast the reaction as self-satisfied
pleasure and is odd unless a fuller context gives that person a personal stake
or intentionally smug attitude.

**Calibration observation:** retain the sentence, but pair it with a compact
English mood frame if the cue surface permits: `proud — sharing in an
achievement that matters to you`. This preserves learner flow while making the
intended emotional stance salient without naming the confusion word or asking
for a formal semantic analysis.

### Explicit learner-request reflection observations

#### 甲 / correct response / all-senses dictionary gloss

**Served fallback:** one gloss combined the first Heavenly Stem, unspecified
person/thing, list label, armour, shell/carapace, nail, historical examination
rank and administrative unit, and compass point.

**Observed result:** the learner answered `甲` correctly and requested
reflection. The agent proposed `合同中，第一方称为____方，另一方称为乙方。`

**Reading:** the requested review is useful despite the correct answer, but
the explanation should not imply a mistake: the learner successfully recalled
the character from an overloaded familiar fallback, and the review found a
more coherent modern production unit. `甲方`/`乙方` is a natural contract use
and a legitimate first cue for the character's productive repertoire.

**Explanation direction:** say that the response was correct, then explain
that the learner-requested review is improving the exercise—not correcting
performance. For example: `You recalled 甲 correctly. The current glossary
bundles several unrelated meanings, so this review adds a clearer modern use:
the first party in a contract is 甲方.` Do not call the all-senses character
gloss one production task.

#### 天生 / correct response / “nature; disposition; innate; natural”

**Observed result:** a learner-requested review correctly retained the answer
and proposed a `circumstance` cue: `Describe a quality, ability, or tendency as
inborn rather than acquired: ____聪明、____乐观。`

**Reading:** this is a strong use of the circumstance primitive. The English
frame identifies the useful target capability without a dictionary list, while
the two short Mandarin examples (`天生聪明`, `天生乐观`) provide ordinary usage
feel. It is neither a hidden contrast against a particular near answer nor an
overly narrow cloze sentence.

**Calibration observation:** circumstances can be especially valuable for
words expressing an abstract relation, tendency, or stance: use a pithy
meaningful situation in the learner's language plus one or two natural target
examples. Keep the target position visible and avoid filling the answer into
the stimulus itself beyond examples that are intentionally part of the cue.

#### 正版 / “genuine; authorized edition”

**Proposed cue:** `这台电脑里装的都是____软件。`

**Observation:** the sentence supplies a natural noun slot but is
underspecified: both `正版软件` and `盗版软件` are ordinary completions. This is
not a reason to discard the sentence; it needs a compact target-centered frame
to state the intended capability.

**Better cue surface:** `officially licensed software: 这台电脑里装的都是____
软件。` A phrase such as “legally obtained software” would work as well. The
English frame communicates the independently useful idea of authorized
software, while the Chinese sentence supplies the habitual collocation. Avoid
making the learner infer the target solely from a hidden piracy contrast.

#### 当 / multi-sense dictionary gloss

**Served fallback:** one character gloss combined the temporal sense, suitable
or proper, replace/fill a role, regard as, pawn, and a colloquial school-failure
sense.

**Observation:** a generated repair that elicits `当作` is not an honest
bare-`当` repair; it turns a compound-level capability into character
completion. `当你来的时候` does show a real use of `当`, but it is a temporal
connector in a construction and competes with ordinary alternatives such as
`你来的时候`. It is not evidence that this all-senses character has one useful
isolated production task.

**Calibration observation:** suppress the fallback. If productive knowledge
is wanted, create separate complete tasks for independently useful units, for
example `当作` (regard as), `充当` (act as/fill a role), `适当` (appropriate), or
the temporal construction `当……时/当……的时候`—but only once the product can
represent and schedule constructions or compounds as their own targets. Do
not repair the character task by putting part of a target unit in the cue.

### Provider comparison observations

#### 平凡 / 平庸 / “commonplace; ordinary; mediocre”

**GLM:** identified the fallback gloss as conflating `平凡`'s neutral
“ordinary” sense with `平庸`'s negative “mediocre” sense; proposed
`她过着____的生活，每天上班下班，平淡而安稳。`

**Luna:** proposed `她来自一个____的家庭，父母都是普通工人，没有显赫的家世。`
and described it as practising `平凡`'s ordinary/not-prominent use without the
near-synonym overlap.

**Comparison:** both follow the desired policy shape: diagnose a broad gloss,
then select a target-centered neutral-ordinary circumstance rather than making
pair-specific contrast content. GLM's explanation states the semantic problem
more directly. Luna's family/background frame is a plausible additional
dimension, though “high-value use” is prompt-internal evaluative language that
does not improve learner-facing explanation. The two cues could coexist as a
small repertoire if both remain natural and independently useful.

#### 放大 / 增大 / “to enlarge; to magnify”

**Observed result:** the explanation correctly identified `增大` as plausible
under the broad gloss but distinguished general increase from visual
magnification, then proposed a sound photo-related minimal-context repair.
It also emitted `suppress_definition_production` with the self-contradictory
rationale that suppression was inappropriate because `放大` supports useful
direct production and the cue should be repaired.

**Calibration observation:** this is a proposal-consistency failure, not a
lexical judgment problem. When a useful target capability is retained and a
repair is proposed, suppression is redundant and prohibited; the result should
contain only the repair proposal. Add a final prompt/validation-oriented
consistency check for any proposal whose rationale says its own operation is
inappropriate, and for suppress-plus-active-cue-repair on the same word.

#### 提醒 / 提示 / “to remind; to call attention to; to warn of”

**Agent proposal:** accept both for `系统会____用户的密码即将过期。`

**Reading:** this is an honest local overlap. `提醒` foregrounds alerting a
person so that they notice or act; `提示` foregrounds presenting information,
a cue, or a prompt. A system can naturally do either in a password-expiry
notification, depending on whether the speaker emphasizes the user-directed
warning or the displayed notice.

**Divergent exposure:** `请____我明天给客户回电话。` strongly favors `提醒`;
`屏幕上____“密码错误”，请重新输入。` strongly favors `提示`. These examples
make the split usable without declaring the original shared cue invalid.

**Calibration observation:** retain the accepted-answer cue, and preserve
divergence examples as equally valuable follow-on exposure. “Accepted here”
must be expressed as cue-scoped overlap, not a blanket synonym claim.

#### 讨厌 / 烦 / “annoying; to dislike”

**Agent proposal:** accept both for `这个噪音真____，我完全无法集中注意力。`

**Reading:** this is an honest local overlap. `这个噪音真讨厌` and `这个噪音真烦`
both naturally express that the noise is irritating. `讨厌` more readily carries
dislike or aversion toward a person, thing, or recurring experience; `烦`
foregrounds being bothered, disturbed, or worn down by an immediate nuisance.

**Divergent exposure:** `我最____别人说话不算数。` naturally favors `讨厌`;
`别____我了，我正在赶报告。` naturally favors `烦`. The shared cue can remain
multi-answer while later examples develop these distinct stances and argument
patterns.

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
