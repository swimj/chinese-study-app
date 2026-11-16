import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

type Target = { expr: string; refId: string };
type Panel = { id: number; targets?: Target[] };

test('Litestream dashboard queries show correct units, startup gaps and unavailable telemetry', {
  skip: !process.env.PROMTOOL_PATH && 'Set PROMTOOL_PATH to run Prometheus query evaluation.',
}, () => {
  const dashboard: { panels: Panel[] } = JSON.parse(fs.readFileSync('deploy/fly/grafana/chinese-study-observability.json', 'utf8'));
  const query = (id: number, refId: string) => {
    const expression = dashboard.panels.find(p => p.id === id)?.targets?.find(t => t.refId === refId)?.expr;
    assert(expression);
    return expression.replaceAll('$app', 'test');
  };
  const labels = '{app="test",instance="one"}';
  const series = (metric: string, values: string) => ({ series: metric + labels, values });
  const input = [
    series('chinese_study_process_cpu_seconds_total', '0+0.6x10'),
    series('chinese_study_litestream_cpu_seconds_total', '0+0.9x10'),
    series('fly_instance_cpu_baseline', '0.0625+0x10'),
    series('chinese_study_litestream_metrics_available', '1+0x10'),
    series('chinese_study_litestream_start_time_seconds', '0+0x10'),
    series('chinese_study_litestream_local_file_sequence', '100+12x10'),
    series('chinese_study_litestream_uploaded_files_total', '0+15x10'),
    series('chinese_study_backup_replication_age_seconds', '2+0x10'),
  ];
  const check = (id: number, refId: string, value?: number) => ({
    // Ignore insignificant floating-point rounding; round also removes metric names.
    expr: `round((${query(id, refId)}), 0.000001)`, eval_time: '10m',
    exp_samples: value === undefined ? [] : [{ labels, value }],
  });
  const tests = [
    {
      name: 'healthy single shared CPU and file rates', interval: '1m', input_series: input,
      promql_expr_test: [check(23, 'A', 16), check(23, 'B', 24), check(24, 'A', 12), check(24, 'B', 15), check(25, 'A', 2)],
    },
    {
      name: 'missing daemon leaves gaps instead of stale rate estimates', interval: '1m',
      input_series: input.map(s => s.series.startsWith('chinese_study_litestream_metrics_available') ? { ...s, values: '1+0x9 0' } : s),
      promql_expr_test: [check(23, 'A', 16), check(23, 'B'), check(24, 'A'), check(24, 'B')],
    },
    {
      name: 'missing CPU allocation does not invent a denominator', interval: '1m',
      input_series: input.filter(s => !s.series.startsWith('fly_instance_cpu_baseline')),
      promql_expr_test: [check(23, 'A'), check(23, 'B')],
    },
    {
      name: 'daemon startup hides restored file position', interval: '1m',
      input_series: input.map(s => s.series.startsWith('chinese_study_litestream_start_time_seconds') ? { ...s, values: '540+0x10' } : s),
      promql_expr_test: [check(24, 'A')],
    },
    {
      name: 'allocation scales CPU percentages without fixed machine assumptions', interval: '1m',
      input_series: input.map(s => s.series.startsWith('fly_instance_cpu_baseline') ? { ...s, values: '0.125+0x10' } : s),
      promql_expr_test: [check(23, 'A', 8), check(23, 'B', 12)],
    },
    {
      name: 'unavailable backup status is a gap, not zero age', interval: '1m',
      input_series: input.map(s => s.series.startsWith('chinese_study_backup_replication_age_seconds') ? { ...s, values: '-1+0x10' } : s),
      promql_expr_test: [check(25, 'A')],
    },
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'litestream-promql-'));
  try {
    const file = path.join(dir, 'queries.json');
    fs.writeFileSync(file, JSON.stringify({ evaluation_interval: '1m', tests }));
    execFileSync(process.env.PROMTOOL_PATH!, ['test', 'rules', file], { stdio: 'pipe' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
