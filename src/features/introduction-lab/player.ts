import {
  resolveContentExerciseResponse,
  type TeachingPackageSnapshot,
} from '../../domain/word-content';

export type IntroductionPlayerState = {
  phase: 'introduction' | 'rehearsal' | 'result' | 'finished';
  beatIndex: number;
  exerciseIndex: number;
  response: string;
  result: 'accepted' | 'rejected' | 'revealed' | null;
};

export type IntroductionPlayerAction =
  | { type: 'advance' }
  | { type: 'back' }
  | { type: 'edit'; response: string }
  | { type: 'submit' }
  | { type: 'reveal' }
  | { type: 'retry' }
  | { type: 'next' };

export function initialIntroductionPlayerState(): IntroductionPlayerState {
  return {
    phase: 'introduction',
    beatIndex: 0,
    exerciseIndex: 0,
    response: '',
    result: null,
  };
}

/** Keep answer-bearing workspace chrome out of the active recall surface. */
export function shouldConcealIntroductionAnswers(phase: IntroductionPlayerState['phase']): boolean {
  return phase === 'rehearsal';
}

export function introductionPlayerKeyAction(
  event: {
    key: string;
    repeat: boolean;
    composing: boolean;
    editable: boolean;
    modified: boolean;
  },
  phase: IntroductionPlayerState['phase'],
): IntroductionPlayerAction | null {
  if (event.repeat || event.composing || event.editable || event.modified) return null;
  if (event.key === ' ' && phase === 'introduction') return { type: 'advance' };
  if (event.key === ' ' && phase === 'result') return { type: 'next' };
  if (event.key === 'ArrowLeft' && (phase === 'introduction' || phase === 'rehearsal')) {
    return { type: 'back' };
  }
  return null;
}

/** A local preview transition only; it never records study evidence or credit. */
export function reduceIntroductionPlayer(
  state: IntroductionPlayerState,
  action: IntroductionPlayerAction,
  packageSnapshot: TeachingPackageSnapshot,
): IntroductionPlayerState {
  switch (action.type) {
    case 'advance':
      if (state.phase !== 'introduction') return state;
      if (state.beatIndex < packageSnapshot.beats.length - 1) {
        return { ...state, beatIndex: state.beatIndex + 1 };
      }
      return { ...state, phase: packageSnapshot.rehearsals.length > 0 ? 'rehearsal' : 'finished' };
    case 'back':
      if (state.phase === 'introduction') {
        return state.beatIndex > 0 ? { ...state, beatIndex: state.beatIndex - 1 } : state;
      }
      if (state.phase === 'rehearsal') {
        return { ...state, phase: 'introduction', beatIndex: packageSnapshot.beats.length - 1 };
      }
      return state;
    case 'edit':
      return state.phase === 'rehearsal' ? { ...state, response: action.response } : state;
    case 'submit': {
      if (state.phase !== 'rehearsal' || state.response.trim().length === 0) return state;
      const exercise = packageSnapshot.rehearsals[state.exerciseIndex];
      if (exercise === undefined) return state;
      const result = resolveContentExerciseResponse(exercise, state.response);
      return { ...state, phase: 'result', result: result.outcome };
    }
    case 'reveal':
      return state.phase === 'rehearsal' ? { ...state, phase: 'result', result: 'revealed' } : state;
    case 'retry':
      return state.phase === 'result'
        ? { ...state, phase: 'rehearsal', response: '', result: null }
        : state;
    case 'next':
      if (state.phase !== 'result') return state;
      return state.exerciseIndex < packageSnapshot.rehearsals.length - 1
        ? { ...state, phase: 'rehearsal', exerciseIndex: state.exerciseIndex + 1, response: '', result: null }
        : { ...state, phase: 'finished' };
  }
}
