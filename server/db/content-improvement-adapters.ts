import { createHash, randomUUID } from 'node:crypto';
import type { ContentQualityKind } from '../../src/domain/content-quality.ts';
import { ImprovementInputError, ImprovementConflictError, improvementObject, improvementText, type ImprovementSource, type ImprovementContent, type ImprovementValidation, type ImprovementOutcome } from '../../src/domain/content-improvement.ts';
import type { ContentExercise } from '../../src/domain/word-content/types.ts';
import { materializeExercise } from '../../src/domain/word-content/materialize.ts';
import { config, getDb } from './connection.ts';
import { readPackageImprovementSource, validatePackageImprovement, applyPackageImprovement } from './content-improvement-packages.ts';
type Row = Record<string, string | number | null>;
type ApplyContext = {
    actorId: string;
    caseId: string;
    now: string;
};
function row(sql: string, ...args: string[]): Row {
    const found = getDb().prepare(sql).get(...args) as Row | undefined;
    if (!found)
        throw new ImprovementInputError('Content is unavailable.');
    return found;
}
function rows(sql: string, ...args: string[]): Row[] { return getDb().prepare(sql).all(...args) as Row[]; }
function string(value: Row[string]): string { if (typeof value !== 'string')
    throw new Error('Expected stored string.'); return value; }
function publication(kind: string, id: string): Row | null {
    return getDb().prepare('SELECT * FROM shared_content_publications WHERE content_kind=? AND content_id=?').get(kind, id) as Row | undefined ?? null;
}
function canonical(kind: string, id: string): Row | null {
    return getDb().prepare('SELECT * FROM scoped_review_content_records WHERE kind=? AND content_id=? ORDER BY revision DESC LIMIT 1').get(kind, id) as Row | undefined ?? null;
}
function reviewDependency(kind: string, id: string): unknown {
    const record = canonical(kind, id);
    return { record, sourcePublication: record?.source_word_content_id ? publication('word_content', string(record.source_word_content_id)) : null };
}
function answers(ids: readonly string[]) {
    return ids.map(id => {
        const w = row('SELECT id,hanzi,traditional FROM lexical_words WHERE id=?', id);
        return { wordId: id, hanzi: string(w.hanzi), traditional: w.traditional as string | null };
    });
}
function read(kind: ContentQualityKind, id: string) {
    const db = getDb();
    let data: Row;
    let editable: ImprovementContent;
    let dependencies: unknown[] = [];
    let pub: Row | null;
    if (kind === 'production_cue') {
        data = row('SELECT c.*,t.word_id FROM scoped_production_cues c JOIN production_tasks t ON t.task_id=c.task_id WHERE cue_id=?', id);
        const accepted = rows('SELECT word_id FROM scoped_production_cue_accepted_words WHERE cue_id=? ORDER BY position', id).map(r => string(r.word_id));
        editable = { cueText: data.cue_text, acceptedWordIds: accepted };
        dependencies = [answers(accepted), reviewDependency(kind, id), rows('SELECT * FROM learner_owned_production_cue_activation_state WHERE cue_id=? ORDER BY learner_id', id), rows('SELECT * FROM scoped_production_cue_supplements WHERE cue_id=? ORDER BY supplement_id', id).map(s => ({ row: s, canonical: reviewDependency('production_cue_supplement', string(s.supplement_id)), publication: publication('production_cue_supplement', string(s.supplement_id)), replacement: db.prepare("SELECT * FROM content_improvement_replacements WHERE kind='supplement' AND source_id=?").get(s.supplement_id) }))];
        pub = publication(kind, id);
    }
    else if (kind === 'pure_cue') {
        data = row('SELECT * FROM pure_cues WHERE id=?', id);
        editable = { stimulus: data.stimulus, teachingNote: data.teaching_note };
        dependencies = [answers(rows('SELECT word_id FROM pure_cue_accepted_words WHERE pure_cue_id=? ORDER BY position', id).map(r => string(r.word_id))), canonical(kind, id)];
        pub = publication(kind, id);
    }
    else if (kind === 'contrast_prompt') {
        data = row('SELECT p.*,c.content_scope,c.owner_learner_id FROM scoped_contrast_prompts p JOIN scoped_contrast_clusters c ON c.id=p.cluster_id WHERE p.id=?', id);
        editable = { promptText: data.prompt_text, explanation: data.explanation, targetWordId: data.target_word_id };
        dependencies = [rows('SELECT * FROM scoped_contrast_cluster_members WHERE cluster_id=? ORDER BY word_id', string(data.cluster_id)), answers(rows('SELECT word_id FROM scoped_contrast_cluster_members WHERE cluster_id=? ORDER BY word_id', string(data.cluster_id)).map(r => string(r.word_id)))];
        pub = publication('contrast_cluster', string(data.cluster_id));
    }
    else if (kind === 'supplement') {
        data = row('SELECT s.*,t.word_id FROM scoped_production_cue_supplements s JOIN production_tasks t ON t.task_id=s.task_id WHERE supplement_id=?', id);
        editable = { englishFrame: data.english_frame, exampleSentence: data.example_sentence, exampleTranslation: data.example_translation };
        dependencies = [answers([string(data.word_id)]), reviewDependency('production_cue_supplement', id), data.cue_id ? read('production_cue', string(data.cue_id)) : null];
        pub = publication('production_cue_supplement', id);
    }
    else
        throw new Error('Package adapters must handle packages.');
    const replacement = db.prepare('SELECT * FROM content_improvement_replacements WHERE kind=? AND source_id=?').get(kind, id);
    return { data, editable, dependencies, pub, replacement };
}
export function readImprovementSource(kind: ContentQualityKind, sourceId: string): ImprovementSource {
    if (kind === 'definition_fallback') throw new ImprovementInputError('Definition fallback corrections are not supported.');
    if (kind === 'teaching_package' || kind === 'rehearsal')
        return readPackageImprovementSource(kind, sourceId);
    const state = read(kind, sourceId);
    const scope = state.data.content_scope === 'learner' ? 'private' : 'shared';
    const source: ImprovementSource = { kind, sourceId, scope, title: String(state.editable.cueText ?? state.editable.stimulus ?? state.editable.promptText ?? state.editable.englishFrame),
        provenance: { source: kind === 'pure_cue' ? 'pure cue' : String(state.data.origin_kind ?? kind), model: (canonical(kind === 'supplement' ? 'production_cue_supplement' : kind, sourceId)?.model as string | null | undefined) ?? null },
        fingerprint: createHash('sha256').update(JSON.stringify(state)).digest('hex'), editable: state.editable, preview: state.editable,
        impact: [scope === 'shared' ? 'Applies to future eligible presentations for all learners.' : 'Remains private to the original owner.', 'Already-served snapshots, ratings, and learner progress are preserved.', kind === 'pure_cue' ? 'Repairs wording on the existing cue; its axis, accepted words, and scheduling identity stay fixed.' : 'Creates an immutable replacement and withdraws the original from future selection.'] };
    source.preview = preview(source, state.editable);
    return source;
}
function parse(source: ImprovementSource, input: ImprovementContent): ImprovementContent {
    const expected = Object.keys(source.editable).sort();
    if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(expected))
        throw new ImprovementInputError(`Expected exactly: ${expected.join(', ')}.`);
    const parsed: ImprovementContent = {};
    for (const key of expected) {
        if (key === 'acceptedWordIds') {
            const ids = input[key];
            if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length)
                throw new ImprovementInputError('Accepted words must be a nonempty list of unique word IDs.');
            answers(ids as string[]);
            parsed[key] = ids;
        }
        else
            parsed[key] = improvementText(input[key], key, key !== 'teachingNote').trim();
    }
    const { data } = read(source.kind, source.sourceId);
    if (source.kind === 'production_cue' && ((parsed.acceptedWordIds as string[]).length !== 1 || (parsed.acceptedWordIds as string[])[0] !== data.word_id))
        throw new ImprovementInputError('Production cues must accept exactly their task target; use a pure cue for multiple accepted words.');
    if (source.kind === 'contrast_prompt' && !getDb().prepare('SELECT 1 FROM scoped_contrast_cluster_members WHERE cluster_id=? AND word_id=?').get(data.cluster_id, parsed.targetWordId as string))
        throw new ImprovementInputError('Target must remain a member of this contrast cluster.');
    if (source.kind === 'supplement') {
        const word = answers([string(data.word_id)])[0]!;
        if (!(parsed.exampleSentence as string).includes(word.hanzi) && !(word.traditional && (parsed.exampleSentence as string).includes(word.traditional)))
            throw new ImprovementInputError('Example must contain the target word.');
    }
    return parsed;
}
function exercise(source: ImprovementSource, proposed: ImprovementContent): ContentExercise {
    const { data } = read(source.kind, source.sourceId);
    const pure = source.kind === 'pure_cue';
    const ids = pure ? rows('SELECT word_id FROM pure_cue_accepted_words WHERE pure_cue_id=? ORDER BY position', source.sourceId).map(r => string(r.word_id)) : proposed.acceptedWordIds as string[];
    return { id: `operator-preview:${source.sourceId}`, responseMode: 'hanzi_entry', contract: pure ? { kind: 'pure_review', axisNote: string(data.axis_note) } : { kind: 'targeted_review', wordId: string(data.word_id) }, instruction: '', stimulus: { kind: 'direct_text', text: String(pure ? proposed.stimulus : proposed.cueText) }, acceptedAnswers: answers(ids) };
}
function preview(source: ImprovementSource, proposed: ImprovementContent): unknown {
    if (source.kind === 'production_cue' || source.kind === 'pure_cue') {
        const ex = exercise(source, proposed);
        if (ex.contract.kind === 'pure_review' && !ex.contract.axisNote.trim())
            return { stimulus: proposed.stimulus, axisNote: '', teachingNote: proposed.teachingNote, acceptedAnswers: ex.acceptedAnswers };
        return { ...materializeExercise(ex, [], config.studyProfile), teachingNote: proposed.teachingNote ?? null };
    }
    if (source.kind === 'contrast_prompt')
        return { ...proposed, acceptedAnswers: answers([String(proposed.targetWordId)]) };
    return proposed;
}
export function validateImprovementContent(source: ImprovementSource, proposed: ImprovementContent): ImprovementValidation {
    if (source.kind === 'teaching_package' || source.kind === 'rehearsal')
        return validatePackageImprovement(source, proposed);
    try {
        const parsed = parse(source, improvementObject(proposed));
        const state = read(source.kind, source.sourceId);
        if (JSON.stringify(parsed) === JSON.stringify(parse(source, source.editable)))
            throw new ImprovementInputError('Change the content before applying a correction.');
        const currentCanonical = canonical(source.kind === 'supplement' ? 'production_cue_supplement' : source.kind, source.sourceId);
        if (currentCanonical?.source_word_content_id) {
            const sourcePub = publication('word_content', string(currentCanonical.source_word_content_id));
            if (!sourcePub || !['available', 'shared_trial'].includes(String(sourcePub.publication_status)))
                throw new ImprovementInputError('Pinned source content has been withdrawn.');
        }
        if (source.scope === 'shared' && !state.pub)
            throw new ImprovementInputError('Content has no eligible shared publication.');
        if (source.kind === 'supplement' && state.data.cue_id) {
            const parent = read('production_cue', string(state.data.cue_id));
            if (parent.replacement || (parent.pub && !['shared_trial', 'available'].includes(String(parent.pub.publication_status))))
                throw new ImprovementInputError('The parent cue has been withdrawn or replaced.');
        }
        if (state.replacement)
            throw new ImprovementConflictError('Content already has a replacement; open the replacement instead.');
        if (state.pub && !['shared_trial', 'available'].includes(String(state.pub.publication_status)))
            throw new ImprovementInputError('Withdrawn content cannot be corrected into serving content.');
        return { errors: [], preview: preview(source, parsed), answerSpaceChanged: source.kind === 'production_cue' ? JSON.stringify(parsed.acceptedWordIds) !== JSON.stringify(source.editable.acceptedWordIds) : source.kind === 'contrast_prompt' && parsed.targetWordId !== source.editable.targetWordId };
    }
    catch (error) {
        if (!(error instanceof ImprovementInputError) && !(error instanceof ImprovementConflictError))
            throw error;
        return { errors: [error.message], preview: null, answerSpaceChanged: false };
    }
}
function publish(kind: string, id: string, purpose: string, ctx: ApplyContext, status: Row[string] = 'shared_trial') {
    if (status !== 'available' && status !== 'shared_trial')
        throw new Error('Replacement publication must remain eligible.');
    const publicationId = randomUUID();
    getDb().prepare(`INSERT INTO shared_content_publications VALUES (?,?,?,?,?,?,?)`).run(publicationId, kind, id, purpose, status, ctx.now, ctx.now);
    getDb().prepare(`INSERT INTO shared_content_publication_events VALUES (?,?,NULL,?,'operator',?,?,?)`).run(randomUUID(), publicationId, status, ctx.actorId, `Correction ${ctx.caseId}`, ctx.now);
}
function retire(pub: Row | null, ctx: ApplyContext) {
    if (!pub)
        return;
    getDb().prepare(`INSERT INTO shared_content_publication_events VALUES (?,?,?,'retired','operator',?,?,?)`).run(randomUUID(), pub.publication_id, pub.publication_status, ctx.actorId, `Correction ${ctx.caseId}`, ctx.now);
    getDb().prepare(`UPDATE shared_content_publications SET publication_status='retired',status_updated_at=? WHERE publication_id=?`).run(ctx.now, pub.publication_id);
}
function appendExercise(source: ImprovementSource, proposed: ImprovementContent, id: string, ctx: ApplyContext) {
    const ex = { ...exercise(source, proposed), id: randomUUID() };
    if (ex.contract.kind === 'pure_review' && !ex.contract.axisNote.trim())
        return;
    const previous = canonical(source.kind, id);
    getDb().prepare(`INSERT INTO scoped_review_content_records (record_id,kind,content_id,exercise_id,revision,word_id,source_word_content_id,document_json,created_at,model) VALUES (?,?,?,?,?,?,NULL,?,?,NULL)`).run(randomUUID(), source.kind, id, ex.id, Number(previous?.revision ?? 0) + 1, ex.contract.kind === 'targeted_review' ? ex.contract.wordId : null, JSON.stringify({ schemaVersion: 1, exercise: ex, contents: [] }), ctx.now);
}
export function applyImprovementContent(source: ImprovementSource, proposed: ImprovementContent, ctx: ApplyContext): ImprovementOutcome {
    if (source.kind === 'teaching_package' || source.kind === 'rehearsal')
        return applyPackageImprovement(source, proposed, ctx);
    if (readImprovementSource(source.kind, source.sourceId).fingerprint !== source.fingerprint)
        throw new ImprovementConflictError('Source changed; refresh the case.');
    const checked = validateImprovementContent(source, proposed);
    if (checked.errors.length)
        throw new ImprovementInputError(checked.errors.join(' '));
    const p = parse(source, proposed);
    const { data, pub } = read(source.kind, source.sourceId);
    const db = getDb();
    const id = randomUUID();
    if (source.kind === 'pure_cue') {
        db.prepare(`INSERT INTO operator_pure_cue_repairs (case_id,pure_cue_id,previous_stimulus,stimulus,previous_teaching_note,teaching_note,actor_id,repaired_at) VALUES (?,?,?,?,?,?,?,?)`).run(ctx.caseId, source.sourceId, data.stimulus, p.stimulus as string, data.teaching_note, p.teachingNote as string, ctx.actorId, ctx.now);
        db.prepare('UPDATE pure_cues SET stimulus=?,teaching_note=? WHERE id=?').run(p.stimulus as string, p.teachingNote as string, source.sourceId);
        appendExercise(source, p, source.sourceId, ctx);
        return { replacementSourceId: source.sourceId, summary: 'Current wording repaired; served snapshots, accepted words, and scheduling preserved.' };
    }
    // The successor marker is inserted first so the supplement uniqueness guard can permit its replacement.
    db.prepare('INSERT INTO content_improvement_replacements VALUES (?,?,?,?,?)').run(source.kind, source.sourceId, id, ctx.caseId, ctx.now);
    if (source.kind === 'production_cue') {
        db.prepare(`INSERT INTO scoped_production_cues (cue_id,task_id,cue_type,cue_text,created_at,origin_kind,origin_invocation_id,content_scope,owner_learner_id) VALUES (?,?,?,?,?,'manual',NULL,?,?)`).run(id, data.task_id, data.cue_type, p.cueText as string, ctx.now, data.content_scope, data.owner_learner_id);
        (p.acceptedWordIds as string[]).forEach((wordId, position) => db.prepare('INSERT INTO scoped_production_cue_accepted_words VALUES (?,?,?)').run(id, wordId, position));
        // Preserve each learner's activation disposition; no schedule or evidence moves.
        for (const old of rows('SELECT * FROM learner_owned_production_cue_activation_state WHERE cue_id=?', source.sourceId)) {
            const event = randomUUID();
            db.prepare(`INSERT INTO learner_owned_production_cue_lifecycle_events (learner_id,event_id,cue_id,task_id,lifecycle_kind,occurred_at,invocation_id) VALUES (?,?,?,?,?,?,NULL)`).run(old.learner_id, event, id, data.task_id, old.active === 1 ? 'activated' : 'deactivated', ctx.now);
            db.prepare(`INSERT INTO learner_owned_production_cue_activation_state VALUES (?,?,?,?,?)`).run(old.learner_id, id, old.active, event, ctx.now);
        }
        appendExercise(source, p, id, ctx);
        for (const attachment of rows(`SELECT s.* FROM scoped_production_cue_supplements s WHERE cue_id=? AND NOT EXISTS (SELECT 1 FROM content_improvement_replacements r WHERE r.kind='supplement' AND r.source_id=s.supplement_id)`, source.sourceId)) {
            const attachmentPub = publication('production_cue_supplement', string(attachment.supplement_id));
            if (attachment.content_scope === 'shared' && (!attachmentPub || !['available', 'shared_trial'].includes(String(attachmentPub.publication_status))))
                continue;
            const attachmentCanonical = canonical('production_cue_supplement', string(attachment.supplement_id));
            if (attachmentCanonical?.source_word_content_id) {
                const sourcePublication = publication('word_content', string(attachmentCanonical.source_word_content_id));
                if (!sourcePublication || !['available', 'shared_trial'].includes(String(sourcePublication.publication_status)))
                    continue;
            }
            const supplementId = randomUUID();
            db.prepare(`INSERT INTO scoped_production_cue_supplements (supplement_id,task_id,cue_id,english_frame,example_sentence,example_translation,created_at,origin_invocation_id,content_scope,owner_learner_id) VALUES (?,?,?,?,?,?,?,NULL,?,?)`).run(supplementId, data.task_id, id, attachment.english_frame, attachment.example_sentence, attachment.example_translation, ctx.now, attachment.content_scope, attachment.owner_learner_id);
            const originalCanonical = canonical('production_cue_supplement', string(attachment.supplement_id));
            if (originalCanonical) {
                const envelope = JSON.parse(string(originalCanonical.document_json)) as {
                    source: {
                        kind: string;
                        supplementId?: string;
                        value?: {
                            supplementId: string;
                        };
                    };
                };
                if (envelope.source.kind === 'snapshot' && envelope.source.value)
                    envelope.source.value.supplementId = supplementId;
                else
                    envelope.source.supplementId = supplementId;
                db.prepare(`INSERT INTO scoped_review_content_records (record_id,kind,content_id,exercise_id,revision,word_id,source_word_content_id,document_json,created_at,model) VALUES (?,'production_cue_supplement',?,NULL,1,?,?,?,?,?)`).run(randomUUID(), supplementId, data.word_id, originalCanonical.source_word_content_id, JSON.stringify(envelope), ctx.now, originalCanonical.model);
            }
            if (attachment.content_scope === 'shared')
                publish('production_cue_supplement', supplementId, string(attachmentPub!.learning_purpose_key), ctx, attachmentPub!.publication_status);
        }
        if (source.scope === 'shared') {
            publish('production_cue', id, string(pub!.learning_purpose_key), ctx, pub!.publication_status);
            retire(pub, ctx);
        }
    }
    else if (source.kind === 'contrast_prompt') {
        db.prepare(`INSERT INTO scoped_contrast_prompts (id,cluster_id,target_word_id,prompt_text,explanation) VALUES (?,?,?,?,?)`).run(id, data.cluster_id, p.targetWordId as string, p.promptText as string, p.explanation as string);
    }
    else {
        db.prepare(`INSERT INTO scoped_production_cue_supplements (supplement_id,task_id,cue_id,english_frame,example_sentence,example_translation,created_at,origin_invocation_id,content_scope,owner_learner_id) VALUES (?,?,?,?,?,?,?,NULL,?,?)`).run(id, data.task_id, data.cue_id, p.englishFrame as string, p.exampleSentence as string, p.exampleTranslation as string, ctx.now, data.content_scope, data.owner_learner_id);
        if (source.scope === 'shared') {
            publish('production_cue_supplement', id, string(pub!.learning_purpose_key), ctx, pub!.publication_status);
            retire(pub, ctx);
        }
    }
    return { replacementSourceId: id, summary: 'Replacement applied to future selection; original content and learner history retained.' };
}
