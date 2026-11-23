// Offline media judgments for the demo tutor and the fixture. Canned candidates
// stand in for find_image so the fixture shows one placed picture (报刊亭) and
// one latent picture (鸟食) without any network call. The files are real
// Commons files with their real licenses and authors.
import type { TutorResult } from '../tutor.ts';
import type { Candidate } from './find-image.ts';
import type { Judgment } from './judgment.ts';

export class OfflineMediaUnavailable extends Error {}

const kiosk: Candidate = {
  kind: 'image',
  entityId: 'Q1528905',
  label: '報攤',
  description: '賣報紙的人或店舖',
  title: 'File:宾阳报刊亭.jpg',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:%E5%AE%BE%E9%98%B3%E6%8A%A5%E5%88%8A%E4%BA%AD.jpg',
  thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/%E5%AE%BE%E9%98%B3%E6%8A%A5%E5%88%8A%E4%BA%AD.jpg/960px-%E5%AE%BE%E9%98%B3%E6%8A%A5%E5%88%8A%E4%BA%AD.jpg',
  width: 640,
  height: 427,
  license: { code: 'CC-BY', url: 'https://creativecommons.org/licenses/by/4.0' },
  credit: { author: 'Lt2818', text: 'Lt2818 · CC BY 4.0 · Wikimedia Commons' },
};
const birdFood: Candidate = {
  kind: 'image',
  entityId: 'Q471236',
  label: 'bird food',
  description: 'food fed to birds',
  title: 'File:Parus caeruleus 5 Luc Viatour.jpg',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Parus_caeruleus_5_Luc_Viatour.jpg',
  thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Parus_caeruleus_5_Luc_Viatour.jpg/960px-Parus_caeruleus_5_Luc_Viatour.jpg',
  width: 640,
  height: 482,
  license: { code: 'CC-BY-SA', url: 'http://creativecommons.org/licenses/by-sa/3.0/' },
  credit: { author: 'Luc Viatour', text: 'Luc Viatour · CC BY-SA 3.0 · Wikimedia Commons' },
};

const judge = (referent: Judgment['referent'], senseMatch: Judgment['senseMatch'], addedValue: Judgment['addedValue'], why: string): Judgment => ({
  referent, senseMatch, addedValue, truthfulness: 'real', tone: 'fits',
  reasons: { referent: why, senseMatch: why, addedValue: why, truthfulness: 'A photograph.', tone: 'Neutral.' },
});
const canned: { match: RegExp; candidates: Candidate[]; pick: number | null; judgment: Judgment }[] = [
  { match: /什么人|冲得发白/, candidates: [], pick: null, judgment: judge('scene', 'none', 'none', 'The note is about wording, not a thing to see.') },
  { match: /报刊亭/, candidates: [kiosk], pick: 0, judgment: judge('concrete', 'entity', 'cultural', 'A Chinese roadside newspaper kiosk looks unlike a Western newsstand.') },
  { match: /鸟食/, candidates: [birdFood], pick: 0, judgment: judge('concrete', 'entity', 'memory', 'Bird food is familiar; a picture mostly helps remember the word.') },
  { match: /^(透透气|分心|报备|容易分心)$/, candidates: [], pick: null, judgment: judge('abstract', 'none', 'none', 'An act or state, not something a photograph shows.') },
];

export function demoMedia(input: { media?: { term: string; candidates: Candidate[] } }): TutorResult {
  const request = input.media;
  if (!request) throw new Error('Missing media request');
  const entry = canned.find((c) => c.match.test(request.term));
  if (!entry) throw new OfflineMediaUnavailable('No offline picture judgment for this piece.');
  const offset = request.candidates.length;
  request.candidates.push(...entry.candidates);
  return { media: { pick: entry.pick === null ? null : offset + entry.pick, judgment: entry.judgment } };
}
