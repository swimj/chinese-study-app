import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { loadDeckManifest } from '../decks/manifest.ts';
import { getStoredDietProfile, resolveEffectiveDietWeights } from './diet-profile.ts';
import { getResolvedDeckWordIds, queryDeckWordStudyDates } from './deck-words.ts';
import { compareWordBrowserEntries, myWordsRecentLapseSinceDay, type MyWordsView } from '../../src/domain/my-words.ts';
import { VOCABULARY_WORD_MODES, type VocabularyWordsCollection, type VocabularyCollectionWord } from '../../src/domain/vocabulary-words.ts';
import type { VocabularyWordMode } from '../../src/domain/vocabulary-session.ts';
import { VocabularyStateInputError } from './vocabulary-learners.ts';

type Row = {id:string; hanzi:string; traditional:string|null; pinyin:string; meaning:string; meanings_json:string;
  personal_notes:string|null; mode:VocabularyWordMode; state_version:number|null; next_eligible_at:string|null;
  refresh_until:string|null; last_practised_at:string|null; personal_updated_at:string|null};

/** Collection membership is retained; current lifecycle is always read from vocabulary state. */
export function getVocabularyWordsCollection({view='recent', query='', modes=[], recentLapses=false, limit=50, offset=0}: {
  view?: MyWordsView; query?:string; modes?:readonly VocabularyWordMode[]; recentLapses?:boolean; limit?:number; offset?:number;
} = {}): VocabularyWordsCollection {
  if (!['recent','personal','deck'].includes(view) || typeof query !== 'string' || modes.some(mode => !VOCABULARY_WORD_MODES.includes(mode))
    || !Number.isSafeInteger(limit) || limit<1 || limit>100 || !Number.isSafeInteger(offset) || offset<0) throw new VocabularyStateInputError('Invalid word collection filters');
  const learner = requireLearnerId(), db = getDb();
  const manifest = loadDeckManifest();
  const profile = manifest ? getStoredDietProfile() : null;
  const weights = manifest && profile ? resolveEffectiveDietWeights(profile, manifest) : {};
  const decks = manifest?.decks.filter(deck => (weights[deck.id] ?? 0)>0) ?? [];
  const currentDeck = decks.length && decks.every(deck=>deck.hsk!==null)
    ? {label:decks.map(deck=>`HSK ${deck.hsk!.level}${deck.stratum===null?'':` · part ${deck.stratum}`}`).join(' + ')} : null;
  if(view==='deck'&&!currentDeck) return {words:[],total:0,hasMore:false,currentDeck:null};
  const deckIds = manifest ? getResolvedDeckWordIds(manifest) : new Map<string,readonly string[]>();
  const ids = [...new Set(decks.flatMap(deck=>deckIds.get(deck.id)??[]))];
  const rows = db.prepare(`SELECT w.id,w.hanzi,w.traditional,w.pinyin,w.meaning,w.meanings_json,
    personal.personal_notes,COALESCE(l.mode,'unstudied') AS mode,l.state_version,
    s.next_eligible_at,s.refresh_until,s.last_practised_at,
    CASE WHEN p.priority_tier>=0 THEN p.updated_at ELSE NULL END AS personal_updated_at
    FROM lexical_words w LEFT JOIN learner_words l ON l.word_id=w.id AND l.learner_id=?
    LEFT JOIN learner_word_schedules s ON s.word_id=w.id AND s.learner_id=?
    LEFT JOIN words personal ON personal.id=w.id
    LEFT JOIN user_word_priority p ON p.word_id=w.id
    WHERE ${view==='deck' ? "w.id IN (SELECT value FROM json_each(?)) AND (l.word_id IS NOT NULL OR p.priority_tier IS NULL OR p.priority_tier>=0)" : view==='personal' ? 'l.in_stash=1' : "l.mode!='unstudied'"}
    AND l.dismissed_at IS NULL`).all(learner,learner,...(view==='deck'?[JSON.stringify(ids)]:[])) as Row[];
  // Historical dates remain useful after cutover, without consulting old lifecycle state.
  const dates = new Map(queryDeckWordStudyDates(rows.map(row=>row.id)));
  for(const row of rows) if(row.last_practised_at) dates.set(row.id, latest(dates.get(row.id),row.last_practised_at));
  const since = myWordsRecentLapseSinceDay(new Date().toISOString().slice(0,10));
  const lapses = new Set<string>();
  const candidateIds=JSON.stringify(rows.map(row=>row.id));
  // Aggregate inside SQLite: never hydrate retained teaching snapshots or the learner's entire history.
  // Closed projections already interpret Undo; raw response logs would resurrect undone misses.
  const observations=db.prepare(`WITH candidates AS (SELECT value AS id FROM json_each(?)),
    responses AS (
      SELECT json_extract(e.value,'$.wordId') AS id,
        MAX(substr(json_extract(r.value,'$.occurredAt'),1,10)) AS studied,
        MAX(CASE WHEN json_extract(r.value,'$.payload.outcome')='rejected'
          THEN substr(json_extract(r.value,'$.occurredAt'),1,10) END) AS rejected
      FROM vocabulary_session_completions c,json_each(c.report_json,'$.encounters') e,
        json_each(e.value,'$.effectiveResponses') r
      WHERE c.learner_id=? AND c.status='closed'
        AND json_extract(e.value,'$.wordId') IN (SELECT id FROM candidates)
        AND COALESCE(json_extract(e.value,'$.snapshot.schedulingScope'),'word')!='pure_cue'
      GROUP BY json_extract(e.value,'$.wordId')
    ), clean AS (
      SELECT w.key AS id,MAX(substr(c.closed_at,1,10)) AS clean_on
      FROM vocabulary_session_completions c,json_each(c.report_json,'$.words') w
      WHERE c.learner_id=? AND c.status='closed' AND w.key IN (SELECT id FROM candidates)
        AND json_extract(w.value,'$.covered')=1 AND json_extract(w.value,'$.successfulRecall')=1
        AND json_extract(w.value,'$.hasRejectedResponse')=0 GROUP BY w.key
    ) SELECT candidates.id,responses.studied,responses.rejected,clean.clean_on FROM candidates
      LEFT JOIN responses USING(id) LEFT JOIN clean USING(id)`)
    .all(candidateIds,learner,learner) as {id:string;studied:string|null;rejected:string|null;clean_on:string|null}[];
  const cleanDates=new Map<string,string>();
  for(const row of observations) {
    if(row.studied) dates.set(row.id,latest(dates.get(row.id),row.studied));
    if(row.rejected&&row.rejected>=since) lapses.add(row.id);
    if(row.clean_on) cleanDates.set(row.id,row.clean_on);
  }
  if(recentLapses) {
    const legacy=db.prepare(`SELECT target_word_id AS id,NULL AS learning_lapse FROM study_attempt_events
      WHERE projected_at IS NOT NULL AND (outcome='incorrect' OR rating='forgot') AND substr(occurred_at,1,10)>=?
        AND target_word_id IN (SELECT value FROM json_each(?))
      UNION SELECT id,last_learning_covered_on AS learning_lapse FROM words
      WHERE last_learning_success_on IS NOT NULL AND last_learning_covered_on>last_learning_success_on
        AND last_learning_covered_on>=? AND id IN (SELECT value FROM json_each(?))`)
      .all(since,candidateIds,since,candidateIds) as {id:string;learning_lapse:string|null}[];
    for(const row of legacy) {
      // Legacy learning counters stop changing at cutover; newer clean coverage supersedes them.
      if(!row.learning_lapse || (cleanDates.get(row.id)??'')<row.learning_lapse) lapses.add(row.id);
    }
  }
  let allowed = modes.length ? modes : VOCABULARY_WORD_MODES;
  if(view==='recent') { allowed=allowed.filter(mode=>mode!=='unstudied'); if(!allowed.length) allowed=VOCABULARY_WORD_MODES.filter(mode=>mode!=='unstudied'); }
  const search=query.trim().toLowerCase();
  const entries:VocabularyCollectionWord[]=rows.filter(row=>allowed.includes(row.mode)&&(!recentLapses||lapses.has(row.id)))
    .map(row=>({word:{id:row.id,hanzi:row.hanzi,traditional:row.traditional,pinyin:row.pinyin,meaning:row.meaning,
      meanings:JSON.parse(row.meanings_json) as string[],personalNotes:row.personal_notes??'',status:row.mode},
      lastStudiedAt:dates.get(row.id)??null,personalUpdatedAt:row.personal_updated_at,stateVersion:row.state_version,
      nextEligibleAt:row.next_eligible_at,refreshUntil:row.refresh_until}))
    .filter(({word})=>[word.hanzi,word.traditional??'',word.pinyin,word.meaning,...word.meanings].some(value=>value.toLowerCase().includes(search)));
  const rank:Record<VocabularyWordMode,number>={solidify:0,unstudied:1,practice:2,maintain:3};
  entries.sort((a,b)=>compareWordBrowserEntries(a,b,rank));
  return {words:entries.slice(offset,offset+limit),total:entries.length,hasMore:entries.length>offset+limit,currentDeck};
}
function latest(a:string|null|undefined,b:string):string {const day=b.slice(0,10);return !a||a<day?day:a;}
