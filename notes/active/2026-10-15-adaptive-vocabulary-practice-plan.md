# Adaptive vocabulary practice product plan

status: active
type: research
created: 2026-10-15
retire-when: consolidated into an agreed product model and delivery plan, or declined

This plan describes a proposed vocabulary learning experience in which learners
can adjust how they practise and the app develops both its material and its
teaching approach in response. It captures the direction for further design;
exercise details and scheduling policies remain open. It is not a description
of shipped behavior or an execution commitment.

## Starting tensions

The current product combines structured teaching, repeated recall, and a later
review lifecycle. That arrangement places considerable weight on the quality
and suitability of each selected exercise. An unsuccessful production attempt
can create an obligation to keep returning to the same task to complete the
session. A linguistically sound card can still be a poor fit for the learner's
readiness, interests, or way of understanding the word.

Content and scheme amplify each other's limitations. Repetition makes an
unhelpful cue costly; improving the cue leaves the prescribed repetition and
success criteria largely unquestioned. Teaching and Practice reactions can be
recorded, but ordinary selection retains existing learners' package pins even
after an operator publishes a correction. The people who expose a problem can
therefore remain attached to it. See the current
[serving model](../../docs/word-content-serving.md),
[reaction behavior](../../docs/content-quality.md), and
[correction boundaries](../../docs/content-improvement.md#content-boundaries).

These tensions motivate a broader question: how can the app help learners find
productive ways to develop a word, while taking responsibility for useful
structure and guidance?

## Product beliefs

Language ability develops unevenly. Principles that help a beginner get started
may be insufficient for further growth. Learners can benefit from different
contexts, different demands, renewed teaching, or an unexpected route into
material they have encountered many times.

Structure is valuable, especially during the first encounter. The app's chosen
structure is a revisable hypothesis about what will help a learner. Reactions
can inform the content, the activity, the amount of work, and the timing of the
next encounter. Content and practice arrangements develop together.

The learner brings experience, interests, and a sense of what feels useful. The
app supplies a manageable default flow, varied opportunities to exercise ability,
and observations that help the learner evaluate that sense. Learners can redirect
practice without becoming content editors or designing their own curriculum.

The aim is productive, increasingly flexible access to language. Remembering a
word under a familiar cue is useful evidence about one capability. Continuing
development can involve additional contexts, distinctions, and combinations
with other language.

## Four modes of engagement with a word

The proposed progression is Teach, Solidify, Practice, and Maintain. These names
describe the support and attention the app provides. They are not certifications
of mastery. Learners can move forward or back; the app supplies defaults and
recommendations. Whether the interface calls them levels or modes remains open.

### Teach

The first day provides a coherent bootstrap-based introduction followed by
closely related recall exercises. This is the most structured mode: explicit
instruction and immediate practice establish an initial foothold. The existing
introduction is the starting model, and day-one exercises can remain relatively
inflexible while their quality is improved.

The normal transition to Solidify follows completion of the first-day work.
How an interrupted first encounter spans calendar days remains a detail to
resolve. The learner's general ability to choose a mode also permits moving
past teaching they do not need.

### Solidify

Each day begins with a short reactivation of the initial teaching, potentially
more quiz-like than the original introduction. The session then mixes other
activities around the word: production prompts, examples, and other useful
practice forms whose repertoire remains to be designed.

The app recommends a bounded amount of work and a default point at which the
word is covered for the day. The learner can stop earlier, continue longer,
try another approach, or explain what might help. A troublesome card does not
create an unavoidable debt that must be paid before the session can finish.

The learner moves to Practice when they feel explicit teaching reinforcement
is no longer needed. This choice means that future exercises can begin without
priming them first.

### Practice

Exercises appear without an initial teaching refresher. Varied contexts and
demands develop additional dimensions of the word, while encounters separated
in time help reveal whether recall persists. Difficulty may increase where the
app has a useful basis for judging it.

The learner has the same control over approach, daily amount, and reactions as
in Solidify. Possible activities include ordinary production, contrasts, and
pure-cue-like tasks. These are directions to explore, not a fixed catalog.

An exercise can involve several words. Over time, the words a learner is
developing can help select broader activities, rather than requiring every
activity to belong exclusively to one word.

The learner chooses Maintain when they feel ready to shift from concentrated
practice to lighter ongoing attention.

### Maintain

The app acts as a custodian of capabilities the learner wants to keep available.
Sparse revisits can use trusted exercises, with occasional probes where their
results can be interpreted meaningfully. Sampling, relaxed SRS, or a combination
are possible inclusion policies; the scheduling design remains open.

A difficulty can invite a reminder, another encounter, or a recommendation for
more concentrated practice. The response should fit what happened. A brief
reactivation of old associations may be sufficient without resetting a whole
learning trajectory.

Maintain also leaves room for vocabulary to participate in richer language
activities. It is an ongoing relationship with developing ability, not a claim
that learning the word is finished.

## Learner control and honest progress

The app recommends a daily flow that can ordinarily be followed without
configuration. Several distinct learner actions make that flow adjustable:

| Action | Meaning |
| --- | --- |
| Try another way | Continue working on this word through a different prompt or approach |
| Enough for today | Stop today's concentrated work without claiming success on unfinished tasks |
| More practice | Spend additional attention on the word today |
| Give input | Describe confusion, preferences, what seems known, or what else might help |
| Change mode | Choose a different degree of teaching support and future attention |

Input is optional and can be expressed in ordinary language. Stopping or
changing mode does not require an explanation. Moving into Maintain is distinct
from escaping an unpleasant session: stopping today leaves the mode unchanged.

Completed work, demonstrated capability, and learner choice have separate
meanings. A supported answer, independent retrieval, completion of a suggested
daily amount, and selection of Maintain can all be recorded honestly. Switching
activities does not manufacture success on the original task.

Exercises give learners opportunities to assess their own confidence. The app
can describe relevant observations and recommend a course of action while
leaving the choice of mode in their hands. Returning to more support is a useful
adjustment, not a demotion.

## An open repertoire of content and approaches

A word can draw on a growing set of useful material and activities. Generating
many production prompts is one promising way to create room for exploration,
particularly after the initial teaching. The important variety is in context,
retrieval route, support, and demand; the appropriate volume remains open.

“Try another way” can initially offer another prompt. Its broader meaning also
permits changing the activity: a hint, an example followed by recall, or a
distinction between plausible alternatives. These are illustrative forms of
supported practice. Their value and exact presentation need further design.

Low-cost switching makes it more affordable to try unfamiliar pedagogical
approaches. Linguistic correctness remains important, and the app takes
responsibility for selecting worthwhile alternatives. Learners should feel
responded to rather than tasked with sorting through generated inventory.

Shared material can support many learners, while individual preferences and
experience influence selection. General corrections, broadly useful additions,
and personal preferences have different scopes. Reactions can reveal approaches
that work widely as well as approaches that work particularly well for a subset
of learners. A single popularity ranking would lose that distinction.

Coherence is maintained where an activity needs it: an introduction can follow
an exact source, an exercise can retain its answer contract, and a historical
attempt can retain precisely what was shown. Future practice can select from
an evolving repertoire. This does not require all of a learner's future content
to remain one globally synchronized bundle. The storage and dependency model
for realizing that separation remains to be designed.

## Adaptation during and between sessions

During a session, learners have an immediate route onward when an activity is
unhelpful. The ordinary experience should remain pleasant despite the latency
of model-based linguistic judgment. Prepared alternatives and interleaving other
work while an alternative is generated are possible mechanisms; neither is
selected yet. The learner can stop without waiting for a diagnosis.

Between sessions, the system can use reactions and practice evidence to revise
several aspects of the experience:

| Aspect | Possible adaptation |
| --- | --- |
| Content | Correct material, improve an explanation, or add activities to the repertoire |
| Selection | Prefer useful contexts or approaches and avoid those that repeatedly disappoint |
| Arrangement | Adjust support, ordering, repetition, spacing, or daily amount |
| Guidance | Recommend a mode or a capability worth exploring next |

An unhelpful experience can reflect incorrect material, poor task fit, personal
taste, or a need for teaching. A reaction need not immediately establish which
one applies for the learner to receive a different experience. Deeper diagnosis
and content improvement can proceed on a slower cycle.

This supplies two complementary forms of responsiveness: flexibility during
study keeps a poor content choice from blocking learning or session completion;
an evolving repertoire and serving policy make later improvements available
through additions, corrections, and personalized selection.

The system should distinguish delivery of a change, the learner's perception of
improvement, and evidence of learning. Success after an easier or better-fitting
prompt is informative without proving durable, transferable ability. Exact
encounters and subsequent reactions should remain interpretable as the material
and arrangement evolve.

## Related future ideas

Recognition scheduling and broader reading activities are sibling directions
that could develop alongside this proposal. They are not part of its core
production-practice model.

Recognition retains a narrow foundational role: exercising access from written
form to pronunciation. Meaning recall and useful reveal material contribute to
the experience without pretending that a recognition card deeply assesses them.

Ordinary recognition SRS could begin around Practice, but its relationship to
production modes remains open. Recognition and production need not develop in
lockstep.

Reading passages containing several target words, reporting unfamiliar words,
and answering asynchronously assessed comprehension questions are possible
future activities. They can develop abilities beyond isolated recognition,
including parsing and reading fluency, and could draw on the vocabulary being
developed through production practice.

## Questions for further design

The core experience leaves several questions open:

1. What makes a useful default day's work in Solidify and Practice, and how does
   the app communicate completion without requiring success on every card?
2. Which genuinely different activities should constitute the initial repertoire,
   and what should “try another way” know about the previous experience?
3. How can optional learner input usefully guide selection, content improvement,
   and teaching recommendations without requiring self-diagnosis?
4. What evidence helps the learner choose a mode, and what scheduling policy
   serves each mode while respecting that choice?
5. Which content relationships require coherent revision, and which permit
   independent additions or replacement within the repertoire?
6. How should shared improvements and individual preferences interact, including
   recovery when an adaptation is unhelpful?

## Next steps

Concrete examples should enter when they resolve a particular uncertainty or
test a proposed activity. The next discussion can develop content quality and
exercise possibilities within this frame. Selecting a bounded first step from
the current product is a subsequent planning task.
