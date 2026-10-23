import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderCoverageSummary } from './coverage-summary.ts';

const metric = (covered: number, total: number) => ({ covered, total, pct: total ? (covered / total) * 100 : 100 });
const file = (covered: number, total: number) => ({
  statements: metric(covered, total),
  branches: metric(covered, total),
  functions: metric(covered, total),
  lines: metric(covered, total),
});

test('renders the total row and per-file rows relative to the project root', () => {
  const output = renderCoverageSummary(
    'Backend',
    { total: file(3, 4), '/repo/backend/src/b.ts': file(1, 2), '/repo/backend/src/a.ts': file(2, 2) },
    '/repo/backend/',
  );

  assert.match(output, /^### Backend coverage/);
  assert.match(output, /\| \*\*All files\*\* \| 75\.00% \| 75\.00% \| 75\.00% \| 75\.00% \|/);
  assert.ok(output.indexOf('| src/a.ts |') < output.indexOf('| src/b.ts |'), 'files are sorted');
  assert.doesNotMatch(output, /\/repo\/backend\//);
});

test('renders "n/a" for metrics Vitest reports as Unknown', () => {
  const unknown = { covered: 0, total: 0, pct: 'Unknown' as const };
  const output = renderCoverageSummary(
    'Frontend',
    { total: { statements: unknown, branches: unknown, functions: unknown, lines: unknown } },
    '/',
  );

  assert.match(output, /\| \*\*All files\*\* \| n\/a \| n\/a \| n\/a \| n\/a \|/);
});
