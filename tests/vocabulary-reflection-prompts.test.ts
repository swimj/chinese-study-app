import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const original = readFileSync(new URL('../server/reflection/prompts/staged-diagnosis.md', import.meta.url), 'utf8');
const reasoning = readFileSync(new URL('../server/vocabulary/reflection-prompts/reasoning.md', import.meta.url), 'utf8');

// Guard the intentional extraction boundary, not the prose as a whole. These
// intact passages carry linguistic judgments that schema adaptation must retain.
test('vocabulary reflection retains detailed linguistic guidance and worked examples', () => {
  for (const opening of [
    'A good production cue evokes a useful expressive instinct:',
    'Assess the exact lexical unit.',
    'Assess the existing cue before choosing explanation, reinforcement, or repair.',
    'For a definition gloss, judge coherence as a production exercise,',
    'If your explanation must narrow or correct the cue',
    'Determine whether the response is the intended target,',
    'A cue should evoke an intended meaning or utterance,',
    'Check each new cue as the learner will see it before answering.',
    'A minimal-context exercise need not constrain every possible communication',
    'The goal is strong evocation, not proof that no other word could ever fit.',
    'Preserve lexical-unit integrity.',
    'Contrast practice should help the learner stop misusing words through natural',
    'Possible candidates include many proper names,',
    'For `适用` / `实用` under',
    'For correct `天生` under',
    'For correct `动摇` under',
  ]) {
    const sourceParagraph = original.split('\n\n').find(paragraph => paragraph.startsWith(opening));
    // The final sentences of this paragraph referenced old suppression and
    // ambiguity routing; preserve its complete linguistic argument before that.
    const passage = sourceParagraph?.split('\nThe repair guidance below applies')[0];
    assert.ok(passage, `source passage exists: ${opening}`);
    assert.ok(reasoning.includes(passage), `retained verbatim: ${opening}`);
  }
  for (const example of ['`提醒` / `提示`', '`式` / `样式`', '`包庇`', '`遇见`', '`郗`', '`考察`', '`考查`']) {
    assert.ok(reasoning.includes(example), `retained adapted example: ${example}`);
  }
});

test('shared vocabulary reasoning leaves output and operation authority to current call contracts', () => {
  assert.doesNotMatch(reasoning, /staged_reflection_diagnosis_result|ambiguous_pair|targetSuppression|sourceAttemptJudgments|proposalGroupKey|learnerExplanation|diagnosisTags|request_word_bootstrap|suppress_definition_production|create_contrast_cluster|repair_production_cue/);
  assert.ok(reasoning.includes('The task-specific instructions that follow define the current call\'s output.'));
  assert.ok(reasoning.includes('Neither call asks the learner to approve a repair.'));
  assert.ok(reasoning.includes('Contrast creation, production suppression, bootstrap, and post-reveal teaching\nchanges are diagnostic considerations only; do not fabricate those operations.'));
  assert.ok(reasoning.includes('each option need not prove a distinct pedagogical dimension.'));
  assert.ok(reasoning.includes('The current\nimprovement call can author wording only within its supplied answer contract.'));
});
