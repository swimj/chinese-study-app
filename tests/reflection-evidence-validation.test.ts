import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  parseInitialReflectionMilestoneBundle,
  parseSessionReflectionBundle,
  parseSessionReflectionEvidenceSupplement,
  validateInitialReflectionMilestoneBundle,
  validateSessionReflectionBundle,
  validateSessionReflectionEvidenceSupplement,
} from '../src/domain/reflection-evidence.js';
import type {
  SessionReflectionEvidenceSupplementV1,
} from '../src/domain/reflection-evidence.js';
import type {
  ReflectionInputItemV1,
  ReflectionWordSnapshotV1,
  SessionReflectionBundleV1,
} from '../src/domain/reflection.js';

const generatedAt = '2026-07-29T12:00:00.000Z';

describe('session reflection evidence supplement validation', () => {
  test('parses canonical typed production evidence', () => {
    const supplement = validSupplement();
    assert.equal(parseSessionReflectionEvidenceSupplement(supplement), supplement);
    assert.deepEqual(validateSessionReflectionEvidenceSupplement(supplement), []);
  });

  test('strictly rejects unknown fields and empty ids, raw responses, cues, or attempts', () => {
    const supplement = structuredClone(validSupplement()) as unknown as Record<string, unknown>;
    const items = supplement.items as Array<Record<string, unknown>>;
    const item = items[0]!;
    supplement.extra = true;
    item.itemId = ' ';
    item.rawResponse = '';
    item.cuesAsShown = [];
    item.attemptIds = [];

    const errors = validateSessionReflectionEvidenceSupplement(supplement).join('\n');
    assert.match(errors, /\$\.extra: unknown property/);
    assert.match(errors, /\.itemId: must not be empty/);
    assert.match(errors, /\.rawResponse: must not be empty/);
    assert.match(errors, /\.cuesAsShown: at least one cue is required/);
    assert.match(errors, /\.attemptIds: at least one accepted attempt id is required/);
    assert.throws(
      () => parseSessionReflectionEvidenceSupplement(supplement),
      /Invalid session reflection evidence supplement/,
    );
  });

  test('rejects duplicate item, action, and attempt identities across evidence items', () => {
    const supplement = validSupplement();
    supplement.items.push({
      ...structuredClone(supplement.items[0]!),
      targetWordId: 'another-word',
    });

    const errors = validateSessionReflectionEvidenceSupplement(supplement).join('\n');
    assert.match(errors, /duplicate item id "item-1"/);
    assert.match(errors, /duplicate session action id "action-1"/);
    assert.match(errors, /duplicate attempt id "attempt-1"/);
  });

  test('rejects unknown cue types, non-contiguous ordering, and empty cue text', () => {
    const supplement = structuredClone(validSupplement()) as unknown as Record<string, unknown>;
    const item = (supplement.items as Array<Record<string, unknown>>)[0]!;
    const cue = (item.cuesAsShown as Array<Record<string, unknown>>)[0]!;
    cue.cueType = 'semantic_cloud';
    cue.displayOrder = 1;
    cue.text = ' ';

    const errors = validateSessionReflectionEvidenceSupplement(supplement).join('\n');
    assert.match(errors, /\.cueType: value is not in the allowed enum/);
    assert.match(errors, /cues must be ordered contiguously from zero/);
    assert.match(errors, /\.text: must not be empty/);
  });
});

describe('session reflection bundle validation', () => {
  test('validates every declared V1 item shape without forking canonical types', () => {
    const bundle = broadBundle();
    assert.deepEqual(validateSessionReflectionBundle(bundle), []);
    assert.equal(parseSessionReflectionBundle(bundle), bundle);
  });

  test('allows a session note to link to an action that has its own evidence item', () => {
    const bundle = broadBundle();
    const note = bundle.items[1]!;
    const production = bundle.items[0]!;
    note.sessionActionId = production.sessionActionId;

    assert.deepEqual(validateSessionReflectionBundle(bundle), []);
  });

  test('rejects unknown nested fields and non-UTC or malformed timestamps', () => {
    const bundle = structuredClone(broadBundle()) as unknown as Record<string, unknown>;
    bundle.generatedAt = '2026-07-29T20:00:00.000+08:00';
    const session = bundle.session as Record<string, unknown>;
    session.startedAt = 'not-a-time';
    const items = bundle.items as Array<Record<string, unknown>>;
    const production = items[0]!;
    const targetWord = production.targetWord as Record<string, unknown>;
    targetWord.unexpected = 'field';

    const errors = validateSessionReflectionBundle(bundle).join('\n');
    assert.match(errors, /\$\.generatedAt: expected canonical UTC timestamp/);
    assert.match(errors, /\$\.session\.startedAt: expected canonical UTC timestamp/);
    assert.match(errors, /\.targetWord\.unexpected: unknown property/);
  });

  test('rejects duplicate item and action ids across the full bundle', () => {
    const bundle = broadBundle();
    const production = bundle.items[0]!;
    const contrast = bundle.items[2]!;
    contrast.itemId = production.itemId;
    contrast.sessionActionId = production.sessionActionId;

    const errors = validateSessionReflectionBundle(bundle).join('\n');
    assert.match(errors, /duplicate item id "production-item"/);
    assert.match(errors, /duplicate session action id "production-action"/);
  });

  test('rejects retired attempt and production-management metadata', () => {
    const bundle = structuredClone(broadBundle()) as unknown as Record<string, unknown>;
    const production = (bundle.items as Array<Record<string, unknown>>)[0]!;
    production.attempts = [];
    production.attemptShape = {};
    const targetWord = production.targetWord as Record<string, unknown>;
    targetWord.production = { relevance: 'normal', notes: [] };

    const errors = validateSessionReflectionBundle(bundle).join('\n');
    assert.match(errors, /\.attempts: unknown property/);
    assert.match(errors, /\.attemptShape: unknown property/);
    assert.match(errors, /\.production: unknown property/);
  });

  test('enforces discriminated-union fields and cue ordering', () => {
    const bundle = structuredClone(broadBundle()) as unknown as Record<string, unknown>;
    const items = bundle.items as Array<Record<string, unknown>>;
    const production = items[0]!;
    production.responseKind = 'matched_known_word';
    production.submittedWord = null;
    const cues = production.cuesAsShown as Array<Record<string, unknown>>;
    cues[0]!.displayOrder = -1;
    cues[0]!.cueType = 'register_or_domain_hint';
    const contrast = items[2]!;
    const prompt = contrast.promptAsShown as Record<string, unknown>;
    prompt.promptTargetWordId = 'not-a-choice';

    const errors = validateSessionReflectionBundle(bundle).join('\n');
    assert.match(errors, /a matched response requires a word snapshot/);
    assert.match(errors, /\.displayOrder: expected non-negative integer/);
    assert.match(errors, /\.cueType: value is not in the allowed enum/);
    assert.match(errors, /target must be one of the displayed choices/);
  });
});

describe('initial reflection milestone bundle validation', () => {
  test('accepts a completed bundle containing typed production mistakes', () => {
    const bundle: SessionReflectionBundleV1 = {
      ...broadBundle(),
      items: [productionItem()],
    };
    assert.deepEqual(validateInitialReflectionMilestoneBundle(bundle), []);
    assert.equal(parseInitialReflectionMilestoneBundle(bundle), bundle);
  });

  test('rejects empty, unfinished, non-production, and no-clue milestone inputs', () => {
    const emptyBundle: SessionReflectionBundleV1 = {
      ...broadBundle(),
      session: {
        ...broadBundle().session,
        endedAt: null,
      },
      items: [],
    };
    const emptyErrors = validateInitialReflectionMilestoneBundle(emptyBundle).join('\n');
    assert.match(emptyErrors, /a completed session timestamp is required/);
    assert.match(emptyErrors, /at least one qualifying production mistake is required/);

    const broad = broadBundle();
    const scopeErrors = validateInitialReflectionMilestoneBundle({
      ...broad,
      items: broad.items.slice(1),
    }).join('\n');
    assert.match(scopeErrors, /accepts only production_mistake items/);

    const noClue = productionItem();
    noClue.rawResponse = null;
    noClue.submittedWord = null;
    noClue.responseKind = 'no_clue';
    const noClueErrors = validateInitialReflectionMilestoneBundle({
      ...broad,
      items: [noClue],
    }).join('\n');
    assert.match(noClueErrors, /no-clue evidence is outside/);
    assert.match(noClueErrors, /\.rawResponse: expected string/);
    assert.throws(
      () => parseInitialReflectionMilestoneBundle({ ...broad, items: [noClue] }),
      /Invalid initial reflection milestone bundle/,
    );
  });
});

function validSupplement(): SessionReflectionEvidenceSupplementV1 {
  return {
    schemaVersion: 'session_reflection_evidence_supplement.v1',
    items: [{
      itemId: 'item-1',
      sessionActionId: 'action-1',
      targetWordId: 'target',
      cuesAsShown: [{
        cueId: null,
        cueType: 'definition_gloss',
        displayOrder: 0,
        text: 'target',
        displayedMeanings: ['target'],
      }],
      rawResponse: 'alternate',
      attemptIds: ['attempt-1'],
    }],
  };
}

function broadBundle(): SessionReflectionBundleV1 {
  return {
    schemaVersion: 'session_reflection_bundle.v1',
    generatedAt,
    session: {
      sessionId: 'session-1',
      startedAt: '2026-07-29T11:50:00.000Z',
      endedAt: generatedAt,
      studyProfile: 'mandarin',
    },
    items: [
      productionItem(),
      sessionNoteItem(),
      contrastItem(),
    ],
  };
}

function productionItem(): Extract<ReflectionInputItemV1, { source: 'production_mistake' }> {
  return {
    itemId: 'production-item',
    sessionActionId: 'production-action',
    occurredAt: '2026-07-29T11:55:00.000Z',
    source: 'production_mistake',
    sourceActionKind: 'production',
    targetWord: word('target', '目标'),
    sessionNote: null,
    existingContent: {
      contrastClusters: [{
        clusterId: 'cluster-1',
        title: 'Target and alternate',
        memberWordIds: ['target', 'alternate'],
        promptCount: 1,
        notes: [],
      }],
      knownAcceptedAlternates: [{
        cueId: null,
        acceptedWordIds: ['alternate'],
        note: null,
      }],
    },
    cuesAsShown: [{
      cueId: null,
      cueType: 'definition_gloss',
      displayOrder: 0,
      text: 'target',
      displayedMeanings: ['target'],
    }],
    rawResponse: '替代',
    submittedWord: word('alternate', '替代'),
    responseKind: 'matched_known_word',
  };
}

function sessionNoteItem(): Extract<ReflectionInputItemV1, { source: 'session_note' }> {
  return {
    itemId: 'note-item',
    sessionActionId: null,
    occurredAt: null,
    source: 'session_note',
    sourceActionKind: null,
    targetWord: null,
    sessionNote: 'A free-standing note.',
    existingContent: {
      contrastClusters: [],
      knownAcceptedAlternates: [],
    },
    cuesAsShown: [],
    relatedWords: [word('related', '相关')],
    linkedAttemptId: null,
  };
}

function contrastItem(): Extract<ReflectionInputItemV1, { source: 'contrast_selection' }> {
  return {
    itemId: 'contrast-item',
    sessionActionId: 'contrast-action',
    occurredAt: '2026-07-29T11:58:00.000Z',
    source: 'contrast_selection',
    sourceActionKind: 'contrast_selection',
    targetWord: word('target', '目标'),
    sessionNote: null,
    existingContent: {
      contrastClusters: [],
      knownAcceptedAlternates: [],
    },
    promptAsShown: {
      promptId: 'prompt-1',
      promptText: 'Choose the target.',
      explanationShown: null,
      choiceWords: [word('target', '目标'), word('alternate', '替代')],
      promptTargetWordId: 'target',
    },
    reflectionSignal: 'clear_now',
  };
}

function word(wordId: string, hanzi: string): ReflectionWordSnapshotV1 {
  return {
    wordId,
    hanzi,
    pinyin: 'pinyin',
    meanings: ['meaning'],
  };
}
