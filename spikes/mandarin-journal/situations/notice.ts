import { z } from 'zod';
import type { TurnContext } from '../tutor.ts';
import { rejectOtherEffects, type Situation } from './core.ts';

/** One piece of the learner's own language, as the record holds it. */
export type NoticeRequest = {
  kind: 'reflect' | 'ask' | 'annotation' | 'answer';
  /** The learner's words, verbatim. */
  text: string;
  /** What they were responding to: the partner's last line, a quoted passage, an exercise prompt. */
  respondingTo?: string;
  /** What the tutor already told the learner about this text, if anything. */
  tutorSaid?: string;
  /** For an exercise answer: the reference answer and what a successful response conveys. */
  exercise?: { prompt: string; reference: string; explanation: string };
  /** Target forms the exercise was meant to practice. */
  intended: string[];
  /** Forms the learner already has in the journal that appear in this text. */
  knownInText: string[];
};

const kind = z.enum(['word', 'expression', 'construction']);
const schema = z.object({
  notice: z.object({
    communicated: z
      .enum(['clear', 'partial', 'unclear'])
      .nullable()
      .describe('Whether the Mandarin got the meaning across. null when the text has no Mandarin to judge.'),
    uses: z
      .array(
        z.object({
          form: z.string().describe('The expression as a dictionary or grammar would cite it, in Simplified Chinese.'),
          kind,
          quality: z.enum(['natural', 'flawed']),
          note: z.string().describe('One short internal sentence on what the use shows. Empty if self-evident.'),
        }),
      )
      .describe('Expressions in the text worth tracking for this learner. At most 6.'),
    needs: z
      .array(
        z.object({
          form: z.string().describe('What a natural speaker would have used, in Simplified Chinese.'),
          kind,
          gloss: z.string().describe('A short English gloss of the needed sense.'),
          evidence: z.string().describe('The exact words from the learner text that show the reach.'),
          note: z.string(),
        }),
      )
      .describe('Places where the learner reached for something they did not have. At most 3.'),
    intended: z
      .array(z.object({ form: z.string(), outcome: z.enum(['natural', 'flawed', 'avoided']) }))
      .describe('One entry per intended form, in the order given. Empty when none were intended.'),
  }),
});
export type Notice = z.infer<typeof schema>['notice'];

const han = /\p{Script=Han}/u;

// Reads one stretch of the learner's language for the record. Never shown to the learner.
export const notice: Situation<typeof schema, Notice> = {
  standalone: true,
  tools: [],
  instructions: `You read one piece of an adult Mandarin learner's own language and record what it shows. Nothing you write is shown to the learner. The journal uses your notes to decide what is worth practicing next, so a false need costs a wasted exercise and a missed need costs a missed chance. The learner is intermediate to advanced; there is always more to learn, so record what this text actually shows rather than everything that could be taught.

The text may be the learner's lines from one stretch of casual conversation (kind reflect, one line per row), a question to the tutor, a note on a reading passage, or an answer to an exercise. respondingTo is what they were responding to; it is evidence about context, not the learner's words. Judge only the learner's text.

uses: expressions in the learner's text worth tracking at this level, cited as a dictionary or grammar would cite them: 透透气, 本来想…结果…, 只是. Skip basic vocabulary such as 我, 今天, 很, 是, 去. A construction such as 越来越 or 一…就… counts as one use. quality is natural when a native speaker would accept it in this context; flawed when the meaning, collocation, word order or register is off. Credit a natural alternative to what you would have said. Expressions listed in knownInText are already in the learner's journal; cite them in exactly that form when the text uses them.

needs: places where the text shows the learner reaching for something they did not have. Strong evidence: English or pinyin inserted into Mandarin (我老是 get distracted needs 分心 or 走神), an explicit "how do I say", a roundabout description of something with a common name, or an error a specific expression would fix (等着鸟来喂 when they mean the bird comes to eat: 来吃). Give the reusable expression a natural speaker would reach for in this situation, cited in its dictionary form rather than as a whole sentence: for "the meeting got dragged out", 拖 or 拖了很久, not 会开得太久了. Quote the exact learner words in evidence. Do not record a need merely because a fancier or more idiomatic option exists when the learner's wording is natural, and do not diagnose a general deficit from one line. A single use or miss establishes no mastery or deficit; you are recording an observation, not a verdict. English questions to the tutor about a meaning or usage are needs for the expression asked about.

intended: for an exercise answer with intended forms, say for each whether the answer used it naturally, used it with a flaw, or avoided it. Avoided means the answer communicated without that form; that is not an error. For the exercise, an answer like 我只是看了一眼 for a prompt about merely glancing uses 只是 naturally even if the reference answer differs.

tutorSaid, when present, is what the tutor already told the learner about this text. The learner hears one tutor, so stay consistent with it: if the tutor accepted a phrasing, do not record it as flawed, and expressions the tutor offered are not additional needs; a need still comes only from the learner's own words, as when they asked how to say something. If you are confident the tutor was wrong, keep your own judgment and begin that entry's note with "Disagrees with tutor:" and the reason.

For kind reflect, tutorSaid holds the tutor's reflection on that stretch: an overview and takeaways quoting the learner. The learner has just read them. Record flaws and needs only where those takeaways addressed them, so practice follows what the learner was shown; leave other problems for the tutor to raise another time. Uses may come from any line.

communicated: whether the Mandarin got the intended meaning across: clear, partial or unclear. null when the text contains no Mandarin.

Return empty lists when there is nothing worth recording. Most casual lines yield zero or one use and no need.`,
  schema,
  buildInput: (input) => ({ ...input.notice }),
  validate(result, input) {
    rejectOtherEffects(result, ['notice']);
    const request = input.notice;
    if (!request) throw new Error('Missing notice request');
    const n = result.notice;
    if (!n) throw new Error('The judgment returned no notice');
    const forms = [...n.uses.map((u) => u.form), ...n.needs.map((x) => x.form)];
    for (const form of forms) {
      if (!form.trim() || form.length > 40 || !han.test(form)) throw new Error('A noticed form must be a short Chinese expression');
    }
    if (n.uses.length > 6 || n.needs.length > 3) throw new Error('Too many noticed expressions');
    for (const need of n.needs) {
      if (!need.evidence.trim() || !request.text.includes(need.evidence.trim()))
        throw new Error('A need must quote the learner text exactly');
    }
    if (n.intended.length !== request.intended.length || n.intended.some((x, i) => x.form !== request.intended[i]))
      throw new Error('Report each intended form once, in order');
    if (!han.test(request.text) && n.communicated !== null) throw new Error('No Mandarin to judge communication');
    return {
      communicated: n.communicated,
      uses: n.uses.map((u) => ({ ...u, form: u.form.trim() })),
      needs: n.needs.map((x) => ({ ...x, form: x.form.trim(), evidence: x.evidence.trim() })),
      intended: n.intended,
    };
  },
};

/** A notice from the offline demo: known forms count as natural uses, a few scripted needs. */
export function demoNotice(input: TurnContext): Notice {
  const request = input.notice;
  if (!request) throw new Error('Missing notice request');
  const text = request.text;
  const needs: Notice['needs'] = [];
  const scripted: [RegExp, string, string][] = [
    [/get distracted/i, '分心', 'be distracted'],
    [/fresh air/i, '透透气', 'get some fresh air'],
  ];
  for (const [pattern, form, gloss] of scripted) {
    const evidence = text.match(pattern)?.[0];
    if (evidence && !text.includes(form)) needs.push({ form, kind: 'word', gloss, evidence, note: '' });
  }
  return {
    communicated: han.test(text) ? 'clear' : null,
    uses: request.knownInText.slice(0, 6).map((form) => ({ form, kind: 'word', quality: 'natural', note: '' })),
    needs,
    intended: request.intended.map((form) => ({ form, outcome: text.includes(form) ? 'natural' : 'avoided' })),
  };
}
