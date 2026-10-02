import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSessionContentQualityTarget, sessionContentQualityEncounterId } from '../src/features/session/session-content-quality.ts';
import type { SessionStudyItem } from '../src/domain/study-actions.ts';

const production: NonNullable<SessionStudyItem['production']> = {
  taskId: 'task', cueId: 'cue', cueType: 'definition_gloss', text: 'A custom prompt',
  acceptedAnswers: [{ wordId: 'word', hanzi: '词', traditional: null }], supplement: null,
};

test('quality targets identify authored cue content without treating dictionary prompts as generated content', () => {
  assert.deepEqual(getSessionContentQualityTarget({ actionKind: 'production', contentRef: null, production }),
    { kind: 'production_cue', id: 'cue' });
  assert.equal(getSessionContentQualityTarget({ actionKind: 'production', contentRef: null, production: null }), null);
  assert.equal(getSessionContentQualityTarget({ actionKind: 'recognition', contentRef: null, production }), null);
});

test('frozen rehearsals use their package and exercise, independently of production cue IDs', () => {
  const rehearsal: NonNullable<SessionStudyItem['rehearsal']> = {
    packageId: 'package', wordContentId: 'source', exerciseId: 'rehearsal', responseMode: 'hanzi_entry',
    matchingProfile: 'mandarin', contract: { kind: 'target_rehearsal', wordId: 'word' }, instruction: '',
    stimulus: { text: 'Recall this', source: { kind: 'direct_text', text: 'Recall this' } },
    acceptedAnswers: production.acceptedAnswers,
  };
  assert.deepEqual(getSessionContentQualityTarget({ actionKind: 'production', contentRef: null, production, rehearsal }),
    { kind: 'rehearsal', packageId: 'package', rehearsalId: 'rehearsal' });
  assert.equal(getSessionContentQualityTarget({ actionKind: 'recognition', contentRef: null, production: null, rehearsal }), null);
});

test('display identity survives reveal/Undo but separates repeated encounters and sessions', () => {
  const id = sessionContentQualityEncounterId('session', 'action', 1);
  assert.equal(sessionContentQualityEncounterId('session', 'action', 1), id);
  assert.notEqual(sessionContentQualityEncounterId('session', 'action', 2), id);
  assert.notEqual(sessionContentQualityEncounterId('another-session', 'action', 1), id);
});


test('contrast quality carries the exact frozen prompt and answer identity', () => {
  const contrastSelection: NonNullable<SessionStudyItem['contrastSelection']> = {
    clusterId: 'cluster', clusterTitle: '', clusterNote: '', scheduledWordId: 'scheduled-word',
    promptTargetWordId: 'answer-word', choices: [],
    prompt: { id: 'contrast', clusterId: 'cluster', targetWordId: 'answer-word',
      promptText: 'Frozen prompt', explanation: 'Frozen explanation' },
  };
  const item = { actionKind: 'contrast_selection' as const,
    contentRef: { type: 'contrast_prompt' as const, id: 'contrast' }, production: null, contrastSelection };
  assert.deepEqual(getSessionContentQualityTarget(item), {
    kind: 'contrast_prompt', id: 'contrast', expected: {
      promptText: 'Frozen prompt', explanation: 'Frozen explanation', targetWordId: 'answer-word',
    },
  });
  assert.throws(() => getSessionContentQualityTarget({ ...item, contrastSelection: null }), /matching frozen prompt/);
  assert.throws(() => getSessionContentQualityTarget({ ...item,
    contentRef: { type: 'contrast_prompt', id: 'other' } }), /matching frozen prompt/);
});
