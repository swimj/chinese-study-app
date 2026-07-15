import type {
  ProductionMistakeReflectionItemV0,
  ReflectionDiagnosisTagV0,
  ReflectionEvidenceCitationV0,
  ReflectionHandleOperationV0,
  ReflectionHandleProposalV0,
  ReflectionItemResultV0,
  ProposalProfileV0,
  ReflectionProviderFixtureV0,
  ReflectionWordSnapshotV0,
  SessionNoteReflectionItemV0,
  SessionReflectionBundleV0,
} from '../contracts.js';

const SOURCE_DOCUMENT = 'notes/active/2026-07-06-session-reflection-workflow.md' as const;
const FIXTURE_TIME = '2026-07-06T12:00:00.000Z';

type WordSeed = {
  hanzi: string;
  pinyin: string;
  meanings: string[];
};

type FixtureContext = {
  prefix: string;
  itemId: string;
  targetWordId: string;
  submittedWordId: string;
  cueText: string;
  itemEvidence: ReflectionEvidenceCitationV0;
  attemptEvidence: ReflectionEvidenceCitationV0;
  cueEvidence: ReflectionEvidenceCitationV0;
  targetEvidence: ReflectionEvidenceCitationV0;
  submittedEvidence: ReflectionEvidenceCitationV0;
};

type ProductionFixtureSeed = {
  example: number;
  title: string;
  target: WordSeed;
  submitted: WordSeed;
  cueText: string;
  learnerNote: string | null;
  readiness?: ReflectionProviderFixtureV0['readiness'];
  readinessNotes?: string[];
  buildResult: (context: FixtureContext) => Omit<ReflectionItemResultV0, 'itemId'>;
  evaluation: ReflectionProviderFixtureV0['evaluation'];
};

function prefixFor(example: number): string {
  return `ex${String(example).padStart(2, '0')}`;
}

function word(wordId: string, seed: WordSeed): ReflectionWordSnapshotV0 {
  return {
    wordId,
    hanzi: seed.hanzi,
    pinyin: seed.pinyin,
    meanings: seed.meanings,
    production: {
      relevance: 'normal',
      notes: [],
    },
  };
}

function citation(
  evidenceType: ReflectionEvidenceCitationV0['evidenceType'],
  evidenceId: string,
  claim: string,
): ReflectionEvidenceCitationV0 {
  return { evidenceType, evidenceId, claim };
}

function proposal(
  proposalKey: string,
  proposalGroupKey: string | null,
  rationale: string,
  evidence: ReflectionEvidenceCitationV0[],
  operation: ReflectionHandleOperationV0,
): ReflectionHandleProposalV0 {
  return {
    proposalKey,
    proposalGroupKey,
    handleVersion: 1,
    rationale,
    evidence,
    operation,
  };
}

function baseResult(
  diagnosisTags: ReflectionDiagnosisTagV0[],
  observation: string,
  learnerExplanation: string | null,
  evidence: ReflectionEvidenceCitationV0[],
  overrides: Partial<
    Pick<ReflectionItemResultV0, 'uncertain' | 'proposals' | 'questions' | 'unhandledNeeds'>
  > = {},
): Omit<ReflectionItemResultV0, 'itemId'> {
  return {
    uncertain: overrides.uncertain ?? false,
    diagnosisTags,
    observation,
    learnerExplanation,
    evidence,
    proposals: overrides.proposals ?? [],
    questions: overrides.questions ?? [],
    unhandledNeeds: overrides.unhandledNeeds ?? [],
  };
}

function bundleFor(prefix: string, item: ProductionMistakeReflectionItemV0 | SessionNoteReflectionItemV0): SessionReflectionBundleV0 {
  return {
    schemaVersion: 'session_reflection_bundle.v0',
    generatedAt: FIXTURE_TIME,
    session: {
      sessionId: `session-${prefix}`,
      startedAt: '2026-07-06T11:50:00.000Z',
      endedAt: FIXTURE_TIME,
      studyProfile: 'mandarin',
    },
    items: [item],
  };
}

function productionFixture(seed: ProductionFixtureSeed): ReflectionProviderFixtureV0 {
  const prefix = prefixFor(seed.example);
  const itemId = `${prefix}-item`;
  const targetWordId = `${prefix}-target`;
  const submittedWordId = `${prefix}-submitted`;
  const attemptId = `${prefix}-attempt-1`;
  const context: FixtureContext = {
    prefix,
    itemId,
    targetWordId,
    submittedWordId,
    cueText: seed.cueText,
    itemEvidence: citation('reflection_item', `item/${itemId}`, 'This is the source reflection item.'),
    attemptEvidence: citation('attempt', `attempt/${attemptId}`, `The first submitted response was ${seed.submitted.hanzi}.`),
    cueEvidence: citation('cue', `cue/${itemId}/0`, `The displayed production cue was “${seed.cueText}”.`),
    targetEvidence: citation('word', `word/${targetWordId}`, `The target word was ${seed.target.hanzi}.`),
    submittedEvidence: citation('word', `word/${submittedWordId}`, `The submitted known word was ${seed.submitted.hanzi}.`),
  };

  const item: ProductionMistakeReflectionItemV0 = {
    itemId,
    source: 'production_mistake',
    sourceActionKind: 'production',
    sessionActionId: `session-${prefix}/action-1`,
    occurredAt: '2026-07-06T11:55:00.000Z',
    targetWord: word(targetWordId, seed.target),
    sessionNote: seed.learnerNote,
    existingContent: {
      contrastClusters: [],
      knownAcceptedAlternates: [],
    },
    cuesAsShown: [
      {
        cueId: null,
        cueType: 'definition_gloss',
        displayOrder: 0,
        text: seed.cueText,
        displayedMeanings: seed.target.meanings,
      },
    ],
    rawResponse: seed.submitted.hanzi,
    submittedWord: word(submittedWordId, seed.submitted),
    responseKind: 'matched_known_word',
    attempts: [
      {
        attemptId,
        occurredAt: '2026-07-06T11:55:00.000Z',
        actionAttemptSequence: 1,
        outcome: 'incorrect',
        rating: 'forgot',
        response: seed.submitted.hanzi,
      },
    ],
    attemptShape: {
      firstResponseOutcome: 'incorrect',
      resolution: 'unknown',
      terminalRating: 'forgot',
      attemptCountForAction: 1,
      managementAction: null,
    },
  };

  const itemResult = seed.buildResult(context);
  return {
    fixtureVersion: 'reflection_provider_fixture.v0',
    fixtureId: `${prefix}-${seed.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '')}`,
    source: {
      kind: 'workflow_appendix',
      document: SOURCE_DOCUMENT,
      appendixExample: seed.example,
      title: seed.title,
    },
    readiness: seed.readiness ?? 'ready',
    readinessNotes: seed.readinessNotes ?? [],
    inputBundle: bundleFor(prefix, item),
    referenceResult: {
      schemaVersion: 'session_reflection_result.v0',
      bundleSchemaVersion: 'session_reflection_bundle.v0',
      summary: itemResult.observation,
      itemResults: [{ itemId, ...itemResult }],
    },
    evaluation: seed.evaluation,
  };
}

const noProposalProfile: ProposalProfileV0 = {
  requiredKinds: [],
  allowedKinds: [],
  description: 'No durable change is justified from this evidence.',
};

function cueRef(context: FixtureContext) {
  return { cueId: null, textAsShown: context.cueText };
}

const productionFixtures: ReflectionProviderFixtureV0[] = [
  productionFixture({
    example: 1,
    title: '概括 to 提要',
    target: { hanzi: '概括', pinyin: 'gàikuò', meanings: ['to summarize', 'to generalize', 'briefly', 'in broad outline'] },
    submitted: { hanzi: '提要', pinyin: 'tíyào', meanings: ['summary', 'abstract'] },
    cueText: 'to summarize; to generalize; briefly; in broad outline',
    learnerNote: '提要 is relatively new and was cognitively available. I am unsure whether it is noun-only.',
    buildResult: (c) => baseResult(
      ['ordinary_retrieval_noise', 'grammar_or_usage_role_interference'],
      'This looks like a plausible one-off retrieval substitution rather than evidence that the cue is unfair.',
      '概括 is the verb-like summarizing action requested by the cue, while the stored 提要 gloss is strongly noun-like. The recent availability of 提要 can explain the substitution without requiring a content change.',
      [c.cueEvidence, c.attemptEvidence, c.targetEvidence, c.submittedEvidence],
    ),
    evaluation: {
      requiredDiagnosisTags: ['ordinary_retrieval_noise'],
      forbiddenDiagnosisTags: ['valid_or_near_valid_alternate', 'persistent_confusion'],
      acceptableProposalProfiles: [noProposalProfile],
      questionPolicy: 'none_expected',
      requiredJudgments: ['Treat this as a legitimate lapse with a possible usage-role robustness signal.', 'Recommend no immediate content change.'],
      forbiddenJudgments: ['Accept 提要 as an answer to this cue.', 'Claim that one miss establishes persistent confusion.', 'Create contrast content immediately.'],
    },
  }),
  productionFixture({
    example: 2,
    title: '难怪 to 怪不得',
    target: { hanzi: '难怪', pinyin: 'nánguài', meanings: ["(it's) no wonder (that...)", "(it's) not surprising (that)"] },
    submitted: { hanzi: '怪不得', pinyin: 'guàibude', meanings: ['no wonder!', "so that's why!"] },
    cueText: "(it's) no wonder (that...); (it's) not surprising (that)",
    learnerNote: 'These seem almost fully interchangeable to me; I do not know whether any subtle distinction matters at my level.',
    buildResult: (c) => baseResult(
      ['valid_or_near_valid_alternate'],
      'The submitted answer is acceptable for the displayed no-wonder cue; the exact-answer failure is too strict.',
      '难怪 and 怪不得 can both express “no wonder / so that is why” here. Any subtle preference is not encoded by this English cue and does not justify contrast practice by itself.',
      [c.cueEvidence, c.attemptEvidence, c.targetEvidence, c.submittedEvidence],
      {
        proposals: [proposal(
          `${c.prefix}-accept-alternate`,
          null,
          'Credit the useful production response for this specific cue without creating a global synonym relation.',
          [c.cueEvidence, c.attemptEvidence],
          {
            kind: 'accept_production_alternate',
            cue: cueRef(c),
            targetWordId: c.targetWordId,
            alternateWordId: c.submittedWordId,
            acceptance: 'fully_acceptable_for_cue',
            subtletyNote: 'Nearly interchangeable in this use; subtle preferences are not recoverable from the cue.',
          },
        )],
      },
    ),
    evaluation: {
      requiredDiagnosisTags: ['valid_or_near_valid_alternate'],
      forbiddenDiagnosisTags: ['ordinary_retrieval_noise', 'persistent_confusion'],
      acceptableProposalProfiles: [{
        requiredKinds: ['accept_production_alternate'],
        allowedKinds: ['accept_production_alternate'],
        description: 'Accept 怪不得 only for the displayed cue.',
      }],
      questionPolicy: 'none_expected',
      requiredJudgments: ['Treat 怪不得 as acceptable for this cue.', 'Scope acceptance to the cue.', 'Do not infer a need for contrast training.'],
      forbiddenJudgments: ['Create a global synonym edge.', 'Automatically create contrast content.', 'Suppress definition production.'],
    },
  }),
  productionFixture({
    example: 3,
    title: '舍不得 and 恨不得',
    target: { hanzi: '舍不得', pinyin: 'shěbude', meanings: ['to hate to do something', 'to hate to part with', 'to begrudge'] },
    submitted: { hanzi: '恨不得', pinyin: 'hènbude', meanings: ['wishing one could do something', 'to hate to be unable', 'itching to do something'] },
    cueText: 'to hate to do something; to hate to part with; to begrudge',
    learnerNote: 'The meanings are clearly different, but this pair has been slow to acquire because of similar structure, sound, and phrase shape.',
    buildResult: (c) => baseResult(
      ['form_or_sound_interference', 'persistent_confusion'],
      'The evidence points to persistent form and phrase-shape interference between two semantically distinct expressions.',
      '舍不得 expresses reluctance to part with or do something; 恨不得 expresses an intense wish to do something. Their shared 得 phrase shape makes targeted contrast reasonable even though the cue itself is not defective.',
      [c.cueEvidence, c.attemptEvidence, c.targetEvidence, c.submittedEvidence],
      {
        proposals: [proposal(
          `${c.prefix}-contrast-content`,
          null,
          'A small contextual contrast can target the reluctance-versus-intense-wish frame.',
          [c.attemptEvidence, c.targetEvidence, c.submittedEvidence],
          {
            kind: 'upsert_contrast_content',
            destination: { mode: 'create_cluster', clusterId: null, title: '舍不得 / 恨不得' },
            clusterNote: 'Similar phrase shape, but opposite motivational frames: reluctance versus intense wishing.',
            members: [
              { wordId: c.targetWordId, nuanceNote: 'Reluctant to part with something or reluctant to act because of attachment or cost.' },
              { wordId: c.submittedWordId, nuanceNote: 'Intensely wishes one could act, often immediately.' },
            ],
            prompts: [
              { targetWordId: c.targetWordId, promptText: '这本书是朋友送的，我一直___扔掉。', explanation: 'Attachment makes the speaker reluctant to discard it.' },
              { targetWordId: c.submittedWordId, promptText: '听到这个消息，他___马上飞回家。', explanation: 'The speaker intensely wishes to act immediately.' },
            ],
          },
        )],
      },
    ),
    evaluation: {
      requiredDiagnosisTags: ['form_or_sound_interference', 'persistent_confusion'],
      forbiddenDiagnosisTags: ['valid_or_near_valid_alternate'],
      acceptableProposalProfiles: [{
        requiredKinds: ['upsert_contrast_content'],
        allowedKinds: ['upsert_contrast_content', 'add_contrast_candidate'],
        description: 'Author or at minimum preserve a contrast centered on phrase-shape interference.',
      }],
      questionPolicy: 'none_expected',
      requiredJudgments: ['State that the meanings are distinct.', 'Name form, sound, or phrase shape as the interference axis.', 'Target prompts at reluctance versus intense wishing.'],
      forbiddenJudgments: ['Accept 恨不得 as a valid answer.', 'Flag the production cue merely because the forms are similar.', 'Invent a finite scheduling policy.'],
    },
  }),
  productionFixture({
    example: 4,
    title: '吃惊 to 震撼',
    target: { hanzi: '吃惊', pinyin: 'chījīng', meanings: ['to be startled', 'to be shocked', 'to be amazed'] },
    submitted: { hanzi: '震撼', pinyin: 'zhènhàn', meanings: ['to shake', 'to shock', 'to stun', 'shocking', 'stunning', 'shock'] },
    cueText: 'to be startled; to be shocked; to be amazed',
    learnerNote: 'I am curious what this substitution means.',
    buildResult: (c) => baseResult(
      ['cue_overlap_hides_usage_difference'],
      'The English gloss overlap makes 震撼 understandable, but it is not generally interchangeable with ordinary 吃惊.',
      '吃惊 is ordinary surprise or being startled. 震撼 carries much stronger impact, often from powerful news, spectacle, art, or history.',
      [c.cueEvidence, c.attemptEvidence, c.targetEvidence, c.submittedEvidence],
      {
        proposals: [
          proposal(
            `${c.prefix}-repair-cue`,
            `${c.prefix}-repair-and-contrast`,
            'Make the direct-production cue foreground ordinary surprise rather than the shared word “shocked.”',
            [c.cueEvidence, c.attemptEvidence],
            {
              kind: 'repair_production_cue',
              wordId: c.targetWordId,
              sourceCue: cueRef(c),
              replacementCues: [{ cueType: 'definition_gloss', text: 'to be surprised; to be startled' }],
              repairIntent: 'add_distinguishing_anchor',
            },
          ),
          proposal(
            `${c.prefix}-contrast-content`,
            `${c.prefix}-repair-and-contrast`,
            'Contextual choices can reinforce ordinary surprise versus powerful emotional impact.',
            [c.attemptEvidence, c.targetEvidence, c.submittedEvidence],
            {
              kind: 'upsert_contrast_content',
              destination: { mode: 'create_cluster', clusterId: null, title: '吃惊 / 震撼' },
              clusterNote: 'Ordinary surprise or startlement versus deep, powerful impact.',
              members: [
                { wordId: c.targetWordId, nuanceNote: 'Ordinary surprise or being startled.' },
                { wordId: c.submittedWordId, nuanceNote: 'Strong shock, awe, or emotional impact.' },
              ],
              prompts: [
                { targetWordId: c.targetWordId, promptText: '他突然从门后出现，把我吓得很___。', explanation: 'A sudden appearance causes ordinary startlement.' },
                { targetWordId: c.submittedWordId, promptText: '这部纪录片的画面和故事非常___。', explanation: 'The work creates a powerful emotional impact.' },
              ],
            },
          ),
        ],
      },
    ),
    evaluation: {
      requiredDiagnosisTags: ['cue_overlap_hides_usage_difference'],
      forbiddenDiagnosisTags: ['valid_or_near_valid_alternate', 'ordinary_retrieval_noise'],
      acceptableProposalProfiles: [{
        requiredKinds: ['repair_production_cue', 'upsert_contrast_content'],
        allowedKinds: ['repair_production_cue', 'upsert_contrast_content'],
        description: 'Repair the cue and independently create contextual contrast content.',
      }],
      questionPolicy: 'none_expected',
      requiredJudgments: ['Explain why the English overlap tempted 震撼.', 'Distinguish ordinary surprise from strong emotional impact.', 'Keep cue repair and contrast authoring atomic.'],
      forbiddenJudgments: ['Accept 震撼 as fully interchangeable.', 'Reduce the diagnosis to a random lapse.'],
    },
  }),
  productionFixture({
    example: 5,
    title: '在意 and 介意',
    target: { hanzi: '在意', pinyin: 'zàiyì', meanings: ['to care about', 'to mind'] },
    submitted: { hanzi: '介意', pinyin: 'jièyì', meanings: ['to care about', 'to take offense', 'to mind'] },
    cueText: 'to care about; to mind',
    learnerNote: 'This feels like a high-value real difference, but I want help articulating and training it.',
    buildResult: (c) => baseResult(
      ['cue_overlap_hides_usage_difference'],
      'The broad English cue hides a useful semantic and interactional boundary between 在意 and 介意.',
      '在意 broadly means caring about, paying attention to, or being emotionally affected. 介意 more narrowly means minding, objecting, being bothered, or taking offense.',
      [c.cueEvidence, c.attemptEvidence, c.targetEvidence, c.submittedEvidence],
      {
        proposals: [proposal(
          `${c.prefix}-contrast-content`,
          null,
          'The learner explicitly values this natural-usage boundary, and context can express it better than English gloss expansion alone.',
          [c.itemEvidence, c.targetEvidence, c.submittedEvidence],
          {
            kind: 'upsert_contrast_content',
            destination: { mode: 'create_cluster', clusterId: null, title: '在意 / 介意' },
            clusterNote: 'General concern or emotional investment versus objection, bother, or offense.',
            members: [
              { wordId: c.targetWordId, nuanceNote: 'Care about, pay attention to, or be emotionally affected by something.' },
              { wordId: c.submittedWordId, nuanceNote: 'Mind, object to, be bothered by, or take offense at something.' },
            ],
            prompts: [
              { targetWordId: c.targetWordId, promptText: '别人怎么评价我，我并不太___。', explanation: 'The speaker does not care much about others’ evaluations.' },
              { targetWordId: c.submittedWordId, promptText: '你___我把窗户打开吗？', explanation: 'The speaker asks whether the other person objects.' },
            ],
          },
        )],
      },
    ),
    evaluation: {
      requiredDiagnosisTags: ['cue_overlap_hides_usage_difference'],
      forbiddenDiagnosisTags: ['valid_or_near_valid_alternate', 'ordinary_retrieval_noise'],
      acceptableProposalProfiles: [{
        requiredKinds: ['upsert_contrast_content'],
        allowedKinds: ['upsert_contrast_content', 'repair_production_cue'],
        description: 'Contextual contrast is required; a separate cue repair is acceptable but not required.',
      }],
      questionPolicy: 'none_expected',
      requiredJudgments: ['Distinguish broad concern from objection or offense.', 'Respect the learner’s stated high value for this distinction.'],
      forbiddenJudgments: ['Treat the words as fully interchangeable.', 'Propose only a generic dictionary-gloss expansion.'],
    },
  }),
  productionFixture({
    example: 6,
    title: '落成 to 建成',
    target: { hanzi: '落成', pinyin: 'luòchéng', meanings: ['to complete a construction project'] },
    submitted: { hanzi: '建成', pinyin: 'jiànchéng', meanings: ['to establish', 'to build'] },
    cueText: 'to complete a construction project',
    learnerNote: '建成 is valid for completing a construction project, but I want the item to teach the substantially more formal tone and register of 落成.',
    readiness: 'ready',
    readinessNotes: ['The learner clarified that cue repair should teach the formal-register distinction; contrast selection remains optional.'],
    buildResult: (c) => baseResult(
      ['valid_or_near_valid_alternate', 'cue_overlap_hides_usage_difference'],
      '建成 is a valid term for completing construction, so this is not a true lapse; the bare cue fails to expose the substantially more formal tone and register of 落成.',
      '建成 is the ordinary resultative “build to completion.” 落成 is markedly more formal and is common in official or ceremonial announcements that a building, bridge, or public project has been completed or inaugurated.',
      [c.cueEvidence, c.attemptEvidence, c.targetEvidence, c.submittedEvidence],
      {
        proposals: [proposal(
          `${c.prefix}-repair-cue`,
          null,
          'Add a formal announcement frame so direct production tests the register-specific target instead of generic construction completion.',
          [c.cueEvidence, c.attemptEvidence, c.targetEvidence, c.submittedEvidence],
          {
            kind: 'repair_production_cue',
            wordId: c.targetWordId,
            sourceCue: cueRef(c),
            replacementCues: [
              {
                cueType: 'definition_gloss',
                text: 'to be formally completed or inaugurated (of a building or construction project)',
              },
              {
                cueType: 'register_or_domain_hint',
                text: 'formal announcement: city officials announce completion of a new bridge or public building',
              },
            ],
            repairIntent: 'add_contextual_triangulation',
          },
        )],
      },
    ),
    evaluation: {
      requiredDiagnosisTags: ['valid_or_near_valid_alternate', 'cue_overlap_hides_usage_difference'],
      forbiddenDiagnosisTags: ['ordinary_retrieval_noise', 'persistent_confusion'],
      acceptableProposalProfiles: [{
        requiredKinds: ['repair_production_cue'],
        allowedKinds: ['repair_production_cue', 'add_contrast_candidate', 'upsert_contrast_content'],
        description: 'Contextually triangulate the formal target; contrast content is optional.',
      }],
      questionPolicy: 'none_expected',
      requiredJudgments: [
        'Acknowledge that 建成 is a valid term for completion of a construction project.',
        'State that 落成 is substantially more formal in tone and register.',
        'Treat the current cue as underdetermined rather than treating the response as a true lapse.',
        'Use repair_production_cue with add_contextual_triangulation.',
        'A formal announcement frame or explicit formal-register hint is appropriate triangulating context.',
        'Contrast-selection content may be proposed but is not required.',
      ],
      forbiddenJudgments: [
        'Declare 建成 simply wrong.',
        'Classify the response as ordinary retrieval noise or a true lapse.',
        'Claim that 建成 and 落成 are interchangeable in tone and register.',
      ],
    },
  }),
  productionFixture({
    example: 7,
    title: '给 jǐ to 供应',
    target: { hanzi: '给', pinyin: 'jǐ', meanings: ['to supply', 'to provide'] },
    submitted: { hanzi: '供应', pinyin: 'gōngyìng', meanings: ['to supply', 'to provide goods or services'] },
    cueText: 'to supply; to provide',
    learnerNote: 'Even around B2/C1, isolated production of 给 in the jǐ reading feels low value. I still want recognition, but usually encounter this reading in common expressions such as 自给自足 and 供给.',
    readiness: 'ready',
    readinessNotes: ['The learner clarified that definition-based production should be suppressed while recognition remains enabled.'],
    buildResult: (c) => baseResult(
      ['valid_or_near_valid_alternate', 'production_cue_overloaded'],
      '供应 is a natural response to the bare supply/provide cue, while isolated production of 给 in the jǐ reading is low value for this learner even at an upper-intermediate or advanced level.',
      'The jǐ reading remains worth recognizing, especially inside common lexical items such as 自给自足 and 供给. Suppressing definition-based production does not weaken recognition or contextual-selection study.',
      [c.cueEvidence, c.attemptEvidence, c.targetEvidence, c.submittedEvidence],
      {
        proposals: [proposal(
          `${c.prefix}-suppress-production`,
          null,
          'Stop spending direct-production effort on an isolated low-value target while preserving recognition of the character and reading.',
          [c.cueEvidence, c.attemptEvidence, c.targetEvidence, c.submittedEvidence],
          {
            kind: 'suppress_definition_production',
            wordId: c.targetWordId,
            reason: 'low_value_for_learner',
            note: 'Keep recognition enabled; the jǐ reading is more useful inside common expressions such as 自给自足 and 供给 than as isolated definition-based production.',
          },
        )],
        unhandledNeeds: [{
          needKey: `${c.prefix}-redirect-production-priority`,
          description: 'Preserve recognition of 给 jǐ while redirecting production effort toward a higher-value related lexical item.',
          whyExistingHandlesDoNotFit: 'suppress_definition_production can disable the low-value isolated target, but no V0 handle can select and prioritize a more useful related unstudied word.',
        }],
      },
    ),
    evaluation: {
      requiredDiagnosisTags: ['valid_or_near_valid_alternate', 'production_cue_overloaded'],
      forbiddenDiagnosisTags: ['ordinary_retrieval_noise', 'persistent_confusion'],
      acceptableProposalProfiles: [{
        requiredKinds: ['suppress_definition_production'],
        allowedKinds: ['suppress_definition_production'],
        description: 'Suppress only definition-based production for isolated 给 jǐ.',
      }],
      questionPolicy: 'none_expected',
      unhandledNeedPolicy: 'allowed',
      requiredJudgments: [
        'Treat 供应 as a natural response to the bare supply/provide cue.',
        'Judge isolated production of 给 jǐ as low value for this learner even around B2/C1.',
        'Select suppress_definition_production with low_value_for_learner.',
        'Preserve recognition and other study modes for the character and reading.',
        'Recognize common lexical contexts such as 自给自足 and 供给 as more useful exposure.',
      ],
      forbiddenJudgments: [
        'Treat this as random retrieval noise or a true lapse.',
        'Suppress recognition of 给 or the jǐ reading.',
        'Make the missing linked suppress-and-prioritize capability part of the provider test bar.',
      ],
    },
  }),
  productionFixture({
    example: 9,
    title: '规范 to 指标',
    target: { hanzi: '规范', pinyin: 'guīfàn', meanings: ['norm', 'standard', 'specification', 'regulation', 'rule', 'to regulate', 'to specify'] },
    submitted: { hanzi: '指标', pinyin: 'zhǐbiāo', meanings: ['target', 'quota', 'index', 'indicator', 'sign', 'pointer'] },
    cueText: 'norm; standard; specification; regulation; rule; to regulate; to specify',
    learnerNote: 'This seems like a true lapse: vaguely the same administrative semantic neighborhood, but still far apart.',
    buildResult: (c) => baseResult(
      ['ordinary_retrieval_noise'],
      'This is a plausible semantic-neighborhood retrieval error, but one occurrence does not justify changing content.',
      '规范 concerns norms, rules, specifications, and regulating behavior. 指标 concerns measurable indicators, targets, quotas, or indices.',
      [c.cueEvidence, c.attemptEvidence, c.targetEvidence, c.submittedEvidence],
    ),
    evaluation: {
      requiredDiagnosisTags: ['ordinary_retrieval_noise'],
      forbiddenDiagnosisTags: ['valid_or_near_valid_alternate', 'persistent_confusion'],
      acceptableProposalProfiles: [noProposalProfile],
      questionPolicy: 'none_expected',
      requiredJudgments: ['Explain the broad semantic-neighborhood association.', 'Recommend no immediate content change.'],
      forbiddenJudgments: ['Accept 指标.', 'Create contrast content from one miss.', 'Flag the cue as bad.'],
    },
  }),
  productionFixture({
    example: 10,
    title: '熏制 and 烤制',
    target: { hanzi: '熏制', pinyin: 'xūnzhì', meanings: ['to smoke', 'to cure over a fire'] },
    submitted: { hanzi: '烤制', pinyin: 'kǎozhì', meanings: ['roast (v)'] },
    cueText: 'to smoke; to cure over a fire',
    learnerNote: 'Clear lapse.',
    readiness: 'ready',
    readinessNotes: ['The target and submitted glosses plus the production cue are now supplied.'],
    buildResult: (c) => baseResult(
      ['ordinary_retrieval_noise'],
      'This is a plausible one-off substitution between two food-processing methods, not evidence that the cue is unfair.',
      '熏制 means smoking or curing food over smoke or a fire, while 烤制 means roasting. The shared cooking context explains the association, but the processes are distinct enough that 烤制 is not a valid answer to this cue.',
      [c.cueEvidence, c.attemptEvidence, c.targetEvidence, c.submittedEvidence],
    ),
    evaluation: {
      requiredDiagnosisTags: ['ordinary_retrieval_noise'],
      forbiddenDiagnosisTags: ['valid_or_near_valid_alternate', 'persistent_confusion'],
      acceptableProposalProfiles: [noProposalProfile],
      questionPolicy: 'none_expected',
      requiredJudgments: [
        'Treat this as a legitimate one-off lapse between related food-processing methods.',
        'Distinguish smoking or curing from roasting.',
        'Recommend no immediate content change.',
      ],
      forbiddenJudgments: [
        'Accept 烤制 as an answer to the smoke or cure cue.',
        'Propose cue repair from this one occurrence.',
        'Create contrast content from one occurrence.',
      ],
    },
  }),
  productionFixture({
    example: 11,
    title: '物品 to 产品',
    target: { hanzi: '物品', pinyin: 'wùpǐn', meanings: ['articles', 'goods'] },
    submitted: { hanzi: '产品', pinyin: 'chǎnpǐn', meanings: ['goods', 'merchandise', 'product'] },
    cueText: 'articles; goods',
    learnerNote: null,
    buildResult: (c) => cueRepairAndContrastResult(c, {
      observation: 'The shared “goods” gloss hides the category boundary between general items and produced or commercial products.',
      explanation: '物品 is a broad item, object, or article; 产品 is a product or merchandise resulting from production.',
      replacement: 'item; object; article',
      repairIntent: 'add_distinguishing_anchor',
      title: '物品 / 产品',
      clusterNote: 'General item or object versus produced or commercial product.',
      targetNuance: 'A general item, object, or article.',
      submittedNuance: 'A produced or commercial product or merchandise.',
      targetPrompt: '请把贵重___放进保险箱。',
      targetPromptExplanation: 'The sentence refers broadly to valuable items.',
      submittedPrompt: '这家公司今年推出了三款新___。',
      submittedPromptExplanation: 'The company launches commercial products.',
    }),
    evaluation: cueRepairAndContrastEvaluation('Distinguish general items from produced or commercial products.'),
  }),
  productionFixture({
    example: 12,
    title: '商标 to 标志',
    target: { hanzi: '商标', pinyin: 'shāngbiāo', meanings: ['trademark', 'logo'] },
    submitted: { hanzi: '标志', pinyin: 'biāozhì', meanings: ['sign', 'mark', 'symbol', 'logo', 'to symbolize', 'to indicate'] },
    cueText: 'trademark; logo',
    learnerNote: null,
    buildResult: (c) => cueRepairAndContrastResult(c, {
      observation: 'The submitted word matches the generic “logo” fragment, but the full cue should point to the commercial or legal trademark sense.',
      explanation: '商标 is a trademark or brand mark. 标志 is a much broader sign, mark, symbol, or logo and is not generally a substitute for “trademark.”',
      replacement: 'trademark; brand mark',
      repairIntent: 'add_contextual_triangulation',
      title: '商标 / 标志',
      clusterNote: 'Commercial or legal brand mark versus general sign or symbol.',
      targetNuance: 'A trademark or brand mark identifying commercial origin.',
      submittedNuance: 'A general sign, symbol, mark, or indicator.',
      targetPrompt: '这家公司已经为新品牌注册了___。',
      targetPromptExplanation: 'Registration points to a trademark.',
      submittedPrompt: '红灯通常是停车的___。',
      submittedPromptExplanation: 'A red light functions as a general sign.',
    }),
    evaluation: cueRepairAndContrastEvaluation('Do not accept 标志 merely because it matches the “logo” fragment.'),
  }),
  productionFixture({
    example: 13,
    title: '合成 to 组合',
    target: { hanzi: '合成', pinyin: 'héchéng', meanings: ['to compose', 'to constitute', 'compound', 'synthesis', 'mixture', 'synthetic'] },
    submitted: { hanzi: '组合', pinyin: 'zǔhé', meanings: ['to assemble', 'to combine', 'to compose', 'combination', 'set'] },
    cueText: 'to compose; to constitute; compound; synthesis; mixture; synthetic',
    learnerNote: null,
    buildResult: (c) => cueRepairAndContrastResult(c, {
      observation: 'Generic compose/combine glosses compete with the stronger synthesis and new-whole anchors in the target cue.',
      explanation: '合成 emphasizes synthesis or forming a new whole or compound from components. 组合 emphasizes arranging or combining items into a grouping or combination.',
      replacement: 'to synthesize; to form a new whole by combining parts; synthetic',
      repairIntent: 'add_distinguishing_anchor',
      title: '合成 / 组合',
      clusterNote: 'Synthesis into a new whole versus arrangement or grouping.',
      targetNuance: 'Combine components into a synthesized new whole, compound, or synthetic result.',
      submittedNuance: 'Arrange or combine elements as a group, set, or combination.',
      targetPrompt: '这种材料是由多种化学成分___的。',
      targetPromptExplanation: 'The components form a synthesized material.',
      submittedPrompt: '这几个模块可以自由___。',
      submittedPromptExplanation: 'The modules can be arranged in different combinations.',
    }),
    evaluation: cueRepairAndContrastEvaluation('Recognize sense-triangulation failure rather than treating one generic gloss fragment as sufficient.'),
  }),
  productionFixture({
    example: 14,
    title: '四周 to 四处',
    target: { hanzi: '四周', pinyin: 'sìzhōu', meanings: ['all around'] },
    submitted: { hanzi: '四处', pinyin: 'sìchù', meanings: ['all over the place', 'everywhere', 'in all directions'] },
    cueText: 'all around',
    learnerNote: null,
    buildResult: (c) => cueRepairAndContrastResult(c, {
      observation: 'The cue hides a spatial reference-frame distinction: surrounding a point versus dispersion across places.',
      explanation: '四周 means around or on all sides of a reference point. 四处 means everywhere, in various places, or all over.',
      replacement: 'all around; on all sides; surrounding',
      repairIntent: 'add_distinguishing_anchor',
      title: '四周 / 四处',
      clusterNote: 'Surrounding a reference point versus dispersion across multiple places.',
      targetNuance: 'Around or on all sides of a reference point.',
      submittedNuance: 'Everywhere, in various places, or all over.',
      targetPrompt: '房子___都是高大的树。',
      targetPromptExplanation: 'The trees surround the house.',
      submittedPrompt: '我___找了，还是没找到钥匙。',
      submittedPromptExplanation: 'The speaker searched in many places.',
      interferenceAxes: ['spatial_or_conceptual_frame'],
    }),
    evaluation: cueRepairAndContrastEvaluation('Name the surrounding-reference-point versus dispersed-everywhere distinction.'),
  }),
  productionFixture({
    example: 15,
    title: '失望 to 灰心',
    target: { hanzi: '失望', pinyin: 'shīwàng', meanings: ['disappointed', 'to lose hope', 'to despair'] },
    submitted: { hanzi: '灰心', pinyin: 'huīxīn', meanings: ['to lose heart', 'to be discouraged'] },
    cueText: 'disappointed; to lose hope; to despair',
    learnerNote: null,
    buildResult: (c) => cueRepairAndContrastResult(c, {
      observation: 'The English emotional glosses overlap while the Chinese words profile disappointment and discouraged motivation differently.',
      explanation: '失望 evaluates an unmet hope, result, person, or situation. 灰心 emphasizes losing heart or motivation to continue.',
      replacement: 'to be disappointed; for one’s hopes not to be met',
      repairIntent: 'add_distinguishing_anchor',
      title: '失望 / 灰心',
      clusterNote: 'Disappointment about an outcome versus discouragement and reduced will to continue.',
      targetNuance: 'Disappointed because an expectation or hope was not met.',
      submittedNuance: 'Discouraged or losing heart to continue.',
      targetPrompt: '比赛结果让所有支持者都很___。',
      targetPromptExplanation: 'The result failed to meet supporters’ hopes.',
      submittedPrompt: '虽然失败了几次，你也不要___。',
      submittedPromptExplanation: 'The advice is not to lose motivation to continue.',
    }),
    evaluation: cueRepairAndContrastEvaluation('Distinguish disappointed evaluation from losing motivation to continue.'),
  }),
];

type CueRepairAndContrastSeed = {
  observation: string;
  explanation: string;
  replacement: string;
  repairIntent: Extract<ReflectionHandleOperationV0, { kind: 'repair_production_cue' }>['repairIntent'];
  title: string;
  clusterNote: string;
  targetNuance: string;
  submittedNuance: string;
  targetPrompt: string;
  targetPromptExplanation: string;
  submittedPrompt: string;
  submittedPromptExplanation: string;
  interferenceAxes?: Extract<ReflectionHandleOperationV0, { kind: 'add_contrast_candidate' }>['interferenceAxes'];
};

function cueRepairAndContrastResult(
  context: FixtureContext,
  seed: CueRepairAndContrastSeed,
): Omit<ReflectionItemResultV0, 'itemId'> {
  return baseResult(
    ['cue_overlap_hides_usage_difference'],
    seed.observation,
    seed.explanation,
    [context.cueEvidence, context.attemptEvidence, context.targetEvidence, context.submittedEvidence],
    {
      proposals: [
        proposal(
          `${context.prefix}-repair-cue`,
          `${context.prefix}-repair-and-contrast`,
          'Make the direct-production cue expose the target’s distinguishing anchor.',
          [context.cueEvidence, context.attemptEvidence],
          {
            kind: 'repair_production_cue',
            wordId: context.targetWordId,
            sourceCue: cueRef(context),
            replacementCues: [{ cueType: 'definition_gloss', text: seed.replacement }],
            repairIntent: seed.repairIntent,
          },
        ),
        proposal(
          `${context.prefix}-contrast-content`,
          `${context.prefix}-repair-and-contrast`,
          'Use context to reinforce the boundary that the English glosses obscure.',
          [context.attemptEvidence, context.targetEvidence, context.submittedEvidence],
          {
            kind: 'upsert_contrast_content',
            destination: { mode: 'create_cluster', clusterId: null, title: seed.title },
            clusterNote: seed.clusterNote,
            members: [
              { wordId: context.targetWordId, nuanceNote: seed.targetNuance },
              { wordId: context.submittedWordId, nuanceNote: seed.submittedNuance },
            ],
            prompts: [
              { targetWordId: context.targetWordId, promptText: seed.targetPrompt, explanation: seed.targetPromptExplanation },
              { targetWordId: context.submittedWordId, promptText: seed.submittedPrompt, explanation: seed.submittedPromptExplanation },
            ],
          },
        ),
      ],
    },
  );
}

function cueRepairAndContrastEvaluation(boundaryRequirement: string): ReflectionProviderFixtureV0['evaluation'] {
  return {
    requiredDiagnosisTags: ['cue_overlap_hides_usage_difference'],
    forbiddenDiagnosisTags: ['valid_or_near_valid_alternate', 'ordinary_retrieval_noise'],
    acceptableProposalProfiles: [{
      requiredKinds: ['repair_production_cue', 'upsert_contrast_content'],
      allowedKinds: ['repair_production_cue', 'upsert_contrast_content'],
      description: 'Repair the direct-production cue and separately author contextual contrast content.',
    }],
    questionPolicy: 'none_expected',
    requiredJudgments: [boundaryRequirement, 'Do not accept the submitted word merely because one English gloss overlaps.', 'Keep cue repair and contrast content as atomic proposals.'],
    forbiddenJudgments: ['Treat the submitted word as fully interchangeable.', 'Reduce the result to ordinary retrieval noise.', 'Invent a finite scheduling policy.'],
  };
}

function sessionNoteFixture(): ReflectionProviderFixtureV0 {
  const prefix = 'ex08';
  const itemId = `${prefix}-item`;
  const targetWordId = `${prefix}-target`;
  const relatedWordId = `${prefix}-related`;
  const target = word(targetWordId, {
    hanzi: '习以为常',
    pinyin: 'xí yǐ wéi cháng',
    meanings: ['accustomed to', 'used to'],
  });
  const related = word(relatedWordId, {
    hanzi: '习惯',
    pinyin: 'xíguàn',
    meanings: ['to be used to', 'to get accustomed to', 'habit', 'custom'],
  });
  const item: SessionNoteReflectionItemV0 = {
    itemId,
    source: 'session_note',
    sourceActionKind: 'production',
    sessionActionId: `session-${prefix}/action-1`,
    occurredAt: '2026-07-06T11:55:00.000Z',
    targetWord: target,
    sessionNote: 'I answered correctly through training memory, but I do not know how 习以为常 differs from 习惯.',
    existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
    cuesAsShown: [{
      cueId: null,
      cueType: 'definition_gloss',
      displayOrder: 0,
      text: 'accustomed to; used to',
      displayedMeanings: ['accustomed to', 'used to'],
    }],
    relatedWords: [related],
    linkedAttemptId: null,
  };
  const itemEvidence = citation('reflection_item', `item/${itemId}`, 'The learner explicitly flagged uncertainty after a correct response.');
  const noteEvidence = citation('session_note', `session_note/${itemId}`, 'The learner does not know how 习以为常 differs from 习惯.');
  const targetEvidence = citation('word', `word/${targetWordId}`, 'The target word was 习以为常.');
  const relatedEvidence = citation('word', `word/${relatedWordId}`, 'The related word raised by the learner was 习惯.');
  const result = baseResult(
    ['cue_overlap_hides_usage_difference'],
    'A correct answer still revealed an unresolved, learner-identified boundary between broad accustomedness and treating something as normal.',
    '习惯 broadly describes a habit or being accustomed to something. 习以为常 emphasizes becoming so accustomed that one regards it as normal or unsurprising.',
    [itemEvidence, noteEvidence, targetEvidence, relatedEvidence],
    {
      proposals: [proposal(
        `${prefix}-contrast-candidate`,
        null,
        'Preserve the learner-valued distinction without prematurely authoring or scheduling exercises from one uncertainty note.',
        [noteEvidence, targetEvidence, relatedEvidence],
        {
          kind: 'add_contrast_candidate',
          targetWordId,
          relatedWord: { wordId: relatedWordId, text: null },
          interferenceAxes: ['semantic_overlap', 'collocation_or_event_shape'],
          note: '习惯 is broad accustomedness or habit; 习以为常 adds treating the situation as normal and unsurprising.',
        },
      )],
    },
  );

  return {
    fixtureVersion: 'reflection_provider_fixture.v0',
    fixtureId: 'ex08-xiyiweichang-and-xiguan',
    source: { kind: 'workflow_appendix', document: SOURCE_DOCUMENT, appendixExample: 8, title: '习以为常 / 习惯' },
    readiness: 'ready',
    readinessNotes: ['This is the only appendix fixture sourced from a correct response plus an explicit session note.'],
    inputBundle: bundleFor(prefix, item),
    referenceResult: {
      schemaVersion: 'session_reflection_result.v0',
      bundleSchemaVersion: 'session_reflection_bundle.v0',
      summary: result.observation,
      itemResults: [{ itemId, ...result }],
    },
    evaluation: {
      requiredDiagnosisTags: ['cue_overlap_hides_usage_difference'],
      forbiddenDiagnosisTags: ['ordinary_retrieval_noise', 'valid_or_near_valid_alternate'],
      acceptableProposalProfiles: [
        { requiredKinds: ['add_contrast_candidate'], allowedKinds: ['add_contrast_candidate'], description: 'Preserve the unresolved boundary as a candidate.' },
        noProposalProfile,
      ],
      questionPolicy: 'allowed',
      requiredJudgments: ['Recognize that correct performance can still reveal brittle knowledge.', 'Distinguish broad accustomedness from treating something as normal or unsurprising.', 'Do not frame this as a grading repair.'],
      forbiddenJudgments: ['Accept an alternate answer for an answer that was already correct.', 'Flag the cue as bad solely because the learner requested an explanation.', 'Infer persistent confusion from one note.'],
    },
  };
}

export const workflowAppendixFixtures: ReflectionProviderFixtureV0[] = [
  ...productionFixtures,
  sessionNoteFixture(),
].sort((left, right) => {
  if (left.source.kind !== 'workflow_appendix' || right.source.kind !== 'workflow_appendix') {
    throw new Error('Workflow appendix fixture has a non-appendix source.');
  }
  return left.source.appendixExample - right.source.appendixExample;
});
