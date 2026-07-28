import type {
  ReflectionHandleOperationV0,
  ReflectionInputItemV1,
  ReflectionProviderFixtureV0,
} from './contracts.js';
import { stressCaseFixtures } from './fixtures/stress-cases.js';
import { workflowAppendixFixtures } from './fixtures/workflow-appendix.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function wordIds(item: ReflectionInputItemV1): Set<string> {
  const ids = new Set<string>();
  if (item.targetWord !== null) ids.add(item.targetWord.wordId);
  if (item.source === 'production_mistake' && item.submittedWord !== null) {
    ids.add(item.submittedWord.wordId);
  }
  if (item.source === 'session_note') {
    for (const relatedWord of item.relatedWords) ids.add(relatedWord.wordId);
  }
  if (item.source === 'contrast_selection') {
    for (const choiceWord of item.promptAsShown.choiceWords) ids.add(choiceWord.wordId);
  }
  return ids;
}

function operationWordReferences(operation: ReflectionHandleOperationV0): string[] {
  switch (operation.kind) {
    case 'suppress_definition_production':
    case 'repair_production_cue':
      return [operation.wordId];
    case 'create_contrast_cluster':
      return [
        ...operation.members.map((member) => member.wordId),
        ...operation.prompts.map((prompt) => prompt.targetWordId),
      ];
    case 'accept_production_alternate':
      return [operation.targetWordId, operation.alternateWordId];
  }
}

function validateFixture(fixture: ReflectionProviderFixtureV0): void {
  assert(fixture.fixtureId.trim().length > 0, 'Fixture id must not be empty.');
  if (fixture.source.kind === 'workflow_appendix') {
    assert(fixture.source.appendixExample >= 1, `${fixture.fixtureId}: invalid appendix example number`);
  } else {
    assert(fixture.source.suppliedAt.trim().length > 0, `${fixture.fixtureId}: missing supplied date`);
  }
  assert(fixture.inputBundle.schemaVersion === 'session_reflection_bundle.v1', `${fixture.fixtureId}: wrong bundle version`);
  assert(fixture.inputBundle.items.length > 0, `${fixture.fixtureId}: empty input bundle`);

  if (fixture.referenceResult === null) {
    assert(fixture.readiness === 'blocked', `${fixture.fixtureId}: only blocked fixtures may omit a reference result`);
    return;
  }

  assert(fixture.referenceResult.schemaVersion === 'session_reflection_result.v4', `${fixture.fixtureId}: wrong result version`);

  const inputItemIds = fixture.inputBundle.items.map((item) => item.itemId);
  const resultItemIds = fixture.referenceResult.itemResults.map((item) => item.itemId);
  assert(new Set(inputItemIds).size === inputItemIds.length, `${fixture.fixtureId}: duplicate input item id`);
  assert(new Set(resultItemIds).size === resultItemIds.length, `${fixture.fixtureId}: duplicate result item id`);
  assert(
    inputItemIds.length === resultItemIds.length && inputItemIds.every((id) => resultItemIds.includes(id)),
    `${fixture.fixtureId}: every input item must have exactly one result and no unknown result item is allowed`,
  );

  const inputItemsById = new Map(fixture.inputBundle.items.map((item) => [item.itemId, item]));
  const actualKinds: ReflectionHandleOperationV0['kind'][] = [];

  for (const itemResult of fixture.referenceResult.itemResults) {
    const inputItem = inputItemsById.get(itemResult.itemId);
    assert(inputItem !== undefined, `${fixture.fixtureId}: missing input item ${itemResult.itemId}`);
    const allowedWordIds = wordIds(inputItem);
    for (const requiredTag of fixture.evaluation.requiredDiagnosisTags) {
      assert(
        itemResult.diagnosisTags.includes(requiredTag),
        `${fixture.fixtureId}: reference result is missing required diagnosis tag ${requiredTag}`,
      );
    }
    for (const forbiddenTag of fixture.evaluation.forbiddenDiagnosisTags) {
      assert(
        !itemResult.diagnosisTags.includes(forbiddenTag),
        `${fixture.fixtureId}: reference result contains forbidden diagnosis tag ${forbiddenTag}`,
      );
    }
    for (const proposal of itemResult.proposals) {
      actualKinds.push(proposal.operation.kind);

      for (const referencedWordId of operationWordReferences(proposal.operation)) {
        assert(
          allowedWordIds.has(referencedWordId),
          `${fixture.fixtureId}: operation references unknown word ${referencedWordId}`,
        );
      }

      if (proposal.operation.kind === 'create_contrast_cluster') {
        const memberIds = new Set(proposal.operation.members.map((member) => member.wordId));
        assert(
          memberIds.size >= 2,
          `${fixture.fixtureId}: new contrast content must include at least two distinct members`,
        );
        assert(
          proposal.operation.prompts.every((prompt) => memberIds.has(prompt.targetWordId)),
          `${fixture.fixtureId}: every contrast prompt target must be a member`,
        );
        assert(
          proposal.operation.prompts.length > 0,
          `${fixture.fixtureId}: contrast content must include at least one prompt`,
        );
      }
    }

    if (fixture.evaluation.questionPolicy === 'required') {
      assert((itemResult.questions ?? []).length > 0, `${fixture.fixtureId}: reference result requires a clarifying question`);
    }
    if (fixture.evaluation.questionPolicy === 'none_expected') {
      assert((itemResult.questions ?? []).length === 0, `${fixture.fixtureId}: reference result unexpectedly asks a question`);
    }
    if (fixture.evaluation.unhandledNeedPolicy === 'required') {
      assert((itemResult.unhandledNeeds ?? []).length > 0, `${fixture.fixtureId}: reference result requires an unhandled need`);
    }
    if (fixture.evaluation.unhandledNeedPolicy === 'none_expected') {
      assert((itemResult.unhandledNeeds ?? []).length === 0, `${fixture.fixtureId}: reference result unexpectedly reports an unhandled need`);
    }
  }

  const matchesProfile = fixture.evaluation.acceptableProposalProfiles.some((profile) => {
    const requiredPresent = profile.requiredKinds.every((kind) => actualKinds.includes(kind));
    const onlyAllowed = actualKinds.every((kind) => profile.allowedKinds.includes(kind));
    return requiredPresent && onlyAllowed;
  });
  assert(matchesProfile, `${fixture.fixtureId}: reference proposals do not match an acceptable evaluation profile`);
}

const fixtureIds = new Set<string>();
const exampleNumbers = new Set<number>();
const allFixtures = [...workflowAppendixFixtures, ...stressCaseFixtures];

for (const fixture of allFixtures) {
  assert(!fixtureIds.has(fixture.fixtureId), `Duplicate fixture id: ${fixture.fixtureId}`);
  fixtureIds.add(fixture.fixtureId);
  if (fixture.source.kind === 'workflow_appendix') {
    assert(!exampleNumbers.has(fixture.source.appendixExample), `Duplicate appendix example: ${fixture.source.appendixExample}`);
    exampleNumbers.add(fixture.source.appendixExample);
  }
  validateFixture(fixture);
}

assert(workflowAppendixFixtures.length === 15, `Expected 15 appendix fixtures, got ${workflowAppendixFixtures.length}`);
assert(
  Array.from({ length: 15 }, (_, index) => index + 1).every((example) => exampleNumbers.has(example)),
  'Appendix fixtures must cover examples 1 through 15 exactly once.',
);

const readinessCounts = allFixtures.reduce<Record<string, number>>((counts, fixture) => {
  counts[fixture.readiness] = (counts[fixture.readiness] ?? 0) + 1;
  return counts;
}, {});
const modeCounts = allFixtures.reduce<Record<string, number>>((counts, fixture) => {
  const mode = fixture.evaluation.mode ?? 'scored';
  counts[mode] = (counts[mode] ?? 0) + 1;
  return counts;
}, {});

console.log(
  `Validated ${allFixtures.length} fixtures: readiness=${JSON.stringify(readinessCounts)} modes=${JSON.stringify(modeCounts)}`,
);
