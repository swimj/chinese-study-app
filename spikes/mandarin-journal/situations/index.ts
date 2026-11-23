import type { TurnContext, TutorResult } from '../tutor.ts';
import { ask } from './ask.ts';
import { feedback } from './feedback.ts';
import { practiceGen } from './practice.ts';
import { reflect } from './reflect.ts';
import { wordIntake } from './word-intake.ts';
import { mediaConsider } from './media.ts';

import { voice } from './core.ts';
export { voice, type TutorAction } from './core.ts';
export type { Reflection } from './reflect.ts';

export const situations = { ask, wordIntake, reflect, feedback, practiceGen, mediaConsider };
export type SituationName = keyof typeof situations;
export type SituationOutput<K extends SituationName> = ReturnType<(typeof situations)[K]['validate']>;

export function situationFor(trigger: TurnContext['trigger']): SituationName {
  switch (trigger) {
    case 'ask':
      return 'ask';
    case 'miss':
    case 'answer':
      return 'feedback';
    case 'practice':
      return 'practiceGen';
    case 'reflect':
      return 'reflect';
    case 'wordIntake':
      return 'wordIntake';
    case 'mediaConsider':
      return 'mediaConsider';
  }
}

export function instructionsFor(name: SituationName): string {
  const situation: { instructions: string; standalone?: boolean } = situations[name];
  return situation.standalone ? situation.instructions : voice + '\n\n' + situation.instructions;
}

const validators: { [K in SituationName]: (result: TutorResult, input: TurnContext) => SituationOutput<K> } = {
  ask: ask.validate,
  wordIntake: wordIntake.validate,
  reflect: reflect.validate,
  feedback: feedback.validate,
  practiceGen: practiceGen.validate,
  mediaConsider: mediaConsider.validate,
};

/** Validates a live or demo tutor result against one situation's contract. */
export function validateTurn<K extends SituationName>(
  name: K,
  result: TutorResult,
  input: TurnContext,
): SituationOutput<K> {
  if (situationFor(input.trigger) !== name) throw new Error('Trigger ' + input.trigger + ' does not belong to ' + name);
  return validators[name](result, input);
}
