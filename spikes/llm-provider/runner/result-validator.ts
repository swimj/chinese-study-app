import type {
  ReflectionEvidenceCitationV0,
  ReflectionHandleOperationV0,
  SessionReflectionBundleV0,
  SessionReflectionResultV0,
} from '../contracts.js';

function resolvableEvidence(bundle: SessionReflectionBundleV0): Set<string> {
  const ids = new Set<string>();
  for (const item of bundle.items) {
    ids.add(`item/${item.itemId}`);
    if (item.sessionNote !== null) ids.add(`session_note/${item.itemId}`);
    if (item.targetWord !== null) ids.add(`word/${item.targetWord.wordId}`);
    if (item.source !== 'contrast_selection') {
      for (const cue of item.cuesAsShown) ids.add(`cue/${item.itemId}/${cue.displayOrder}`);
    }
    for (const cluster of item.existingContent.contrastClusters) {
      ids.add(`contrast_cluster/${cluster.clusterId}`);
    }
    if (item.source === 'production_mistake') {
      if (item.submittedWord !== null) ids.add(`word/${item.submittedWord.wordId}`);
      for (const attempt of item.attempts) ids.add(`attempt/${attempt.attemptId}`);
    } else if (item.source === 'session_note') {
      for (const relatedWord of item.relatedWords) ids.add(`word/${relatedWord.wordId}`);
    } else {
      ids.add(`contrast_prompt/${item.promptAsShown.promptId}`);
      for (const choiceWord of item.promptAsShown.choiceWords) ids.add(`word/${choiceWord.wordId}`);
      for (const attempt of item.attempts) ids.add(`attempt/${attempt.attemptId}`);
    }
  }
  return ids;
}

function wordIds(bundle: SessionReflectionBundleV0): Set<string> {
  const ids = new Set<string>();
  for (const item of bundle.items) {
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
  }
  return ids;
}

function clusterIds(bundle: SessionReflectionBundleV0): Set<string> {
  return new Set(bundle.items.flatMap((item) => (
    item.existingContent.contrastClusters.map((cluster) => cluster.clusterId)
  )));
}

function cueTexts(bundle: SessionReflectionBundleV0): Set<string> {
  return new Set(bundle.items.flatMap((item) => (
    item.source === 'contrast_selection' ? [] : item.cuesAsShown.map((cue) => cue.text)
  )));
}

function operationWordReferences(operation: ReflectionHandleOperationV0): string[] {
  switch (operation.kind) {
    case 'flag_bad_production_cue':
    case 'suppress_definition_production':
    case 'repair_production_cue':
      return [operation.wordId];
    case 'add_contrast_candidate':
      return [
        operation.targetWordId,
        ...(operation.relatedWord.wordId === null ? [] : [operation.relatedWord.wordId]),
      ];
    case 'upsert_contrast_content':
      return [
        ...operation.members.map((member) => member.wordId),
        ...operation.prompts.map((prompt) => prompt.targetWordId),
      ];
    case 'accept_production_alternate':
      return [operation.targetWordId, operation.alternateWordId];
  }
}

function validateEvidence(
  evidence: ReflectionEvidenceCitationV0[],
  allowedIds: Set<string>,
  location: string,
): string[] {
  return evidence.flatMap((citation, index) => {
    const errors: string[] = [];
    if (!allowedIds.has(citation.evidenceId)) {
      errors.push(`${location}.evidence[${index}]: unresolved evidence id ${citation.evidenceId}`);
    }
    if (citation.claim.trim().length === 0) {
      errors.push(`${location}.evidence[${index}].claim: must not be empty`);
    }
    return errors;
  });
}

export function validateResultAgainstBundle(
  result: SessionReflectionResultV0,
  bundle: SessionReflectionBundleV0,
): string[] {
  const errors: string[] = [];
  if (result.bundleSchemaVersion !== bundle.schemaVersion) {
    errors.push('$.bundleSchemaVersion: does not match the input bundle schema version');
  }
  if (result.summary.trim().length === 0) errors.push('$.summary: must not be empty');

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

  const allowedEvidence = resolvableEvidence(bundle);
  const allowedWords = wordIds(bundle);
  const allowedClusters = clusterIds(bundle);
  const allowedCueTexts = cueTexts(bundle);
  const proposalKeys = new Set<string>();

  for (const [itemIndex, itemResult] of result.itemResults.entries()) {
    const location = `$.itemResults[${itemIndex}]`;
    if (itemResult.observation.trim().length === 0) errors.push(`${location}.observation: must not be empty`);
    errors.push(...validateEvidence(itemResult.evidence, allowedEvidence, location));

    for (const [proposalIndex, proposal] of itemResult.proposals.entries()) {
      const proposalLocation = `${location}.proposals[${proposalIndex}]`;
      if (proposal.proposalKey.trim().length === 0) errors.push(`${proposalLocation}.proposalKey: must not be empty`);
      if (proposalKeys.has(proposal.proposalKey)) {
        errors.push(`${proposalLocation}.proposalKey: duplicate key ${proposal.proposalKey}`);
      }
      proposalKeys.add(proposal.proposalKey);
      if (proposal.rationale.trim().length === 0) errors.push(`${proposalLocation}.rationale: must not be empty`);
      errors.push(...validateEvidence(proposal.evidence, allowedEvidence, proposalLocation));

      for (const wordId of operationWordReferences(proposal.operation)) {
        if (!allowedWords.has(wordId)) errors.push(`${proposalLocation}.operation: unknown word id ${wordId}`);
      }

      const operation = proposal.operation;
      if (operation.kind === 'flag_bad_production_cue' || operation.kind === 'repair_production_cue') {
        if (!allowedCueTexts.has(operation.sourceCue.textAsShown)) {
          errors.push(`${proposalLocation}.operation.sourceCue: cue text was not shown in the bundle`);
        }
      }
      if (operation.kind === 'accept_production_alternate' && !allowedCueTexts.has(operation.cue.textAsShown)) {
        errors.push(`${proposalLocation}.operation.cue: cue text was not shown in the bundle`);
      }
      if (operation.kind === 'flag_bad_production_cue' && operation.issues.length === 0) {
        errors.push(`${proposalLocation}.operation.issues: at least one issue is required`);
      }
      if (operation.kind === 'repair_production_cue') {
        if (operation.replacementCues.length === 0) {
          errors.push(`${proposalLocation}.operation.replacementCues: at least one replacement is required`);
        }
        if (operation.replacementCues.some((cue) => cue.text.trim().length === 0)) {
          errors.push(`${proposalLocation}.operation.replacementCues: cue text must not be empty`);
        }
      }
      if (operation.kind === 'add_contrast_candidate') {
        if (operation.interferenceAxes.length === 0) {
          errors.push(`${proposalLocation}.operation.interferenceAxes: at least one axis is required`);
        }
        if (operation.relatedWord.wordId === null && operation.relatedWord.text.trim().length === 0) {
          errors.push(`${proposalLocation}.operation.relatedWord.text: must not be empty`);
        }
      }
      if (operation.kind === 'upsert_contrast_content') {
        const memberIds = new Set(operation.members.map((member) => member.wordId));
        if (memberIds.size < 2) errors.push(`${proposalLocation}.operation.members: at least two distinct words are required`);
        if (operation.prompts.some((prompt) => !memberIds.has(prompt.targetWordId))) {
          errors.push(`${proposalLocation}.operation.prompts: every target must be a member`);
        }
        if (operation.prompts.some((prompt) => prompt.promptText.trim().length === 0)) {
          errors.push(`${proposalLocation}.operation.prompts: prompt text must not be empty`);
        }
        if (operation.destination.mode === 'extend_cluster' && !allowedClusters.has(operation.destination.clusterId)) {
          errors.push(`${proposalLocation}.operation.destination: unknown cluster id ${operation.destination.clusterId}`);
        }
        if (operation.destination.mode === 'create_cluster' && operation.destination.title.trim().length === 0) {
          errors.push(`${proposalLocation}.operation.destination.title: must not be empty`);
        }
      }
    }

    for (const [questionIndex, question] of itemResult.questions.entries()) {
      if (question.questionKey.trim().length === 0 || question.question.trim().length === 0 || question.reason.trim().length === 0) {
        errors.push(`${location}.questions[${questionIndex}]: key, question, and reason must not be empty`);
      }
    }
    for (const [needIndex, need] of itemResult.unhandledNeeds.entries()) {
      if (
        need.needKey.trim().length === 0
        || need.description.trim().length === 0
        || need.whyExistingHandlesDoNotFit.trim().length === 0
      ) {
        errors.push(`${location}.unhandledNeeds[${needIndex}]: all fields must not be empty`);
      }
    }
  }

  return errors;
}
