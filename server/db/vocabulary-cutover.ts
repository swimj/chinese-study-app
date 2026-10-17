import type { DatabaseSync } from 'node:sqlite';

/** Run before copying learner state: pending effects must close under their original runtime. */
export function assertVocabularyCutoverReady(db:DatabaseSync):void {
  const pending=db.prepare("SELECT COUNT(*) AS count FROM learner_session_completions WHERE status IN ('pending','failed')").get() as {count:number};
  const applications=db.prepare("SELECT COUNT(*) AS count FROM learner_owned_reflection_operation_invocations WHERE application_state='pending'").get() as {count:number};
  if(pending.count||applications.count)throw new Error(`Vocabulary cutover requires settling legacy effects first: ${pending.count} session completions, ${applications.count} authorized reflection applications. The migration transaction is rolled back. Settle these effects using the previous runtime before retrying migration.`);
}
