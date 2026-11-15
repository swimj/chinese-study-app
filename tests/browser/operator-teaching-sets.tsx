import { createRoot } from 'react-dom/client';
import { OperatorShell } from '../../src/components/OperatorShell';
import { OperatorPanel } from '../../src/pages/OperatorUsagePulsePage';
import type { OperatorTeachingSetRow } from '../../src/services/api';
import type { ModelInvocationRow } from '../../src/domain/model-invocations';
import '../../src/styles.css';
import '../../src/OperatorApp.css';

const options = new URLSearchParams(location.search);
if (options.has('largeText')) document.documentElement.style.fontSize = '125%';

const teachingSets: OperatorTeachingSetRow[] = [
  {
    wordId: 'gang', hanzi: '帮派', setKey: 'default', senseCount: null, packageCount: 1,
    invocationCount: 1, recordedCostUsd: 0.0259, unpricedInvocationCount: 0,
  },
  {
    wordId: 'gang', hanzi: '帮派', setKey: 'gang-only', senseCount: 1, packageCount: 1,
    invocationCount: 2, recordedCostUsd: 0.0135, unpricedInvocationCount: 1,
  },
  {
    wordId: 'long-label', hanzi: '以史为鉴可以知兴替以人为鉴可以明得失以铜为鉴可以正衣冠',
    setKey: 'long-set', senseCount: 16, packageCount: 1234567, invocationCount: 2345678,
    recordedCostUsd: 12345.6789, unpricedInvocationCount: 1234,
  },
  {
    wordId: 'distil', hanzi: '蒸馏', setKey: 'technical', senseCount: 2, packageCount: 0,
    invocationCount: 3, recordedCostUsd: null, unpricedInvocationCount: 3,
  },
];
const invocation: ModelInvocationRow = {
  id: 'teaching-example', timestamp: '2026-11-15T12:00:00.000Z',
  provider: 'fixture', model: 'example model', invocationType: 'teaching_generation',
  learnerId: null, userDisplayName: null, spendUsd: 0.0259, spendSource: 'reported',
  latencyMs: 1350, status: 'completed',
};

let requests = 0;
window.fetch = async input => {
  const path = new URL(String(input), location.origin).pathname;
  if (path === '/api/operator/model-invocations') return Response.json({ rows: [invocation] });
  if (path === '/api/operator/teaching-sets') {
    requests += 1;
    const output = document.querySelector('output');
    if (output) output.textContent = String(requests);
    if (options.has('fail') && requests === 1) return Response.json({ error: 'Fixture failure' }, { status: 503 });
    return Response.json({ sets: options.has('empty') ? [] : teachingSets });
  }
  return Response.json({ error: 'Unavailable in operator teaching sets preview' }, { status: 404 });
};

createRoot(document.getElementById('root')!).render(
  <>
    <aside className="notes" style={{ padding: '.5rem 1rem', textAlign: 'right' }}>
      Teaching-set requests <output aria-label="Teaching-set requests">0</output>
    </aside>
    <OperatorShell tab="invocations" onNavigate={() => undefined}>
      <OperatorPanel tab="invocations" />
    </OperatorShell>
  </>,
);
