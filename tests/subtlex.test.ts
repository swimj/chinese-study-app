import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubtlex } from '../scripts/lib/subtlex.ts';

test('parseSubtlex parses lemma blocks and PoS rows', () => {
  const contents = `"Total word count: 33,546,516"\r
Lemma\tWF_Lemma\tWordForm\tPoS\tWF_PoS\r
\r
一\t203626\t-\t-\r
@\t@\t一\tm\t197747\r
@\t@\t一\td\t5666\r
\r
后面\t100\t-\t-\r
@\t@\t后面\tn\t80\r
@\t@\t后面\ts\t20\r
`;

  const entries = parseSubtlex(contents);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    lemma: '一',
    lemmaCount: 203626,
    posRows: [
      { wordForm: '一', pos: 'm', count: 197747 },
      { wordForm: '一', pos: 'd', count: 5666 },
    ],
    sourceKey: '一',
  });
  assert.deepEqual(entries[1], {
    lemma: '后面',
    lemmaCount: 100,
    posRows: [
      { wordForm: '后面', pos: 'n', count: 80 },
      { wordForm: '后面', pos: 's', count: 20 },
    ],
    sourceKey: '后面',
  });
});
