import assert from 'node:assert/strict';
import test from 'node:test';
import type { VocabularyIntakeCard, VocabularyIntakeStreamEvent } from '../src/domain/vocabulary-intake.ts';
import { defaultIntakeSelection, intakeSelectionFitsCard, toggleIntakeSense } from '../src/features/vocabulary-intake/sense-selection.ts';
import { readVocabularyIntakeStream } from '../src/services/vocabulary-intake-stream.ts';

const prepared: VocabularyIntakeCard = {
  id: 'card', version: 1, wordId: 'word', hanzi: '帮派', pinyin: 'bāngpài',
  state: 'added',
  senses: [
    { senseId: 'gang', label: 'a gang', notes: [], isDefault: true, disposition: 'default' },
    { senseId: 'faction', label: 'a faction', notes: [], isDefault: true, disposition: 'default' },
  ],
  selection: { senseIds: ['gang', 'faction'], includeProposedSense: false, targetSenseId: 'gang' },
  defaultsEstablished: true, proposedSense: null, versions: { learner: 1, catalog: 1, selection: 1 },
  actions: ['change_senses'], presets: [], attention: null,
};

test('toggling the target preserves checked senses and clearing all is rejected', () => {
  const onlyFaction = toggleIntakeSense(prepared.selection, 'gang', false);
  assert.deepEqual(onlyFaction, { senseIds: ['faction'], includeProposedSense: false, targetSenseId: null });
  assert.ok(intakeSelectionFitsCard(prepared, onlyFaction));
  assert.equal(intakeSelectionFitsCard(prepared, toggleIntakeSense(onlyFaction, 'faction', false)), false);
  assert.deepEqual(defaultIntakeSelection(prepared), {
    senseIds: ['gang', 'faction'], includeProposedSense: false, targetSenseId: null,
  });
});

test('unknown inventory permits pending Add, and a removed proposed sense cannot be resaved', () => {
  const empty = { senseIds: [], includeProposedSense: false, targetSenseId: null };
  const unknown: VocabularyIntakeCard = {
    ...prepared, state: 'proposed', senses: [], defaultsEstablished: false, selection: empty,
  };
  assert.ok(intakeSelectionFitsCard(unknown, empty));
  assert.equal(intakeSelectionFitsCard({ ...unknown, defaultsEstablished: true }, empty), false);
  const newOnly = { ...empty, includeProposedSense: true };
  assert.ok(intakeSelectionFitsCard({ ...unknown, proposedSense: { label: 'new', notes: [] } }, newOnly));
  assert.equal(intakeSelectionFitsCard(unknown, newOnly), false);
});

function byteStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const byte of new TextEncoder().encode(text)) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
}

test('intake streams decode split Unicode, SSE comments, multiline data and mixed boundaries', async () => {
  const events: VocabularyIntakeStreamEvent[] = [];
  const text = ': keep-alive\r\n\r\nevent: message\r\ndata: {"type": "completion",\ndata: "assistantText": "帮派", "cards": []}\r\r'
    + 'data: {"type":"done","turnId":"turn-1"}\n\n';
  await readVocabularyIntakeStream(byteStream(text), event => events.push(event));
  assert.deepEqual(events, [{ type: 'completion', assistantText: '帮派', cards: [] }, { type: 'done', turnId: 'turn-1' }]);
});

test('an interrupted stream does not acknowledge a turn', async () => {
  const events: VocabularyIntakeStreamEvent[] = [];
  await assert.rejects(
    readVocabularyIntakeStream(byteStream('data: {"type":"progress","stage":"checking"}\n\n'), event => events.push(event)),
    /reply was interrupted/,
  );
  assert.deepEqual(events, [{ type: 'progress', stage: 'checking' }]);
});

test('done requires one complete package and progress cannot follow it', async () => {
  for (const events of [
    [{type:'done',turnId:'missing'}],
    [{type:'completion',assistantText:'Answer.',cards:[]},{type:'completion',assistantText:'Duplicate.',cards:[]}],
    [{type:'completion',assistantText:'Answer.',cards:[]},{type:'progress',stage:'checking'}],
  ]) await assert.rejects(readVocabularyIntakeStream(byteStream(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')),()=>{}));
});
