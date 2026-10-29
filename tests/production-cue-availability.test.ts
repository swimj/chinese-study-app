import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  deriveProductionCueAvailability,
  type ProductionCueAvailabilityFacts,
} from '../server/db/production-cue-availability.ts';

function facts(
  overrides: Partial<ProductionCueAvailabilityFacts> = {},
): ProductionCueAvailabilityFacts {
  return {
    scope: 'shared',
    learnerActive: null,
    publicationStatus: 'available',
    replacementCueId: null,
    sourceEligible: true,
    ...overrides,
  };
}

describe('production cue availability policy', () => {
  test('published shared cues are active by default, including shared trials', () => {
    for (const publicationStatus of ['available', 'shared_trial'] as const) {
      assert.deepEqual(deriveProductionCueAvailability(facts({ publicationStatus })), {
        active: true,
        status: 'active',
        replacementCueId: null,
      });
    }
  });

  test('learner activation can disable a shared cue or enable a private cue', () => {
    assert.deepEqual(deriveProductionCueAvailability(facts({ learnerActive: false })), {
      active: false,
      status: 'deactivated',
      replacementCueId: null,
    });
    assert.deepEqual(
      deriveProductionCueAvailability(
        facts({ scope: 'learner', learnerActive: true, publicationStatus: null }),
      ),
      { active: true, status: 'active', replacementCueId: null },
    );
  });

  test('a private cue without learner activation is deactivated', () => {
    for (const learnerActive of [null, false]) {
      assert.deepEqual(
        deriveProductionCueAvailability(
          facts({ scope: 'learner', learnerActive, publicationStatus: null }),
        ),
        { active: false, status: 'deactivated', replacementCueId: null },
      );
    }
  });

  test('a replacement takes precedence over publication, source, and learner blockers', () => {
    for (const scope of ['shared', 'learner'] as const) {
      assert.deepEqual(
        deriveProductionCueAvailability(
          facts({
            scope,
            replacementCueId: 'successor-cue',
            publicationStatus: 'retired',
            sourceEligible: false,
            learnerActive: false,
          }),
        ),
        { active: false, status: 'replaced', replacementCueId: 'successor-cue' },
      );
    }
  });

  test('a retired or quarantined shared cue stays unavailable even when enabled', () => {
    for (const publicationStatus of ['retired', 'quarantined'] as const) {
      assert.deepEqual(
        deriveProductionCueAvailability(facts({ publicationStatus, learnerActive: true })),
        { active: false, status: publicationStatus, replacementCueId: null },
      );
    }
  });

  test('a shared cue without a publication is unpublished', () => {
    assert.deepEqual(
      deriveProductionCueAvailability(facts({ publicationStatus: null, learnerActive: true })),
      { active: false, status: 'unpublished', replacementCueId: null },
    );
  });

  test('shared publication blockers explain unavailability before source or learner state', () => {
    for (const publicationStatus of ['retired', 'quarantined', null] as const) {
      assert.deepEqual(
        deriveProductionCueAvailability(
          facts({ publicationStatus, sourceEligible: false, learnerActive: false }),
        ),
        {
          active: false,
          status: publicationStatus ?? 'unpublished',
          replacementCueId: null,
        },
      );
    }
  });

  test('source unavailability blocks both shared and private cues before learner state', () => {
    for (const scope of ['shared', 'learner'] as const) {
      for (const learnerActive of [true, false, null]) {
        assert.deepEqual(
          deriveProductionCueAvailability(facts({ scope, sourceEligible: false, learnerActive })),
          { active: false, status: 'source_unavailable', replacementCueId: null },
        );
      }
    }
  });

  test('shared publication state does not govern learner-owned cues', () => {
    for (const publicationStatus of ['retired', 'quarantined', null] as const) {
      assert.deepEqual(
        deriveProductionCueAvailability(facts({ scope: 'learner', learnerActive: true, publicationStatus })),
        { active: true, status: 'active', replacementCueId: null },
      );
    }
  });
});
