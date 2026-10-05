# Character presentation in study sessions

Accepted on 2026-10-05. This preference lets learners use Simplified, Traditional,
or both word forms while keeping sentences consistent in one writing system.
It applies to the main study session surfaces: introductions, learning, review,
contrast selection, and pure cues. Vocabulary browsing and reflection reports
are outside this first implementation.

## Learner settings

**Card characters** offers Simplified, Traditional, and Both. It controls word
headings, recognition prompts, contrast choices, and standalone answer labels.
Both shows a distinct stored traditional form beside the simplified form.

**Sentences and examples** offers Simplified and Traditional, and appears only
when Card characters is Both. It controls authored Chinese sentences, clozes,
examples, supplements, and Chinese phrases embedded in explanations and cues.

| Card characters | Effective sentences and examples |
| --- | --- |
| Simplified | Simplified |
| Traditional | Traditional |
| Both | The learner's Sentences and examples preference |

The saved sentence preference defaults to Simplified and is retained when Card
characters changes. Returning to Both restores it. Both settings are private to
the learner and saved with the existing session settings. They do not change
scheduling, assessment, or which typed answer forms are accepted. Raw typed
responses and personal notes retain the learner's spelling.

## Sentence and cloze display

Ordinary Chinese prose uses the effective sentence script, including existing
content authored in Traditional or mixed script. Traditional output uses Taiwan
character conventions without substituting regional vocabulary. Explicit
comparisons of simplified and traditional forms remain comparisons.

A revealed cloze inserts one canonical answer form in the sentence's script.
A standalone answer still follows Card characters and may show both forms.
Repeated blanks each receive the same target. Other accepted words remain
separate alternatives; conversion does not combine their identities.

Conversion must keep the intended blank hidden before reveal, use phrase context
where available, and preserve the canonical inserted answer. Source offsets must
never be reused against converted text. The hidden and revealed versions must
use the same surrounding sentence text. Stored answer forms take precedence for
the target; conversion supplies a missing traditional sentence form.

## Content and evidence

Script conversion is a presentation step. Immutable authored documents, teaching
packages, served snapshots, raw responses, content-quality identities, and
reflection evidence keep their existing source values. Already-published lessons
benefit without a rewrite or regeneration. The authoring lab keeps its source
preview unless preferences are supplied by the session.

New bootstrap, teaching, and review generation requests Simplified Chinese in
sentences and inline Chinese explanations. This is editorial guidance; learner
presentation remains responsible for consistent output from existing or mixed
sources. English explanation and pinyin requirements remain unchanged.

Use a pinned OpenCC JavaScript release with phrase-aware dictionaries. Derive
normalized display text without rewriting persisted content. Script detection
is not a prerequisite: shared characters can belong to either system.

## Verification

Verify all setting combinations, learner isolation, saving/canceling, and restored
preferences. Exercise teaching beats, recognition references, direct cues,
production/contrast/pure-cue content, supplements, and frozen failure cards.

Cloze checks cover traditional and mixed sources, ambiguous phrase conversions,
multiple blank shapes, repeated blanks, Unicode spans, and canonical answers.
Verify raw source data and accepted-answer matching are unaffected. Check the
rendered settings and representative session cards at narrow desktop widths and
enlarged text, including keyboard access.
