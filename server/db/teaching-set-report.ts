import { getDb } from './connection.ts';
import { teachingSenseIds } from './teaching-sense-sets.ts';

/** Operator-only aggregation: shared sets and preparation spend, without learner choices or text. */
export function getTeachingSetReport() {
  const rows = getDb().prepare(`WITH sets AS (
      SELECT word_id,teaching_set_key FROM word_introduction_preparation
      UNION SELECT word_id,teaching_set_key FROM word_content_documents
      UNION SELECT word_id,teaching_set_key FROM word_preparation_work
    ), packages AS (
      SELECT d.word_id,d.teaching_set_key,COUNT(p.package_id) AS package_count
      FROM word_content_documents d JOIN word_teaching_packages p ON p.content_id=d.content_id
      GROUP BY d.word_id,d.teaching_set_key
    ), invocations AS (
      SELECT DISTINCT w.word_id,w.teaching_set_key,i.id,i.spend_usd
      FROM word_preparation_work w JOIN word_preparation_attempts a ON a.work_id=w.work_id
      JOIN model_invocations i ON i.workflow_id=a.attempt_id
    ), costs AS (
      SELECT word_id,teaching_set_key,COUNT(*) AS invocation_count,SUM(spend_usd) AS recorded_cost,
        SUM(spend_usd IS NULL) AS unpriced_count FROM invocations GROUP BY word_id,teaching_set_key
    ) SELECT sets.word_id AS wordId,w.hanzi,sets.teaching_set_key AS setKey,
      COALESCE(packages.package_count,0) AS packageCount,COALESCE(costs.invocation_count,0) AS invocationCount,
      costs.recorded_cost AS recordedCostUsd,COALESCE(costs.unpriced_count,0) AS unpricedInvocationCount
    FROM sets JOIN lexical_words w ON w.id=sets.word_id
    LEFT JOIN packages USING(word_id,teaching_set_key) LEFT JOIN costs USING(word_id,teaching_set_key)
    ORDER BY w.hanzi,sets.word_id,sets.teaching_set_key`).all() as Array<{
      wordId:string;hanzi:string;setKey:string;packageCount:number;invocationCount:number;
      recordedCostUsd:number|null;unpricedInvocationCount:number;
    }>;
  return {sets:rows.map(row=>({...row,senseCount:teachingSenseIds(row.setKey)?.length ?? null}))};
}
