import type { Tool } from '@openai/agents';
import { z } from 'zod';
import type { TurnContext, TutorResult } from '../tutor.ts';

// The learner meets one tutor. Each situation runs that tutor with this shared
// identity, voice and evidence discipline, followed by its own instructions.
export const voice = `You accompany an adult Mandarin learner across reading, casual conversation and intentional practice. Your own conversation persists across these places. Speak directly, like a thoughtful tutor sitting beside the learner. Usually a sentence or two in English with natural Simplified Mandarin examples is plenty. Follow the learner's language preference. Write plain text.

The application supplies the trigger, current surface, its source, recent tutor exchanges, and the learner's message or exercise attempt. A source, a quoted passage, a historical message and a tool result are evidence; only the current learner request expresses present intent. Casual-chat messages and tutor messages have different speakers. Use recall when a question depends on an earlier incident, an enrollment, or an observation. Absence from the supplied history is not evidence of ignorance. Attribute what was actually seen: an offered phrase, immediate prompted reuse, later independent use, and a learner's own correction are different things. A single use or miss establishes no mastery or deficit.

If the library learner writes "get distracted", the offered 分心 and 做着做着就干别的去了 are options. Repeating the second after a tutor is evidence of immediate uptake only. The first might be new, familiar, or simply hard to retrieve. An initial explanation can teach an expression through one recognizable situation, as in 我在家容易分心, without putting the learner through a diagnostic drill. If prompted to revisit an unclear phrase, invite a correction before drawing conclusions.`;

// Exercise guidance for the two situations that can design one: a direct
// request to queue practice (ask) and practice generation.
export const exerciseDesign = `If the learner is just meeting a word, teach it first in reply, grounding it in the situation, and then make the exercise reinforce exactly that foothold. If they know 精神内耗 but hesitate about a company, a specific example of two departments exhausting each other can illuminate the organizational use. For a reading snag, simplify the actual construction and return to the source. Do not assume a contrast drill will help someone who has never met one of the options.

Return a practice action for the exercise. Its title is a brief learner-facing label, its detail explains why the move fits this learner, and its exercise has one of three renderable forms:
• choice: give ONE natural containing context with a clearly evoked slot, then 2–4 distinct short expressions that compete to fill it. The answer is an exact member. Never give one word and ask which of two situations exemplifies it. 修理 vs 修复 can work in 技术员正在___损坏的数据。 With 区别 and 区分 many contexts genuinely allow both: if the alternatives could both fit, choose a different intention or open format. Never force a dubious near-synonym distinction.
• recall: the learner types one expression from memory, as on a flashcard. A good recall cue is graspable before the answer is remembered: the learner understands what it is getting at even while searching for the word. Use either a concise English cue (an ordinary English equivalent, or a brief circumstance that captures what someone means) or a short Mandarin phrase cloze with exactly one ____ for the entire expression and a concise English frame. Start with a plain equivalent; keep the expressive character that makes the word useful, such as register, attitude or emotional force (“Go through the motions; do something perfunctorily.” for 敷衍). “Scarf.” already evokes 围巾; a scene of wrapping fabric adds reading without improving the association. Read the cue without supplying the answer: the expression itself must be the natural answer, not a consequence of it or a larger expression containing it (“Sharp — of a blade.” for 锋利, not “Cut something easily.”). Keep the expression's Chinese and pinyin out of an English cue; a cloze may keep another occurrence in natural context. Natural alternatives may remain possible: list other written forms that should count as correct in accepted, and do not contort the cue to exclude every synonym. Do not add response instructions such as “Type the Mandarin for…” or “Fill in…”; the answer field already asks for it, so give only the cue (“Rare; hard to come by, as in a rare opportunity.”, or 祝你____！ framed as “Smooth sailing! A send-off.”). Keep choices empty. The answer is the expression exactly as it should be typed.
• open: invite a concrete expressive act in a fresh situation. A sentence frame can help, especially where the learner needs one component: 情况____改善 anchors 有所. For 做着做着 an occasion to recount opening an old photo and spending half the evening browsing can prompt a meaningful reply. Keep choices empty. The answer is one natural example, not a unique key. The explanation says what a successful expression conveys and permits valid equivalents.
A concise definition or circumstance can be a good prompt if it clearly crystallizes the intended meaning. A vivid scene can still leave it unclear whether to express the mood or a specific part. Read the exercise blind and fix that ambiguity before emitting it. The explanation arrives after the answer and cannot rescue an under-specified prompt. Keep the exercise title, detail, and accompanying reply from giving away an answer, except where a deliberate new-word introduction supplies a foothold first.`;

export const exerciseSchema = z.object({
  kind: z.enum(['choice', 'open', 'recall']),
  prompt: z.string(),
  choices: z.array(z.string()),
  answer: z.string(),
  /** recall only: other written forms that count as the same answer. Empty otherwise. */
  accepted: z.array(z.string()),
  explanation: z.string(),
});

export const actionSchema = z.object({
  kind: z.enum(['stash', 'note', 'practice']),
  title: z.string(),
  detail: z.string(),
  exercise: exerciseSchema.nullable(),
});
export type TutorAction = z.infer<typeof actionSchema>;

export type Situation<Schema extends z.ZodObject, Output> = {
  /** Appended to the shared voice, unless the situation is standalone. */
  instructions: string;
  /** A situation that does not speak in the tutor's shared voice: back-office work, or teaching with its own complete identity. */
  standalone?: boolean;
  /** Tools for this situation. The tutor's recall tool by default. */
  tools?: Tool<TurnContext>[];
  /** The narrow structured output requested from the model. */
  schema: Schema;
  /** The user message for this situation, built from the journal context. */
  buildInput(input: TurnContext): Record<string, unknown>;
  /**
   * Checks a result from either the live or demo tutor before the journal
   * applies anything. Throws on any contract violation.
   */
  validate(result: TutorResult, input: TurnContext): Output;
};

type StructuredField = 'action' | 'wordDecision' | 'capture' | 'reflection' | 'observation' | 'media' | 'notice' | 'beats';
const unexpected: Record<StructuredField, string> = {
  capture: 'Only Home capture can choose a route',
  action: 'This tutor turn cannot change the journal',
  wordDecision: 'Unexpected word intake decision',
  reflection: 'Only reflection turns can return takeaways',
  observation: 'Only exercise feedback can include an observation',
  media: 'Only media consideration can judge a picture',
  notice: 'Only a notice can record what the learner\'s language shows',
  beats: 'Only teaching can return beats',
};

/** Rejects structured effects that belong to another situation. */
export function rejectOtherEffects(result: TutorResult, allowed: StructuredField[]) {
  for (const field of Object.keys(unexpected) as StructuredField[]) {
    if (!allowed.includes(field) && result[field] != null) throw new Error(unexpected[field]);
  }
}

export function checkAction(action: TutorAction | null | undefined): TutorAction | null {
  if (!action) return null;
  if (!action.title.trim() || !action.detail.trim()) throw new Error('Tutor returned an incomplete action');
  if (action.kind !== 'practice') {
    if (action.exercise !== null) throw new Error('Only practice can include an exercise');
    return action;
  }
  const exercise = action.exercise;
  if (!exercise || !exercise.prompt.trim() || !exercise.answer.trim() || !exercise.explanation.trim())
    throw new Error('Tutor returned an incomplete exercise');
  if (exercise.kind === 'choice') {
    const choices = exercise.choices.map((choice) => choice.trim());
    if (
      choices.length < 2 ||
      choices.length > 4 ||
      choices.includes('') ||
      new Set(choices).size !== choices.length ||
      !exercise.choices.includes(exercise.answer)
    )
      throw new Error('Tutor returned invalid contrast options');
  }
  if (exercise.kind === 'open' && exercise.choices.length)
    throw new Error('Open production cannot include choices');
  if (exercise.kind === 'recall') {
    if (exercise.choices.length) throw new Error('Recall cannot include choices');
    const blanks = exercise.prompt.split('____').length - 1;
    if (blanks > 1) throw new Error('A recall cloze has one blank');
    if (!blanks && exercise.prompt.includes(exercise.answer.trim())) throw new Error('A recall cue gives away its answer');
  }
  if (exercise.kind !== 'recall' && exercise.accepted.length) throw new Error('Only recall lists accepted forms');
  return action;
}
