import type {
  ReflectionHandleOperationV0,
  ReflectionInputItemV0,
  SessionReflectionBundleV0,
  SessionReflectionResultV3,
} from '../contracts.js';

function wordIds(item: ReflectionInputItemV0): Set<string> {
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

export function validateResultAgainstBundle(
  result: SessionReflectionResultV3,
  bundle: SessionReflectionBundleV0,
): string[] {
  const errors: string[] = [];
  if (result.bundleSchemaVersion !== bundle.schemaVersion) {
    errors.push('$.bundleSchemaVersion: does not match the input bundle schema version');
  }
  const inputItemIds = bundle.items.map((item) => item.itemId);
  const resultItemIds = result.itemResults.map((item) => item.itemId);
  if (new Set(resultItemIds).size !== resultItemIds.length) {
    errors.push('$.itemResults: duplicate itemId');
  }
  if (
    inputItemIds.length !== resultItemIds.length
    || !inputItemIds.every((itemId) => resultItemIds.includes(itemId))
  ) {
    errors.push('$.itemResults: every input item must appear exactly once and no unknown item is allowed');
  }

  const inputItemsById = new Map(bundle.items.map((item) => [item.itemId, item]));
  for (const [itemIndex, itemResult] of result.itemResults.entries()) {
    const location = `$.itemResults[${itemIndex}]`;
    if (itemResult.observation.trim().length === 0) errors.push(`${location}.observation: must not be empty`);
    const inputItem = inputItemsById.get(itemResult.itemId);
    if (inputItem === undefined) continue;
    const allowedWords = wordIds(inputItem);

    for (const [proposalIndex, proposal] of itemResult.proposals.entries()) {
      const proposalLocation = `${location}.proposals[${proposalIndex}]`;
      if (proposal.rationale.trim().length === 0) errors.push(`${proposalLocation}.rationale: must not be empty`);

      for (const wordId of operationWordReferences(proposal.operation)) {
        if (!allowedWords.has(wordId)) {
          errors.push(`${proposalLocation}.operation: word id ${wordId} is not present in item ${itemResult.itemId}`);
        }
      }

      const operation = proposal.operation;
      if (operation.kind === 'repair_production_cue') {
        if (operation.proposedCues.length === 0) {
          errors.push(`${proposalLocation}.operation.replacementCues: at least one replacement is required`);
        }
        if (operation.proposedCues.some((cue) => cue.text.trim().length === 0)) {
          errors.push(`${proposalLocation}.operation.replacementCues: cue text must not be empty`);
        }
      }
      if (operation.kind === 'create_contrast_cluster') {
        const memberIds = new Set(operation.members.map((member) => member.wordId));
        if (memberIds.size < 2) errors.push(`${proposalLocation}.operation.members: at least two distinct words are required`);
        if (operation.prompts.length === 0) {
          errors.push(`${proposalLocation}.operation.prompts: at least one prompt is required`);
        }
        if (operation.prompts.some((prompt) => !memberIds.has(prompt.targetWordId))) {
          errors.push(`${proposalLocation}.operation.prompts: every target must be a member`);
        }
        if (operation.prompts.some((prompt) => prompt.promptText.trim().length === 0)) {
          errors.push(`${proposalLocation}.operation.prompts: prompt text must not be empty`);
        }
        if (operation.title.trim().length === 0) {
          errors.push(`${proposalLocation}.operation.title: must not be empty`);
        }
      }
    }

    for (const [questionIndex, question] of (itemResult.questions ?? []).entries()) {
      if (question.question.trim().length === 0 || question.reason.trim().length === 0) {
        errors.push(`${location}.questions[${questionIndex}]: question and reason must not be empty`);
      }
    }
    for (const [needIndex, need] of (itemResult.unhandledNeeds ?? []).entries()) {
      if (
        need.description.trim().length === 0
        || need.whyRegisteredOperationsDoNotFit.trim().length === 0
      ) {
        errors.push(`${location}.unhandledNeeds[${needIndex}]: all fields must not be empty`);
      }
    }
  }

  return errors;
}
