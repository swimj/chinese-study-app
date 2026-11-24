import { z } from 'zod';
import type { AdmissionDecision } from '../admission.ts';
import type { TurnContext } from '../tutor.ts';
import { rejectOtherEffects, type Situation } from './core.ts';

const schema = z.object({
  admission: z.object({
    decisions: z
      .array(
        z.object({
          form: z.string().describe('The expression exactly as given in forms.'),
          admit: z.boolean(),
          reason: z.string().describe('One short internal sentence: why it is or is not worth practicing for this learner.'),
        }),
      )
      .describe('One decision per form, in the order given.'),
  }),
});

// Decides whether something the learner asked about also becomes a target to teach.
// Never shown to the learner. An explicit save never reaches this judgment.
export const admit: Situation<typeof schema, AdmissionDecision[]> = {
  standalone: true,
  tools: [],
  instructions: `You decide whether something an adult Mandarin learner asked about should also become something their journal teaches and practices. Nothing you write is shown to the learner. The learner is intermediate to advanced.

The learner brought in a word or expression to find out what it means; the tutor has already explained it (explanation). It stays in their journal as a piece either way. Admitting it means the journal will teach it on a lesson card and then test it by typed recall over the next days until it settles. That takes practice time from everything else the learner could work on, and there is always more to learn, so admit what is worth producing, not everything met.

Weigh how useful it is for this learner to produce, to say or write it themselves in situations they are likely to be in, against whether understanding it when they meet it is enough. sent is what the learner submitted, context is where they met it in their own words, and replies are their answers to any clarification. A question about meaning alone does not show they want to use it; where they met it shows what kind of situations it comes from.
- Admit everyday vocabulary and expressions that fit what the learner reads, writes or talks about: 报备, 透透气, a useful idiom such as 石沉大海 for a message that gets no reply, or 内耗 when they met it describing their own team.
- Understanding is usually enough for proper names, places and brands (静安寺); dish names; puns and wordplay that live in one post; very coarse words; and slang, memes and literary set phrases that a learner would rarely say naturally and might misjudge in register. Mild slang such as yyds is worth understanding; whether to drill it depends on whether this learner would plausibly say it among friends.
- When it is genuinely a toss-up, do not admit: the learner can always ask to save it.

reason: one short internal sentence naming what decided it, such as "Everyday verb for keeping someone informed." or "Recognizing it is enough: a pun tied to one post."`,
  schema,
  buildInput: (input) => ({ ...input.admission }),
  validate(result, input) {
    rejectOtherEffects(result, ['admission']);
    const request = input.admission;
    if (!request) throw new Error('Missing admission request');
    const decisions = result.admission?.decisions;
    if (!decisions) throw new Error('The judgment returned no admission');
    if (decisions.length !== request.forms.length || decisions.some((d, i) => d.form !== request.forms[i].form))
      throw new Error('Decide each form once, in order');
    if (decisions.some((d) => !d.reason.trim())) throw new Error('An admission needs a reason');
    return decisions.map((d) => ({ form: d.form, admit: d.admit, reason: d.reason.trim() }));
  },
};

/**
 * The offline demo's deliberately simple policy: admit what the demo can teach,
 * and leave the rest as pieces. It still decides per form; nothing assumes admit-all.
 */
export function demoAdmission(input: TurnContext, teachable: (form: string) => boolean): AdmissionDecision[] {
  const request = input.admission;
  if (!request) throw new Error('Missing admission request');
  return request.forms.map(({ form }) =>
    teachable(form)
      ? { form, admit: true, reason: 'An everyday word the demo can teach.' }
      : { form, admit: false, reason: 'The demo only teaches its curated words.' },
  );
}
