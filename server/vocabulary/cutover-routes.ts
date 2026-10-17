import type { RequestHandler } from 'express';
import type { StudyProfileId } from '../../src/study-profile.ts';

/** Stale clients must not write learner state or content through the retired Mandarin model. */
export function createVocabularyCutoverFence(profile: StudyProfileId): RequestHandler {
  return (req,res,next) => {
    if (profile !== 'mandarin') { next(); return; }
    const path = req.path.toLowerCase();
    const write = !['GET','HEAD','OPTIONS'].includes(req.method);
    const legacyOperatorWrite = write && /^\/operator\/content-improvements(?:\/|$)/.test(path);
    // GET also composes legacy work and reconciles preparation; it is not a historical read.
    const legacyComposition = req.method !== 'OPTIONS' && /^\/session-payload\/?$/.test(path);
    const legacyStudyWrite = write && (
      /^\/study-sessions(?:\/|$)/.test(path)
      || /^\/words\/[^/]+\/(?:complete-learning-session|complete-unstudied-session|dismiss)\/?$/.test(path)
      || /^\/words\/[^/]+\/introduction\/(?:open|complete)\/?$/.test(path)
      || /^\/(?:review-session-summaries|study-management|reflection-proposals|reflection-operations|reflection-invocations|reflection-artifacts|reflection-generation-runs|deferred-reflection-second-opinions)(?:\/|$)/.test(path)
    );
    if (legacyOperatorWrite || legacyComposition || legacyStudyWrite) {
      res.status(409).json({
        error: legacyOperatorWrite
          ? 'Content editing has moved. Use Vocabulary content review to change current study content.'
          : 'Study has been updated. Reload the app to continue.',
        code: 'VOCABULARY_CUTOVER',
      });
      return;
    }
    next();
  };
}
