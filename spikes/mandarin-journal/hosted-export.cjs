// Runs on the hosted app's machine and prints one learner's vocabulary state as
// JSON: words, schedules and a per-word summary of production recall. Opens the
// database read-only. See RUNBOOK.md, "Bring in hosted history".
const { DatabaseSync } = require('node:sqlite');

const learner = process.env.EXPORT_LEARNER || 'dogfood-local';
const db = new DatabaseSync(process.env.EXPORT_DB || '/data/app.db', { readOnly: true });
const words = new Map();
for (const r of db
  .prepare(
    `SELECT w.id, w.hanzi, w.pinyin, w.meaning, lw.mode, lw.in_stash, lw.dismissed_at, lw.added_at,
            s.last_practised_at, coalesce(s.review_due_at, s.next_eligible_at) AS due_at, s.interval_hours
       FROM learner_words lw JOIN lexical_words w ON w.id = lw.word_id
       LEFT JOIN learner_word_schedules s ON s.learner_id = lw.learner_id AND s.word_id = lw.word_id
      WHERE lw.learner_id = ?`,
  )
  .iterate(learner))
  words.set(r.id, {
    hanzi: r.hanzi, pinyin: r.pinyin, meaning: r.meaning, mode: r.mode, inStash: r.in_stash === 1,
    dismissedAt: r.dismissed_at, addedAt: r.added_at, lastPractisedAt: r.last_practised_at, dueAt: r.due_at,
    intervalHours: r.interval_hours, attempts: 0, incorrect: 0, lastIncorrectAt: null, recentMistakes: [],
  });

function count(wordId, at, correct, response) {
  const w = words.get(wordId);
  if (!w) return;
  w.attempts++;
  if (correct) return;
  w.incorrect++;
  if (!w.lastIncorrectAt || at > w.lastIncorrectAt) w.lastIncorrectAt = at;
  if (response && response.trim()) w.recentMistakes.push([at, response.trim()]);
}
// Before the October cutover.
for (const r of db
  .prepare(`SELECT target_word_id, occurred_at, outcome, response FROM learner_owned_study_attempt_events
             WHERE learner_id = ? AND action_kind = 'production'`)
  .iterate(learner))
  count(r.target_word_id, r.occurred_at, r.outcome === 'correct', r.response);
// Adaptive sessions since.
for (const r of db
  .prepare(`SELECT coalesce(a.word_id, e.selected_through_word_id) AS word_id, a.occurred_at,
                   json_extract(a.action_json, '$.payload.outcome') AS outcome,
                   json_extract(a.action_json, '$.payload.response') AS response
              FROM session_actions a JOIN exercise_encounters e ON e.encounter_id = a.encounter_id
             WHERE a.learner_id = ? AND a.kind = 'response'
               AND json_extract(e.served_snapshot_json, '$.kind') = 'production'`)
  .iterate(learner))
  count(r.word_id, r.occurred_at, r.outcome === 'accepted', r.response);

const out = [...words.values()].map((w) => ({
  ...w,
  recentMistakes: w.recentMistakes.sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 3).map((m) => m[1]),
}));
process.stdout.write(JSON.stringify({ exportedAt: new Date().toISOString(), learner, words: out }));
