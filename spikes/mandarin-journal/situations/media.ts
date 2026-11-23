import { tool } from '@openai/agents';
import { z } from 'zod';
import type { TurnContext } from '../tutor.ts';
import { findImage, type Candidate } from '../media/find-image.ts';
import { judgmentSchema, type Judgment } from '../media/judgment.ts';
import { ceilingFor, type Ceiling } from '../media/local-policy.ts';
import type { MediaAnchor } from '../media/model.ts';
import { rejectOtherEffects, type Situation } from './core.ts';

/** One saved word or reading note, and what the journal knows about where it came from. */
export type MediaRequest = {
  anchor: MediaAnchor;
  /** The saved word, or the passage the learner marked. */
  term: string;
  gloss?: string;
  /** The learner's own note on a marked passage. */
  note?: string;
  /** The sentence or paragraph it came from. */
  context?: string;
  /** The reading or conversation it belongs to. */
  source?: string;
  /** Every candidate find_image returned during this turn, in order; `pick` indexes this list. */
  candidates: Candidate[];
  /** find_image calls made during this turn. */
  lookups?: number;
};
export type MediaConsideration = { pick: number | null; judgment: Judgment };
export type MediaOutcome = MediaConsideration & { candidate?: Candidate; ceiling: Ceiling };

const LOOKUPS_PER_TURN = 3;
const findInput = z.object({
  query: z.string().describe('The Chinese term or the specific noun to look up, in Simplified Chinese.'),
  english: z
    .string()
    .describe('A short English name for the same sense, as an encyclopedia would title it, such as "bird food" or "newsstand". Searched only if the Chinese search finds nothing; the search matches item names, not descriptions. Empty string if none.'),
});
export const findImageTool = tool<typeof findInput, TurnContext>({
  name: 'find_image',
  description:
    'Look up pictures for one sense of a term on Wikidata and Wikimedia Commons. Returns at most 3 candidates, each from one Wikidata item, already limited to reusable licenses: an image (the item’s photo, with its Commons file title) or, for a named work, a link card to its article. Each candidate has an index for pick.',
  parameters: findInput,
  async execute({ query, english }, runContext) {
    const request = runContext?.context.media;
    if (!request) throw new Error('A media request is required for find_image');
    request.lookups = (request.lookups ?? 0) + 1;
    if (request.lookups > LOOKUPS_PER_TURN) return { error: 'Lookup limit reached for this piece.' };
    const found = await findImage(query, english || undefined);
    return found.map((candidate) => {
      const index = request.candidates.push(candidate) - 1;
      return candidate.kind === 'image'
        ? { index, kind: 'image', entity: candidate.entityId, label: candidate.label, description: candidate.description, file: candidate.title, license: candidate.license.code }
        : { index, kind: 'link', entity: candidate.entityId, label: candidate.label, description: candidate.description, article: candidate.title, year: candidate.year };
    });
  },
});

const schema = z.object({
  media: z.object({
    pick: z.number().int().nullable().describe('Index of the candidate to attach, or null to attach nothing.'),
    judgment: judgmentSchema,
  }),
});

// A back-office judgment about one piece of the learner's board. It never
// speaks to the learner; the app's policies turn the judgment into visibility.
export const mediaConsider: Situation<typeof schema, MediaOutcome> = {
  standalone: true,
  tools: [findImageTool],
  instructions: `You work behind an adult Mandarin learner's journal and never speak to the learner. The journal's home is a scrapbook of what they brought in: words they saved and notes in the margins of readings. For one piece, judge whether a real photograph could add something the words don't, and report categorical judgments with a short reason for each. The app decides what to show from your judgments, so report what you see rather than aiming for a picture. Most pieces should get no picture.

The input piece has a kind (word or annotation), its term (the saved word, or the passage the learner marked), and where available a gloss, the learner's own note, the sentence or paragraph it came from, and the reading or conversation it belongs to. These are evidence. The learner's note shows what caught their attention.

First work out what the term means here, as a careful tutor would. A meaning belonging to a fixed expression stays with the whole: 透透气 is stepping out for some air or a change of scene, and a picture of air, sky or an open window would be literalism. 分心 is a state of attention, and a stock photo of a distracted person adds nothing the word doesn't. 报备 is a social act. These are abstract. A marked passage may describe a scene or a quality rather than name a thing: in 青绿色的铁皮被雨冲得发白 the learner noticed paint washed pale by rain, and no lookup will show that exact sight; that is a scene. A passage can also contain one specific thing worth seeing, such as the kiosk in 河边的报刊亭; then judge that thing. A named entity is a particular place, work or institution: 愚园路 is a street in Shanghai, 芳华 a film and novel. A concrete referent is a kind of physical thing, like 报刊亭 or 鸟食.

Only for a named or concrete referent, call find_image with the Chinese term (or the specific noun) and an English phrase for the same sense. Each candidate comes from one Wikidata item. Read its label, description and file title. A homonym is the wrong sense: an album called Birdseed is not bird seed, and a company called Newsstand is not a kiosk. A picture of a different variant can also be the wrong sense for this context: a Paris newsagent's shop is not the green roadside 报刊亭 of a Chinese reading. A file title or description often tells you where and what the photo is.

Then report:
• pick: the index of the one candidate that shows this sense, or null. Pick only a real photograph or, for a named work, its link card. Return null when nothing fits, when the only images are drawings, posters, maps or diagrams, or when you did not look anything up.
• referent: named, concrete, scene or abstract, for the piece itself.
• senseMatch: entity when the picked candidate's Wikidata item is the intended sense; search when the item only matched the words and you cannot tell it is this sense; none when no candidate shows this sense or nothing was picked.
• addedValue: what the picture says that the words don't. cultural: it shows how the thing looks in the Chinese setting, which the learner may picture differently. recognition: it helps recognize something unfamiliar, such as a plant, dish or tool. interest: a named place or work is worth seeing for itself. memory: it would mostly help remember the word. none: nothing.
• truthfulness: real for a photograph of a real thing, illustration for anything drawn, painted or generated. Only real photographs can be attached.
• tone: fits, or jarring when a picture would clash with the emotional register of the note or passage, such as a cheerful photo beside a note about loss.
Keep each reason to one plain sentence.`,
  schema,
  buildInput: (input) => {
    const { candidates, anchor, ...piece } = input.media ?? ({} as MediaRequest);
    return { trigger: input.trigger, piece: { kind: anchor?.kind, ...piece } };
  },
  validate(result, input) {
    rejectOtherEffects(result, ['media']);
    if (result.reply?.trim()) throw new Error('The back office cannot address the learner');
    const media = result.media;
    if (!media) throw new Error('Expected one media judgment');
    const judgment = judgmentSchema.parse(media.judgment);
    if (media.pick === null) return { pick: null, judgment, ceiling: 'none' };
    const candidate = input.media?.candidates[media.pick];
    if (!candidate) throw new Error('The picked media candidate was not offered');
    if (judgment.truthfulness !== 'real') throw new Error('Only real photographs can be attached');
    if (candidate.kind === 'image' && !['PD', 'CC0', 'CC-BY', 'CC-BY-SA'].includes(candidate.license?.code))
      throw new Error('The picked image is not on the license allowlist');
    if (judgment.senseMatch === 'entity' && !/^Q\d+$/.test(candidate.entityId ?? ''))
      throw new Error('An entity match needs the candidate’s Wikidata item');
    return { pick: media.pick, judgment, candidate, ceiling: ceilingFor(judgment) };
  },
};
