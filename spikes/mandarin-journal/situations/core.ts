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

Return a practice action for the exercise. Its title is a brief learner-facing label, its detail explains why the move fits this learner, and its exercise has one of three renderable forms. Each form measures something different, so choose by what the exercise is for:
• recall tests whether a specific expression comes to mind when the learner needs it. Real production is set off by an intention or by the words already said, with nothing on the page to recognize, so producing from memory is the test that matters. It is the default whenever the exercise is about one expression: a word just taught, a word being reviewed, or something the learner reached for or got wrong in their own Chinese. If they wrote 这部电影很有感动 meaning the film was moving, the expression they lacked is 感人, and it comes back first as a recall of 感人, not as a choice among look-alikes or a free-writing prompt.
• choice tests recognition. Reading the options pages the answer into mind, which real speech never does, so a correct choice shows little. Use it only for a contrast the learner has demonstrably confused: their own slip, or the same form missed more than once. The options are then the forms actually confused, perhaps with one more plausible neighbor, as in 感人 / 感动 / 有感动 for the slip above, once the learner has had a recall of 感人. Never use a choice to check a word just taught; the learner would be recognizing the sentence they just read.
• open is conversation, not a test of a particular expression. Someone says something to the learner, a conversation is already under way, or a moment invites a reaction, and the learner replies as themselves. It may grow from the learner's own material, but it never asks for a required word, sentence frame or point to make.
How to write each form:
• choice: give ONE natural containing context with a clearly evoked slot, then 2–4 distinct short expressions that compete to fill it. The answer is an exact member. Never give one word and ask which of two situations exemplifies it. 修理 vs 修复 can work in 技术员正在___损坏的数据。 With 区别 and 区分 many contexts genuinely allow both: if the alternatives could both fit, choose a different intention or format. Never force a dubious near-synonym distinction.
• recall: the learner types one expression from memory, as on a flashcard. A good recall cue is graspable before the answer is remembered: the learner understands what it is getting at even while searching for the word. Use either a concise English cue (an ordinary English equivalent, or a brief circumstance that captures what someone means) or a short Mandarin phrase cloze with exactly one ____ for the entire expression and a concise English frame. A cloze suits an expression whose use lives in its frame: 情况____改善 framed as “The situation improved somewhat.” anchors 有所. Start with a plain equivalent; keep the expressive character that makes the word useful, such as register, attitude or emotional force (“Go through the motions; do something perfunctorily.” for 敷衍). “Scarf.” already evokes 围巾; a scene of wrapping fabric adds reading without improving the association. Read the cue without supplying the answer: the expression itself must be the natural answer, not a consequence of it or a larger expression containing it (“Sharp — of a blade.” for 锋利, not “Cut something easily.”). Keep the expression's Chinese and pinyin out of an English cue; a cloze may keep another occurrence in natural context. Natural alternatives may remain possible: list other written forms that should count as correct in accepted, and do not contort the cue to exclude every synonym. Do not add response instructions such as “Type the Mandarin for…” or “Fill in…”; the answer field already asks for it, so give only the cue (“Rare; hard to come by, as in a rare opportunity.”, or 祝你____！ framed as “Smooth sailing! A send-off.”). Keep choices empty. The answer is the expression exactly as it should be typed.
• open: write the lead-in the learner answers: usually a line someone says to them in natural Mandarin, with a few words of English or Chinese setting only when the moment needs it. A friend saying 我上个月把工作辞了，现在每天在家睡到自然醒。 gives the learner something to react to in their own way. For 做着做着 the occasion is a friend asking 你昨晚不是说早点睡吗？怎么两点还在线？, which invites recounting opening an old photo and spending half the evening browsing, without naming the expression. Do not add “用「…」”, a sentence frame, the content the reply must contain, or who the reply must address beyond what the lead-in already makes clear: the learner should spend their effort replying, not decoding the assignment. A lead-in can draw on the learner's material so that an expression they met or reached for would fit, but any apt reply counts. Keep choices empty. The answer is one natural reply, not a key. The explanation says what an apt reply does in this moment and leaves room for replies that go elsewhere.
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

type StructuredField = 'action' | 'wordDecision' | 'capture' | 'reflection' | 'observation' | 'landed' | 'media' | 'notice' | 'beats';
const unexpected: Record<StructuredField, string> = {
  capture: 'Only Home capture can choose a route',
  action: 'This tutor turn cannot change the journal',
  wordDecision: 'Unexpected word intake decision',
  reflection: 'Only reflection turns can return takeaways',
  observation: 'Only exercise feedback can include an observation',
  landed: 'Only exercise feedback can judge whether an answer landed',
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
