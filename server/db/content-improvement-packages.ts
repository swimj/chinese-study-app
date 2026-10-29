import { createHash, randomUUID } from 'node:crypto';
import {
  ImprovementConflictError, ImprovementInputError, type ImprovementContent, type ImprovementOutcome,
  type ImprovementSource, type ImprovementValidation,
} from '../../src/domain/content-improvement.ts';
import { materializeTeachingPackage } from '../../src/domain/word-content/materialize.ts';
import { parseTeachingPackage, parseWordContent } from '../../src/domain/word-content/validation.ts';
import type { TeachingPackage, WordContentDocument } from '../../src/domain/word-content/types.ts';
import { getDb } from './connection.ts';

type PackageKind = 'teaching_package' | 'rehearsal';
type PackageRow = {
  package_id: string; word_id: string; content_id: string; package_json: string; content_json: string;
  model: string; package_status: string; content_status: string;
};
function rowFor(kind: PackageKind, sourceId: string): PackageRow {
  const packageId = kind === 'rehearsal' ? sourceId.slice(0, sourceId.lastIndexOf('/')) : sourceId;
  const row = getDb().prepare(`SELECT p.package_id,p.word_id,p.content_id,p.package_json,c.content_json,p.model,
    pp.publication_status package_status,cp.publication_status content_status
    FROM word_teaching_packages p JOIN word_content_documents c ON c.content_id=p.content_id
    JOIN shared_content_publications pp ON pp.publication_id=p.publication_id
    JOIN shared_content_publications cp ON cp.publication_id=c.publication_id WHERE p.package_id=?`).get(packageId) as PackageRow | undefined;
  if (!row) throw new ImprovementInputError('Teaching package not found.');
  const pkg = parseTeachingPackage(JSON.parse(row.package_json));
  if (kind === 'rehearsal' && !pkg.rehearsals.some(r => `${packageId}/${r.id}` === sourceId)) {
    throw new ImprovementInputError('Rehearsal not found in teaching package.');
  }
  return row;
}
function replacement(packageId: string): unknown {
  return getDb().prepare("SELECT replacement_source_id FROM content_improvement_replacements WHERE kind='teaching_package' AND source_id=?").get(packageId) ?? null;
}
function preparation(wordId: string): unknown {
  return getDb().prepare('SELECT * FROM word_introduction_preparation WHERE word_id=?').get(wordId) ?? null;
}
function parseProposal(source: ImprovementSource, proposed: ImprovementContent, original: WordContentDocument, originalPackage: TeachingPackage) {
  if (Object.keys(proposed).length !== 2 || !Object.hasOwn(proposed, 'content') || !Object.hasOwn(proposed, 'package')) {
    throw new ImprovementInputError('Expected exactly content and package.');
  }
  const content = parseWordContent(proposed.content);
  const pkg = parseTeachingPackage(proposed.package);
  if (content.id !== original.id || pkg.id !== originalPackage.id || pkg.wordContentId !== content.id) {
    throw new ImprovementInputError('Keep source and package identities unchanged in the draft; new identities are assigned when applied.');
  }
  if (source.kind === 'rehearsal' && !pkg.rehearsals.some(r => `${pkg.id}/${r.id}` === source.sourceId)) {
    throw new ImprovementInputError('The corrected rehearsal must remain in its package.');
  }
  if (JSON.stringify(content.word) !== JSON.stringify(original.word)) throw new ImprovementInputError('Lexical identity cannot be changed by a content correction.');
  if (JSON.stringify(content) === JSON.stringify(original) && JSON.stringify(pkg) === JSON.stringify(originalPackage)) {
    throw new ImprovementInputError('Change the content before applying a correction, or close the case without a change.');
  }
  return { content, pkg, snapshot: materializeTeachingPackage(pkg, [content]) };
}
export function readPackageImprovementSource(kind: PackageKind, sourceId: string): ImprovementSource {
  const row = rowFor(kind, sourceId);
  const content = parseWordContent(JSON.parse(row.content_json));
  const pkg = parseTeachingPackage(JSON.parse(row.package_json));
  const lexical = getDb().prepare('SELECT hanzi,traditional,pinyin FROM lexical_words WHERE id=?').get(row.word_id);
  return {
    kind, sourceId, title: `${kind === 'rehearsal' ? 'Rehearsal' : 'Introduction'}: ${content.word.hanzi}`,
    scope: 'shared', fingerprint: createHash('sha256').update(JSON.stringify({row, lexical, preparation:preparation(row.word_id), replacement:replacement(row.package_id)})).digest('hex'),
    editable: { content, package: pkg }, preview: { content, snapshot: materializeTeachingPackage(pkg, [content]) },
    provenance: row.model === 'operator-improvement'
      ? { source: 'operator-approved content improvement', model: null }
      : { source: 'teaching package', model: row.model },
    impact: ['Publish a new source document and complete teaching package, including rehearsals, for future unpinned learners.',
      'Keep existing learner package pins, served exercises, feedback, and progress unchanged.',
      'Preserve the original source document for other exercises that reference it.'],
  };
}
export function validatePackageImprovement(source: ImprovementSource, proposed: ImprovementContent): ImprovementValidation {
  // Stored documents and database state are invariants, not operator parse errors.
  const row = rowFor(source.kind as PackageKind, source.sourceId);
  const originalContent = parseWordContent(source.editable.content);
  const original = parseTeachingPackage(source.editable.package);
  const rejected = (message: string): ImprovementValidation => ({errors:[message],preview:null,answerSpaceChanged:false});
  if (!['shared_trial','available'].includes(row.package_status) || !['shared_trial','available'].includes(row.content_status)) {
    return rejected('Withdrawn package or source content cannot be corrected through this workspace.');
  }
  if (replacement(row.package_id)) return rejected('This package already has a replacement. Open its replacement to continue.');
  const busy = getDb().prepare('SELECT active_stage FROM word_introduction_preparation WHERE word_id=?').get(row.word_id) as {active_stage:string|null} | undefined;
  if (busy?.active_stage) return rejected('Introduction preparation is in progress. Wait for it to finish before applying a correction.');
  const lexical = getDb().prepare('SELECT hanzi,traditional,pinyin FROM lexical_words WHERE id=?').get(row.word_id) as {hanzi:string; traditional:string|null; pinyin:string} | undefined;
  if (!lexical || lexical.hanzi !== originalContent.word.hanzi || lexical.traditional !== originalContent.word.traditional || lexical.pinyin !== originalContent.word.pinyin) {
    return rejected('Content no longer matches the lexical source.');
  }
  let parsed: ReturnType<typeof parseProposal>;
  try {
    parsed = parseProposal(source, proposed, originalContent, original);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return rejected(error.message);
  }
  const {content,pkg,snapshot} = parsed;
  const answers = (p: typeof pkg) => p.rehearsals.map(r => ({ id:r.id, contract:r.contract, acceptedAnswers:r.acceptedAnswers }));
  return { errors: [], preview: {content, snapshot}, answerSpaceChanged: JSON.stringify(answers(pkg)) !== JSON.stringify(answers(original)) };
}
/** Caller owns the transaction and records the approved evidence. */
export function applyPackageImprovement(source: ImprovementSource, proposed: ImprovementContent,
  context: {actorId:string; caseId:string; now:string}): ImprovementOutcome {
  const current = readPackageImprovementSource(source.kind as PackageKind, source.sourceId);
  if (current.fingerprint !== source.fingerprint) throw new ImprovementConflictError('Production content or its eligibility changed.');
  const validation = validatePackageImprovement(source, proposed);
  if (validation.errors.length) throw new ImprovementInputError(validation.errors.join(' '));
  const { content: originalContent, pkg: originalPackage } = parseProposal(source, proposed, parseWordContent(source.editable.content), parseTeachingPackage(source.editable.package));
  const contentId = randomUUID();
  const packageId = randomUUID();
  const content = { ...originalContent, id: contentId };
  const pkg = { ...originalPackage, id:packageId, wordContentId:contentId,
    rehearsals: originalPackage.rehearsals.map(r => ({ ...r, stimulus: r.stimulus.kind === 'example_cloze'
      ? {...r.stimulus, example:{...r.stimulus.example, contentId}} : r.stimulus })) };
  materializeTeachingPackage(pkg, [content]);
  const db = getDb();
  const publish = (kind:'word_content'|'teaching_package', id:string) => {
    const publicationId = randomUUID();
    db.prepare(`INSERT INTO shared_content_publications
      (publication_id,content_kind,content_id,learning_purpose_key,publication_status,published_at,status_updated_at)
      VALUES (?,?,?,?,'shared_trial',?,?)`).run(publicationId,kind,id,content.word.wordId,context.now,context.now);
    db.prepare(`INSERT INTO shared_content_publication_events
      (event_id,publication_id,from_status,to_status,actor_kind,actor_id,reason,occurred_at)
      VALUES (?,?,NULL,'shared_trial','operator',?,?,?)`).run(randomUUID(),publicationId,context.actorId,`Approved content improvement ${context.caseId}`,context.now);
    return publicationId;
  };
  db.prepare(`INSERT INTO word_content_documents (content_id,word_id,content_json,model,created_at,publication_id)
    VALUES (?,?,?,?,?,?)`).run(contentId,content.word.wordId,JSON.stringify(content),'operator-improvement',context.now,publish('word_content',contentId));
  db.prepare(`INSERT INTO word_teaching_packages (package_id,word_id,content_id,package_json,model,created_at,publication_id)
    VALUES (?,?,?,?,?,?,?)`).run(packageId,content.word.wordId,contentId,JSON.stringify(pkg),'operator-improvement',context.now,publish('teaching_package',packageId));
  db.prepare(`INSERT INTO content_improvement_replacements (kind,source_id,replacement_source_id,case_id,created_at)
    VALUES ('teaching_package',?,?,?,?)`).run(originalPackage.id,packageId,context.caseId,context.now);
  db.prepare(`UPDATE word_introduction_preparation SET content_id=?,package_id=? WHERE word_id=? AND package_id=?`)
    .run(contentId,packageId,content.word.wordId,originalPackage.id);
  const replacementSourceId = source.kind === 'rehearsal'
    ? `${packageId}/${source.sourceId.slice(source.sourceId.lastIndexOf('/')+1)}` : packageId;
  return { replacementSourceId, summary: 'Published a coherent introduction revision for future unpinned learners; existing pins and historical content are preserved.' };
}
