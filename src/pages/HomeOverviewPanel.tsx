
export { SettingsGearIcon } from '../components/SessionStartCard';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_INTRODUCTION_SPACING, MAX_INTRODUCTION_SPACING, isStudyIntroductionOrder, type StudyIntroductionOrder } from '../domain/introduction-order';
import type { BackendStatus, UnstudiedAdmissionSource } from '../services/api';
import type { CharacterPresentation, SentenceCharacterPresentation } from '../domain/card-characters';
import { DAILY_STUDY_MINUTE_CHOICES, DEFAULT_DAILY_STUDY_MINUTES, isDailyStudyMinutes, type DailyStudyMinutes } from '../domain/timed-session';

export function SessionSettingsPanel({
  visible = true,
  backendStatus,
  onSaveSessionSettings,
  onSavingChange,
  onClose,
}: {
  visible?: boolean;
  backendStatus: BackendStatus | null;
  onSaveSessionSettings: (settings: {
    dailyNewWordLimit?: number;
    studyIntroductionOrder?: StudyIntroductionOrder;
    studyIntroductionSpacing?: number;
    unstudiedAdmissionSource?: UnstudiedAdmissionSource;
    characterPresentation?: CharacterPresentation;
    sentenceCharacterPresentation?: SentenceCharacterPresentation;
    debriefInterests?: string;
    dailyStudyMinutes?: DailyStudyMinutes;
  }) => Promise<void>;
  onSavingChange: (saving: boolean) => void;
  onClose: () => void;
}) {
  const limitInputRef = useRef<HTMLInputElement | null>(null);
  const [limitEditing, setLimitEditing] = useState(false);
  const [limitDraft, setLimitDraft] = useState(() => (
    backendStatus?.dailyNewWordLimit === undefined || backendStatus?.dailyNewWordLimit === null
      ? ''
      : String(backendStatus.dailyNewWordLimit)
  ));
  const [introductionOrderDraft, setIntroductionOrderDraft] = useState<StudyIntroductionOrder>(
    backendStatus?.studyIntroductionOrder ?? 'random',
  );
  const [introductionSpacingDraft, setIntroductionSpacingDraft] = useState(
    backendStatus?.studyIntroductionSpacing ?? DEFAULT_INTRODUCTION_SPACING,
  );
  const [sourceDraft, setSourceDraft] = useState<UnstudiedAdmissionSource>(
    backendStatus?.unstudiedAdmissionSource ?? 'mixed',
  );
  const [presentationDraft, setPresentationDraft] = useState<CharacterPresentation>(
    backendStatus?.characterPresentation ?? 'simplified',
  );
  const [sentencePresentationDraft, setSentencePresentationDraft] = useState<SentenceCharacterPresentation>(
    backendStatus?.sentenceCharacterPresentation ?? 'simplified',
  );
  const [interestsDraft, setInterestsDraft] = useState(backendStatus?.debriefInterests ?? '');
  const timedSessions = backendStatus?.timedSessions === true;
  const committedDailyMinutes = backendStatus?.dailyStudyMinutes ?? DEFAULT_DAILY_STUDY_MINUTES;
  const [dailyMinutesDraft, setDailyMinutesDraft] = useState<DailyStudyMinutes>(committedDailyMinutes);
  const [limitSaving, setLimitSaving] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);

  const committedLimit = backendStatus?.dailyNewWordLimit ?? null;
  const committedIntroductionOrder = backendStatus?.studyIntroductionOrder ?? 'random';
  const committedIntroductionSpacing = backendStatus?.studyIntroductionSpacing ?? DEFAULT_INTRODUCTION_SPACING;
  const introductionOrderDirty = introductionOrderDraft !== committedIntroductionOrder;
  const introductionSpacingDirty = introductionSpacingDraft !== committedIntroductionSpacing;
  const committedSource = backendStatus?.unstudiedAdmissionSource ?? 'mixed';
  const committedPresentation = backendStatus?.characterPresentation ?? 'simplified';
  const committedSentencePresentation = backendStatus?.sentenceCharacterPresentation ?? 'simplified';
  const limitDirty = committedLimit !== null && limitDraft.trim() !== String(committedLimit);
  const sourceDirty = sourceDraft !== committedSource;
  const presentationDirty = backendStatus?.studyProfile === 'mandarin' && presentationDraft !== committedPresentation;
  const sentencePresentationDirty = backendStatus?.studyProfile === 'mandarin'
    && sentencePresentationDraft !== committedSentencePresentation;
  const committedInterests = backendStatus?.debriefInterests ?? '';
  const interestsDirty = backendStatus?.studyProfile === 'mandarin' && interestsDraft !== committedInterests;
  const dailyMinutesDirty = timedSessions && dailyMinutesDraft !== committedDailyMinutes;
  const settingsDirty = dailyMinutesDirty || introductionOrderDirty || introductionSpacingDirty || limitDirty || sourceDirty || presentationDirty || sentencePresentationDirty || interestsDirty;

  function beginLimitEdit() {
    setLimitDraft(committedLimit === null ? '' : String(committedLimit));
    setLimitEditing(true);
    setLimitError(null);
  }

  function cancelAndClose() {
    setLimitDraft(committedLimit === null ? '' : String(committedLimit));
    setIntroductionOrderDraft(committedIntroductionOrder);
    setIntroductionSpacingDraft(committedIntroductionSpacing);
    setSourceDraft(committedSource);
    setPresentationDraft(committedPresentation);
    setSentencePresentationDraft(committedSentencePresentation);
    setInterestsDraft(committedInterests);
    setDailyMinutesDraft(committedDailyMinutes);
    setLimitEditing(false);
    setLimitError(null);
    onClose();
  }

  async function saveAndClose() {
    if (limitSaving) {
      return;
    }

    if (!settingsDirty) {
      onClose();
      return;
    }

    if (committedLimit === null) {
      return;
    }

    const patch: {
      dailyNewWordLimit?: number;
      studyIntroductionOrder?: StudyIntroductionOrder;
      studyIntroductionSpacing?: number;
      unstudiedAdmissionSource?: UnstudiedAdmissionSource;
      characterPresentation?: CharacterPresentation;
      sentenceCharacterPresentation?: SentenceCharacterPresentation;
      debriefInterests?: string;
      dailyStudyMinutes?: DailyStudyMinutes;
    } = {};

    if (dailyMinutesDirty) patch.dailyStudyMinutes = dailyMinutesDraft;

    if (limitDirty) {
      const dailyNewWordLimit = Number(limitDraft);
      if (limitDraft.trim().length === 0 || !Number.isSafeInteger(dailyNewWordLimit) || dailyNewWordLimit < 0 || dailyNewWordLimit > 20) {
        setLimitError('Enter a whole number from 0 to 20.');
        setLimitEditing(true);
        return;
      }
      patch.dailyNewWordLimit = dailyNewWordLimit;
    }

    if (!timedSessions && (introductionOrderDirty || introductionSpacingDirty)) {
      patch.studyIntroductionOrder = introductionOrderDraft;
      patch.studyIntroductionSpacing = introductionSpacingDraft;
    }

    if (sourceDirty) {
      patch.unstudiedAdmissionSource = sourceDraft;
    }

    if (presentationDirty) {
      patch.characterPresentation = presentationDraft;
    }

    if (sentencePresentationDirty) {
      patch.sentenceCharacterPresentation = sentencePresentationDraft;
    }

    if (interestsDirty) patch.debriefInterests = interestsDraft;

    setLimitSaving(true);
    onSavingChange(true);
    setLimitError(null);
    try {
      await onSaveSessionSettings(patch);
      if (patch.dailyNewWordLimit !== undefined) {
        setLimitDraft(String(patch.dailyNewWordLimit));
      }
      setLimitEditing(false);
      onClose();
    } catch (error) {
      setLimitError(error instanceof Error ? error.message : 'Failed to save session settings');
    } finally {
      setLimitSaving(false);
      onSavingChange(false);
    }
  }

  useEffect(() => {
    if (!visible) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (limitSaving) {
          return;
        }
        event.preventDefault();
        cancelAndClose();
        return;
      }

      if (event.key === 'Enter' && !limitSaving) {
        const target = event.target as HTMLElement | null;
        if (target?.closest('textarea, button, select, summary')) {
          return;
        }
        event.preventDefault();
        void saveAndClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, dailyMinutesDraft, committedDailyMinutes, timedSessions, limitDraft, introductionOrderDraft, introductionSpacingDraft, committedIntroductionOrder, committedIntroductionSpacing, sourceDraft, presentationDraft, sentencePresentationDraft, interestsDraft, committedInterests, limitSaving, settingsDirty, committedLimit, committedSource, committedPresentation, committedSentencePresentation]);

  useEffect(() => {
    if (limitEditing) {
      limitInputRef.current?.focus();
      limitInputRef.current?.select();
    }
  }, [limitEditing]);

  useEffect(() => {
    if (!limitEditing && committedLimit !== null) {
      setLimitDraft(String(committedLimit));
    }
  }, [committedLimit, limitEditing]);

  useEffect(() => {
    setSourceDraft(committedSource);
  }, [committedSource]);

  useEffect(() => {
    setPresentationDraft(committedPresentation);
  }, [committedPresentation]);

  useEffect(() => {
    setSentencePresentationDraft(committedSentencePresentation);
  }, [committedSentencePresentation]);

  useEffect(() => { setIntroductionOrderDraft(committedIntroductionOrder); }, [committedIntroductionOrder]);

  useEffect(() => { setIntroductionSpacingDraft(committedIntroductionSpacing); }, [committedIntroductionSpacing]);

  useEffect(() => { setInterestsDraft(committedInterests); }, [committedInterests]);

  useEffect(() => { setDailyMinutesDraft(committedDailyMinutes); }, [committedDailyMinutes]);

  return (
    <div
      id="session-settings-panel"
      className="panel study-session-panel session-settings-panel"
      role="dialog"
      aria-label="Session settings"
    >
      <h2>Session Settings</h2>
      <div className="session-settings-body">
        {timedSessions ? (
          <div className="session-settings-row" style={{ flexWrap: 'wrap' }}>
            <label className="session-settings-label" htmlFor="daily-study-minutes">Daily study:</label>
            <select
              id="daily-study-minutes"
              className="session-settings-select"
              value={dailyMinutesDraft}
              disabled={limitSaving}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (isDailyStudyMinutes(next)) {
                  setDailyMinutesDraft(next);
                  setLimitError(null);
                }
              }}
            >
              {DAILY_STUDY_MINUTE_CHOICES.map((minutes) => <option key={minutes} value={minutes}>About {minutes} minutes</option>)}
            </select>
          </div>
        ) : null}
        <div className="session-settings-row">
          <span className="session-settings-label">Daily New Word Limit:</span>
          {limitEditing ? (
            <input
              ref={limitInputRef}
              className="session-settings-limit-input"
              type="number"
              min={0}
              max={20}
              step={1}
              inputMode="numeric"
              value={limitDraft}
              disabled={committedLimit === null || limitSaving}
              aria-label="Daily new-word limit"
              onChange={(event) => {
                setLimitDraft(event.target.value);
                setLimitError(null);
              }}
            />
          ) : (
            <button
              type="button"
              className="session-settings-limit-value"
              disabled={committedLimit === null}
              onClick={beginLimitEdit}
            >
              {committedLimit ?? '...'}
            </button>
          )}
        </div>
        <div className="session-settings-row">
          <label className="inline-checkbox">
            <input
              type="checkbox"
              checked={sourceDraft === 'stash_only'}
              disabled={backendStatus?.unstudiedAdmissionSource === undefined || limitSaving}
              aria-label="New words from stash only"
              onChange={(event) => {
                setSourceDraft(event.target.checked ? 'stash_only' : 'mixed');
                setLimitError(null);
              }}
            />
            New words from stash only
          </label>
        </div>
        {/* The timed paradigm owns where new words go. */}
        {!timedSessions ? <>
        <div className="session-settings-row" style={{ flexWrap: 'wrap' }}>
          <label className="session-settings-label" htmlFor="study-introduction-order">Introductions:</label>
          <select
            id="study-introduction-order"
            className="session-settings-select"
            value={introductionOrderDraft}
            disabled={backendStatus === null || limitSaving}
            onChange={(event) => {
              if (isStudyIntroductionOrder(event.target.value)) {
                setIntroductionOrderDraft(event.target.value);
                setLimitError(null);
              }
            }}
          >
            <option value="random">Random</option>
            <option value="first">Introductions first</option>
            <option value="paced">Paced</option>
          </select>
        </div>
        {introductionOrderDraft === 'paced' ? (
          <div className="session-settings-row" style={{ flexWrap: 'wrap' }}>
            <label className="session-settings-label" htmlFor="study-introduction-spacing">Exercises between introductions:</label>
            <select
              id="study-introduction-spacing"
              className="session-settings-select"
              value={introductionSpacingDraft}
              disabled={backendStatus === null || limitSaving}
              onChange={(event) => {
                setIntroductionSpacingDraft(Number(event.target.value));
                setLimitError(null);
              }}
            >
              {Array.from({ length: MAX_INTRODUCTION_SPACING }, (_, index) => index + 1).map((spacing) => (
                <option key={spacing} value={spacing}>{spacing}</option>
              ))}
            </select>
          </div>
        ) : null}
        <details>
          <summary>Introduction order details</summary>
          <p>Random mixes introductions into the session. Introductions first shows every new word before other exercises.</p>
          <p>Paced starts with an introduction, then spaces introductions with the selected number of existing learning or review exercises, when available. New-word practice joins the mix after all introductions are done.</p>
        </details>
        </> : null}
        {backendStatus?.studyProfile === 'mandarin' ? (
          <div className="session-settings-row">
            <label className="session-settings-label" htmlFor="card-character-presentation">
              Card characters:
            </label>
            <select
              id="card-character-presentation"
              className="session-settings-select"
              value={presentationDraft}
              disabled={backendStatus.characterPresentation === undefined || limitSaving}
              onChange={(event) => {
                const next = event.target.value;
                if (next === 'simplified' || next === 'traditional' || next === 'both') {
                  setPresentationDraft(next);
                  setLimitError(null);
                }
              }}
            >
              <option value="simplified">Simplified</option>
              <option value="traditional">Traditional</option>
              <option value="both">Both</option>
            </select>
          </div>
        ) : null}
        {backendStatus?.studyProfile === 'mandarin' && presentationDraft === 'both' ? (
          <div className="session-settings-row">
            <label className="session-settings-label" htmlFor="sentence-character-presentation">
              Sentences and examples:
            </label>
            <select
              id="sentence-character-presentation"
              className="session-settings-select"
              value={sentencePresentationDraft}
              disabled={backendStatus.sentenceCharacterPresentation === undefined || limitSaving}
              onChange={(event) => {
                const next = event.target.value;
                if (next === 'simplified' || next === 'traditional') {
                  setSentencePresentationDraft(next);
                  setLimitError(null);
                }
              }}
            >
              <option value="simplified">Simplified</option>
              <option value="traditional">Traditional</option>
            </select>
          </div>
        ) : null}
        {backendStatus?.studyProfile === 'mandarin' ? <div className="session-settings-interests">
          <label htmlFor="debrief-interests">Interests <span className="notes">(optional)</span></label>
          <p className="notes" id="debrief-interests-help">Topics you’re curious about, to help connect the words after a session.</p>
          <textarea id="debrief-interests" aria-describedby="debrief-interests-help" maxLength={1000} rows={3}
            placeholder="professional tennis, 汉服, wukong video game, ..."
            value={interestsDraft} disabled={limitSaving} onChange={(event) => setInterestsDraft(event.target.value)} />
        </div> : null}
        {limitError ? <p className="form-error" role="alert">{limitError}</p> : null}
        <div className="session-settings-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={limitSaving}
            onClick={cancelAndClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={limitSaving}
            onClick={() => {
              void saveAndClose();
            }}
          >
            {limitSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
