import { type PureCueAcceptedAnswer, type PureCueServedSnapshot } from '../../src/domain/pure-cues.ts';
import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';

type ServedSnapshotRow = {
  snapshot_id: string;
  pure_cue_id: string;
  served_at: string;
  stimulus: string;
  axis_note: string;
  teaching_note: string;
  accepted_answers_json: string;
  consumed_attempt_id: string | null;
};

export function getPureCueServedSnapshot(snapshotId: string): PureCueServedSnapshot | null {
  const learnerId = requireLearnerId();
  const row = getDb().prepare(`
    SELECT * FROM pure_cue_served_snapshots
    WHERE learner_id = ? AND snapshot_id = ?
  `).get(learnerId, snapshotId) as ServedSnapshotRow | undefined;
  return row ? mapServedSnapshotRow(row) : null;
}

function mapServedSnapshotRow(row: ServedSnapshotRow): PureCueServedSnapshot {
  return {
    snapshotId: row.snapshot_id,
    pureCueId: row.pure_cue_id,
    servedAt: row.served_at,
    stimulus: row.stimulus,
    axisNote: row.axis_note,
    teachingNote: row.teaching_note,
    acceptedAnswers: JSON.parse(row.accepted_answers_json) as PureCueAcceptedAnswer[],
  };
}
