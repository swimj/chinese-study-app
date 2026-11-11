import { getActiveServiceBanner, dbConfig, getWordStatusCounts, getReviewFailureRateDays, getSessionActiveTimeMetrics, isDietDeckModeActive, toPublicServiceBanner, getLearningPolicy, getCharacterPresentation, getSentenceCharacterPresentation, getStudyNewWordsFirst, getStudyIntroductionOrder, getStudyIntroductionSpacing, setDailyNewWordLimit, setUnstudiedAdmissionSource, setCharacterPresentation, setStudyIntroductionOrder, setStudyNewWordsFirst, setSentenceCharacterPresentation } from '../db.ts';
import { getDailyStudyMinutes, vocabularyTimedSessionsEnabled, setDailyStudyMinutes, VocabularyTimedSessionInputError } from '../db/vocabulary-timed-sessions.ts';
import { getDebriefInterests } from '../db/session-debrief.ts';
import { isStudyIntroductionOrder, isStudyIntroductionSpacing } from '../../src/domain/introduction-order.ts';
import { readStudyDayKeyFromQuery } from './request-helpers.ts';
import type { Express } from 'express';

/** Learner status, learning policy, and display and study settings. */
export function registerLearnerSettingsRoutes(app: Express): void {
  app.get('/api/status', (req, res) => {
    const studyDayKey = readStudyDayKeyFromQuery(req.query?.studyDayKey);
    if (!studyDayKey) {
      res.status(400).json({ error: 'Expected YYYY-MM-DD studyDayKey query parameter' });
      return;
    }

    const banner = getActiveServiceBanner();
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      mode: dbConfig.mode,
      studyProfile: dbConfig.studyProfile,
      dataDir: dbConfig.dataDir,
      dbPath: dbConfig.dbPath,
      wordStatusCounts: getWordStatusCounts(),
      reviewFailureRateDays: getReviewFailureRateDays(),
      sessionActiveTimeMetrics: getSessionActiveTimeMetrics(studyDayKey),
      dietDecksActive: isDietDeckModeActive(),
      serviceBanner: banner ? toPublicServiceBanner(banner) : null,
      ...getLearningPolicy(studyDayKey),
      characterPresentation: getCharacterPresentation(),
      sentenceCharacterPresentation: getSentenceCharacterPresentation(),
      studyNewWordsFirst: getStudyNewWordsFirst(),
      studyIntroductionOrder: getStudyIntroductionOrder(),
      studyIntroductionSpacing: getStudyIntroductionSpacing(),
      dailyStudyMinutes: getDailyStudyMinutes().minutes,
      timedSessions: vocabularyTimedSessionsEnabled(),
      debriefInterests: getDebriefInterests(),
    });
  });
  app.patch('/api/learner-settings/daily-study-minutes', (req, res) => {
    try {
      res.json(setDailyStudyMinutes(req.body?.dailyStudyMinutes));
    } catch (error) {
      if (error instanceof VocabularyTimedSessionInputError) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to update daily study time' });
    }
  });
  app.patch('/api/learning-policy/daily-new-word-limit', (req, res) => {
    const dailyNewWordLimit = req.body?.dailyNewWordLimit;

    try {
      res.json(setDailyNewWordLimit(dailyNewWordLimit));
    } catch (error) {
      if (error instanceof Error && error.message === 'Expected integer dailyNewWordLimit between 0 and 20') {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to update daily new-word limit' });
    }
  });
  app.patch('/api/learning-policy/unstudied-admission-source', (req, res) => {
    const unstudiedAdmissionSource = req.body?.unstudiedAdmissionSource;

    try {
      res.json(setUnstudiedAdmissionSource(unstudiedAdmissionSource));
    } catch (error) {
      if (error instanceof Error && error.message === 'Expected unstudiedAdmissionSource to be "mixed" or "stash_only"') {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to update unstudied admission source' });
    }
  });
  app.patch('/api/learner-settings/character-presentation', (req, res) => {
    const characterPresentation = req.body?.characterPresentation;

    try {
      res.json(setCharacterPresentation(characterPresentation));
    } catch (error) {
      if (
        error instanceof Error
        && error.message === 'Expected characterPresentation to be "simplified", "traditional", or "both"'
      ) {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to update character presentation' });
    }
  });
  app.patch('/api/learner-settings/study-introduction-order', (req, res) => {
    const { studyIntroductionOrder, studyIntroductionSpacing } = req.body ?? {};
    if (!isStudyIntroductionOrder(studyIntroductionOrder)) {
      res.status(400).json({ error: 'Expected studyIntroductionOrder to be random, first or paced' });
      return;
    }
    if (!isStudyIntroductionSpacing(studyIntroductionSpacing)) {
      res.status(400).json({ error: 'Expected integer studyIntroductionSpacing between 1 and 10' });
      return;
    }
    try {
      res.json(setStudyIntroductionOrder(studyIntroductionOrder, studyIntroductionSpacing));
    } catch {
      res.status(500).json({ error: 'Failed to update introduction ordering' });
    }
  });
  app.patch('/api/learner-settings/study-new-words-first', (req, res) => {
    if (typeof req.body?.studyNewWordsFirst !== 'boolean') {
      res.status(400).json({ error: 'Expected studyNewWordsFirst to be a boolean' });
      return;
    }
    try {
      res.json(setStudyNewWordsFirst(req.body.studyNewWordsFirst));
    } catch {
      res.status(500).json({ error: 'Failed to update new-word ordering' });
    }
  });
  app.patch('/api/learner-settings/sentence-character-presentation', (req, res) => {
    try {
      res.json(setSentenceCharacterPresentation(req.body?.sentenceCharacterPresentation));
    } catch (error) {
      if (
        error instanceof Error
        && error.message === 'Expected sentenceCharacterPresentation to be "simplified" or "traditional"'
      ) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to update sentence character presentation' });
    }
  });
}
