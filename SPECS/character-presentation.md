# Character presentation in study sessions

Character preferences let learners read study material in Simplified or
Traditional Chinese, or compare both forms of a word while reading sentences in
one writing system. This document explains the intended display behavior and
the current mechanisms contributors need to understand when changing it.

The distinction is between **word labels**, which identify a word on its own,
and **sentences and explanations**, which use words in context. Word labels can
show both forms. Ordinary Chinese in the content, including Chinese quoted
inside English explanations, follows one chosen script. Deliberate comparisons
retain both forms so the explanation keeps its meaning.

This account covers introductions, learning, review, contrast selection, and
pure cues in study sessions. Vocabulary browsing and reflection reports are
outside its scope.

## Intended behavior

### Learner settings

**Card characters** offers Simplified, Traditional, and Both. It controls word
headings, recognition prompts, contrast choices, and standalone answer labels.
Both shows a distinct stored traditional form beside the simplified form.

**Sentences and examples** offers Simplified and Traditional, and appears only
when Card characters is Both. It controls Chinese in examples, cloze prompts,
cues, and explanatory text, including phrases embedded in otherwise English
meanings, translations, or explanations.

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

For example, with Both cards and Traditional sentences, a word label can show
`学习 / 學習` while an example sentence uses `學習` alone.

### Sentence and cloze display

Ordinary Chinese prose uses the effective sentence script, including existing
content authored in Traditional or mixed script. Traditional output uses Taiwan
character conventions without substituting regional vocabulary. Explicit
comparisons retain both forms. For example, `Simplified 学习; Traditional 學習`
must keep that distinction even when the learner chooses Traditional for
ordinary text.

A **cloze** is a sentence with a blank for the learner to complete. On reveal,
the blank contains one canonical answer form: the target word's selected form
in the sentence's script. A standalone answer follows Card characters and may
show both forms. Repeated blanks each receive the same target. Other accepted
words remain separate alternatives; conversion does not combine their identities.

Conversion must keep the intended blank hidden before reveal, use phrase context
where available, and preserve the canonical inserted answer. The hidden and
revealed versions must use the same surrounding sentence text. Stored answer
forms take precedence for the target; conversion supplies a missing traditional
sentence form.

### Content and evidence

Script conversion changes the displayed text while preserving the stored
material and records of the learner's activity. Authored documents, teaching
packages, served snapshots, raw responses, identifiers used for content-quality
feedback, and reflection evidence retain their source values. The
[word-content representation guide](../docs/word-content-representation.md)
explains the content objects and frozen snapshots. The display preference
applies to published lessons without rewriting or regenerating them.

Initial word-content creation (bootstrap), teaching, and review generation
request Simplified Chinese for newly authored sentences and inline Chinese
explanations. The generation instructions allow deliberate comparisons of
Simplified and Traditional forms in that text. Referenced examples retain their
source text, including Traditional Chinese. This editorial guidance and the
display preference serve different purposes: presentation makes output
consistent even when sources use mixed scripts. Character preferences do not
change requirements for English explanations or pinyin.

## Current implementation

Word-label formatting uses the stored forms for a particular word. Converting
sentences and explanations also needs phrase context.

- [Card-character formatting](../src/domain/card-characters.ts) uses the stored
  simplified and traditional forms. Traditional mode falls back to the stored
  simplified form when no distinct traditional form exists; Both then shows
  only that one form. Word labels do not trigger sentence conversion.
- [Sentence conversion](../src/domain/sentence-characters.ts) uses OpenCC
  JavaScript, pinned in [package.json](../package.json). It normalizes text to
  Simplified before producing the requested script, so mixed sources need no
  preliminary script detection. Phrase dictionaries distinguish uses such as
  `发展 → 發展` and `头发 → 頭髮`. The Traditional path uses Taiwan character
  variants without regional vocabulary substitution.
- [Cloze rendering](../src/features/session/ClozePrompt.tsx) finds blanks in the
  source text before conversion. The
  [study panel](../src/features/session/StudySessionPanel.tsx) supplies the same
  canonical form as private conversion context while the answer is hidden and
  as the answer on reveal. The converter temporarily fills blanks with that
  form to obtain phrase context, then separates the converted surrounding text
  from the canonical answer. Only the surrounding text and blank markers are
  rendered before reveal.

The converter recognizes a few written comparison patterns, such as
`学习 / 學習` or `Simplified 学习; Traditional 學習`. It checks that the distinct
forms convert to the same Simplified spelling, then leaves that span unchanged.
This check runs on all text passed through the converter, including teaching
prose, cues, and explanations. It does not interpret what a lesson means: a
deliberate comparison phrased differently can be missed and lose its distinction.

## Verification

Focused automated coverage includes:

- [Card characters](../tests/card-characters.test.ts): stored forms, missing or
  identical traditional forms, and invalid settings.
- [Sentence characters](../tests/sentence-characters.test.ts): effective
  preferences, mixed sources, phrase conversion, recognized comparisons, and
  the cloze conversion helper's alignment and canonical-answer handling.
- [Cloze rendering](../tests/cloze-prompt.test.ts): blank shapes, repeated
  blanks, mixed sources, Unicode prefixes, and hidden/revealed component output.
- [Saved settings](../tests/sentence-character-settings.test.ts) and
  [settings panel](../tests/session-character-settings-panel.test.ts): learner
  isolation, retained sentence preferences, validation, and static rendering of
  the conditional sentence selector.

These focused tests do not establish full session integration or visual quality.
When changing this feature, also verify all setting combinations,
saving/canceling, and restored preferences in the browser. Exercise teaching
beats, recognition references, direct cues, production/contrast/pure-cue content,
supplements, and frozen failure cards.

Include cloze cases with traditional and mixed sources, ambiguous phrase
conversions, multiple blank shapes, repeated blanks, Unicode spans, and canonical
answers.
Verify raw source data and accepted-answer matching are unaffected. Check the
rendered settings and representative session cards at narrow desktop widths and
enlarged text, including keyboard access.
