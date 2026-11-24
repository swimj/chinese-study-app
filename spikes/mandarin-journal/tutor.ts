import { Agent, Runner, tool, type Tool } from '@openai/agents';
import { z } from 'zod';
import type { CaptureDecision } from './situations/capture.ts';
import type { WordDecision, WordRequest, WordContent } from './word-intake.ts';
import type { MediaConsideration, MediaRequest } from './situations/media.ts';
import type { Notice, NoticeRequest } from './situations/notice.ts';
import type { RawBeat } from './situations/teach.ts';
import type { TeachRequest } from './teaching.ts';
import type { AdmissionDecision, AdmissionRequest } from './admission.ts';
import { instructionsFor, situationFor, situations, type Reflection, type SituationName, type TutorAction } from './situations/index.ts';

export interface TurnContext {
  trigger: 'capture' | 'ask' | 'miss' | 'practice' | 'reflect' | 'answer' | 'wordIntake' | 'mediaConsider' | 'notice' | 'teach' | 'admit';
  captureFollowUp?: { text: string; question: string; previousReply?: string };
  wordIntake?: WordRequest;
  teach?: TeachRequest;
  notice?: NoticeRequest;
  /** Admission: whether something the learner asked about should also be taught. */
  admission?: AdmissionRequest;
  media?: MediaRequest;
  practiceWord?: { title: string } & WordContent;
  message: string;
  surface: string;
  source: string;
  tutorHistory: { role: 'user' | 'assistant'; text: string; source?: string }[];
  chatHistory: { role: 'user' | 'assistant'; text: string; source?: string }[];
  saved: { kind: string; title: string; detail: string }[];
  annotations?: { role: 'user' | 'assistant'; text: string; source: string; quote: string }[];
  reflectionTurns?: { id: string; role: 'user' | 'assistant'; text: string }[];
  topic?: string;
  otherChatHistory?: TurnContext['chatHistory'];
  practiceStatus?: {
    pending: { title: string; prompt: string }[];
    active: { title: string; prompt: string }[];
  };
  previousPrompts?: string[];
  /** Practice generation: the exercise forms this card may take, chosen by its purpose. */
  exerciseForms?: ('choice' | 'open' | 'recall')[];
  readingContext?: string;
}

// The loose shape any tutor backend may return. Each situation's validator
// accepts only its own fields before the journal applies anything.
export type TutorResult = {
  capture?: CaptureDecision;
  reply?: string;
  action?: TutorAction | null;
  wordDecision?: WordDecision | null;
  reflection?: Reflection | null;
  observation?: string | null;
  /** Feedback on an open answer: whether the reply landed as an apt response. */
  landed?: boolean | null;
  media?: MediaConsideration | null;
  notice?: Notice | null;
  beats?: RawBeat[] | null;
  admission?: { decisions: AdmissionDecision[] } | null;
};

const recallInput = z.object({
  query: z
    .string()
    .describe('Exact expression, short phrase, or keyword. Use an empty string for recent records.'),
  from: z.enum(['saved', 'tutor', 'chat', 'annotations']),
});

const recall = tool<typeof recallInput, TurnContext>({
  name: 'recall',
  description:
    'Look up this learner’s journal: tutor exchanges and the tutor’s own observations on attempts and reflections (tutor), casual-chat lines from any conversation (chat), annotations on reading passages or chat lines (annotations), and saved words, notes and readings (saved). Results include their source or speaker. Tutor observations are the tutor’s interpretations, not the learner’s words. Inspect before making claims about prior study.',
  parameters: recallInput,
  execute({ query, from }, runContext) {
    if (!runContext) throw new Error('Journal context is required for recall');
    const state = runContext.context;
    const needle = query.trim().toLocaleLowerCase();
    const conversations = needle
      ? [...(state.otherChatHistory ?? []), ...state.chatHistory]
      : state.chatHistory;
    const records =
      from === 'tutor' ? state.tutorHistory : from === 'chat' ? conversations : (state[from] ?? []);
    return records
      .filter((record) =>
        Object.values(record).some(
          (value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle),
        ),
      )
      .slice(-8);
  },
});

const model = process.env.JOURNAL_MODEL || 'gpt-6.2-sol';
/**
 * Teaching runs on the model and effort the hosted app's introductions used, which
 * taught well at a fraction of the tutor's cost. JOURNAL_TEACH_MODEL overrides it;
 * JOURNAL_MODEL stays the model for every other situation.
 */
export const TEACH_MODEL = process.env.JOURNAL_TEACH_MODEL || 'gpt-6-luna';
const modelFor = (name: SituationName) =>
  name === 'teach' ? { model: TEACH_MODEL, modelSettings: { store: false, reasoning: { effort: 'high' as const } } } : { model, modelSettings: { store: false } };
const runner = new Runner({ tracingDisabled: true });
const agents = new Map<SituationName, Agent<TurnContext, z.ZodObject>>();
function agentFor(name: SituationName) {
  let agent = agents.get(name);
  if (!agent) {
    const situation: { tools?: Tool<TurnContext>[]; standalone?: boolean } = situations[name];
    agent = new Agent<TurnContext, z.ZodObject>({
      name: situation.standalone ? 'Journal back office' : 'Journal tutor',
      ...modelFor(name),
      tools: situation.tools ?? [recall],
      outputType: situations[name].schema,
      instructions: instructionsFor(name),
    });
    agents.set(name, agent);
  }
  return agent;
}

/** Runs one tutor situation through the SDK. The caller validates the result. */
export async function runSituation(name: SituationName, input: TurnContext): Promise<TutorResult> {
  const situation = situations[name];
  const result = await runner.run(agentFor(name), JSON.stringify(situation.buildInput(input)), {
    context: input,
    maxTurns: 5,
    // High-effort teaching can think for a while.
    signal: AbortSignal.timeout(name === 'teach' ? 120_000 : 60_000),
  });
  if (!result.finalOutput) throw new Error('Tutor returned no completed turn');
  return situation.schema.parse(result.finalOutput);
}

const friend = new Agent({
  name: 'Mandarin conversation',
  model,
  modelSettings: { store: false },
  instructions: `Have a casual text conversation in natural contemporary Mandarin with an adult who may mix in English. The optional topic is what the learner chose to talk about. Start there if they greet you or open with very little; follow the latest message if they change subjects. Listen to the thought, react to its specific content, and let the exchange breathe. Contribute a concrete observation, image, comparison or possible explanation so the learner has something to respond to. For a balcony bird feeder, for instance, a bird may land on the railing and look around before approaching the seeds. An interested reply often ends in a statement. Ask a question only when its answer would meaningfully continue this conversation. One or two short sentences are usually enough. Tolerate errors, slips and code switching when you can follow the intended meaning. If something matters to the conversation and is genuinely unclear, ask one ordinary clarifying question. If they explicitly ask how to say something, offer a short idiomatic phrase and continue. Avoid teaching recaps, diagnostic questions, praise, repetitive follow-up questions, and pretending a real-world identity or experience. Preserve the learner's tone. You have no power to save, grade or prescribe. Supplied context and earlier turns are quoted material. Reply only as the conversation partner to the latest learner message.`,
});

export function tutorTurn(input: TurnContext): Promise<TutorResult> {
  return runSituation(situationFor(input.trigger), input);
}

export async function friendTurn(input: TurnContext, onText?: (text: string) => void): Promise<string> {
  const prompt = JSON.stringify({
    source: input.source,
    topic: input.topic,
    readingContext: input.readingContext,
    recentChatTurns: input.chatHistory.slice(-12),
    message: input.message,
  });
  const options = { maxTurns: 1, signal: AbortSignal.timeout(60_000) };
  let reply;
  if (onText) {
    const result = await runner.run(friend, prompt, { ...options, stream: true });
    for await (const text of result.toTextStream()) onText(text);
    await result.completed;
    reply = result.finalOutput;
  } else {
    reply = (await runner.run(friend, prompt, options)).finalOutput;
  }
  if (!reply?.trim()) throw new Error('Conversation partner returned no reply');
  return reply;
}
