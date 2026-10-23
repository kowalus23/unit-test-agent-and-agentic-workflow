import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { plain, renderReport, REPORT_MARKER } from '../agent/render-report.ts';
import { escalationReason, type Attempt } from '../agent/run-agent.ts';
import { buildCommitInput } from '../agent/apply-commit.ts';
import { judgePackage } from '../agent/verify.ts';

describe('plain()', () => {
  test('strips links, images, HTML, URLs and mentions from model text', () => {
    const text = plain('See [docs](https://evil.example) ![x](https://evil.example/p.png) <img src=x onerror=alert(1)> https://evil.example/?k=SECRET @maintainer');
    assert.ok(!/https?:|<img|\]\(/.test(text), text);
    assert.ok(text.includes('@​maintainer'));
  });
  test('neutralizes markdown control characters and caps length', () => {
    assert.equal(plain('a|b `c`'), 'a\\|b \\`c\\`');
    assert.equal(plain('x'.repeat(50), 10).length, 10);
    assert.equal(plain(undefined), '');
  });
});

describe('renderReport', () => {
  test('explains a skipped run without calling a model', () => {
    const report = renderReport({
      plan: { version: 1, mode: 'pr', base_sha: 'b', head_sha: 'abcdef1234567', run_agent: false, skip_reason: 'no unit-testable source changes', targets: [], dropped_targets: [], ignored: [{ path: 'README.md', reason: 'outside backend/ and frontend/' }], deleted_sources: [], author_test_changes: [], flags: { dependencies_changed: false, agent_config_changed: false, test_config_changed: false, database_changed: false, injection_suspected: false, injection_signals: [] }, routing: null },
      metrics: null,
      result: null,
      verdict: null,
      finalPatch: '',
    });
    assert.ok(report.startsWith(REPORT_MARKER));
    assert.match(report, /skipped/);
    assert.match(report, /No model was called/);
  });

  test('uses a fence longer than any backtick run in the patch', () => {
    const patch = 'diff --git a/x b/x\n+const s = ````;\n';
    const report = renderReport({
      plan: { version: 1, mode: 'pr', base_sha: 'b', head_sha: 'h', run_agent: true, skip_reason: null, targets: [], dropped_targets: [], ignored: [], deleted_sources: [], author_test_changes: [], flags: { dependencies_changed: false, agent_config_changed: false, test_config_changed: false, database_changed: false, injection_suspected: false, injection_signals: [] }, routing: { tier: 'S', model: 'm', effort: 'medium', max_turns: 1, max_budget_usd: 1, escalation_tier: null, reason: 'r' } },
      metrics: null,
      result: null,
      verdict: { version: 1, head_sha: 'h', guard: { ok: true, violations: [], notices: [], files: [] }, packages: { backend: { status: 'not_touched', reasons: [], test_files: [], typecheck: null, baseline: null, patched: null, new_tests: { passed: 0, failed: 0 }, stability: null, coverage: null }, frontend: { status: 'not_touched', reasons: [], test_files: [], typecheck: null, baseline: null, patched: null, new_tests: { passed: 0, failed: 0 }, stability: null, coverage: null } }, targets: [], final_patch_files: ['x'], formatted_files: [] },
      finalPatch: patch,
    });
    assert.ok(report.includes('`````diff'));
  });

  test('only links to GitHub Actions run URLs', () => {
    const base = { plan: null, metrics: null, result: null, verdict: null, finalPatch: '' };
    assert.ok(renderReport({ ...base, runUrl: 'https://github.com/o/r/actions/runs/123' }).includes('[Workflow run]'));
    assert.ok(!renderReport({ ...base, runUrl: 'https://evil.example/actions/runs/1' }).includes('evil'));
  });
});

const suite = (failedTests: string[], files: { file: string; passed: number; failed: number }[], lines = 80) => ({
  ran: true,
  passed: files.reduce((sum, file) => sum + file.passed, 0),
  failed: files.reduce((sum, file) => sum + file.failed, 0),
  failedTests,
  files: files.map((file) => ({ ...file, skipped: 0, failures: [], error: null })),
  coverage: {},
  totals: { lines, branches: 50 },
});

describe('judgePackage', () => {
  const testFiles = ['backend/tests/health.test.ts'];
  const ok = { baseline: true, patched: true };

  test('accepts passing, discovered, stable tests that keep coverage', () => {
    const decision = judgePackage({ testFiles, typecheck: ok, baseline: suite([], [], 30), patched: suite([], [{ file: testFiles[0], passed: 3, failed: 0 }], 35), stability: { failures: [] } });
    assert.equal(decision.status, 'accepted', decision.reasons.join('; '));
  });

  test('blames the patch, not the author, for new failures only', () => {
    const baseline = suite(['backend/tests/router.test.ts > already red'], []);
    const patched = suite(['backend/tests/router.test.ts > already red'], [{ file: testFiles[0], passed: 2, failed: 0 }]);
    assert.equal(judgePackage({ testFiles, typecheck: { baseline: false, patched: false }, baseline, patched, stability: { failures: [] } }).status, 'accepted');
    const regressed = suite(['backend/tests/router.test.ts > was green'], [{ file: testFiles[0], passed: 2, failed: 0 }]);
    assert.equal(judgePackage({ testFiles, typecheck: ok, baseline: suite([], []), patched: regressed, stability: { failures: [] } }).status, 'rejected');
  });

  test('rejects failing, undiscovered, flaky or coverage-reducing patches', () => {
    const reject = (overrides: Partial<Parameters<typeof judgePackage>[0]>) =>
      judgePackage({ testFiles, typecheck: ok, baseline: suite([], [], 50), patched: suite([], [{ file: testFiles[0], passed: 1, failed: 0 }], 50), stability: { failures: [] }, ...overrides }).status;
    assert.equal(reject({ patched: suite([], [{ file: testFiles[0], passed: 1, failed: 1 }], 50) }), 'rejected');
    assert.equal(reject({ patched: suite([], [], 50) }), 'rejected');
    assert.equal(reject({ stability: { failures: ['backend/tests/health.test.ts > flaky'] } }), 'rejected');
    assert.equal(reject({ patched: suite([], [{ file: testFiles[0], passed: 1, failed: 0 }], 40) }), 'rejected');
    assert.equal(reject({ typecheck: { baseline: true, patched: false } }), 'rejected');
  });
});

describe('escalationReason', () => {
  const attempt = { status: 'ok' } as Attempt;
  test('escalates on errors, guard rejections, failing or blocked runs', () => {
    assert.equal(escalationReason(attempt, { targets: [{ local_result: 'passed' }], decision: 'tests_added' }, true), null);
    assert.match(escalationReason({ ...attempt, status: 'no_structured_output' }, null, true) ?? '', /no_structured_output/);
    assert.match(escalationReason(attempt, { targets: [] }, false) ?? '', /guard/);
    assert.match(escalationReason(attempt, { targets: [{ local_result: 'failed' }] }, true) ?? '', /failing/);
    assert.match(escalationReason(attempt, { targets: [], decision: 'blocked' }, true) ?? '', /blocked/);
  });
});

describe('buildCommitInput', () => {
  const patch = ['diff --git a/backend/tests/health.test.ts b/backend/tests/health.test.ts', 'new file mode 100644', 'index 0000000..1111111', '--- /dev/null', '+++ b/backend/tests/health.test.ts', '@@ -0,0 +1 @@', "+it('x', () => {})", ''].join('\n');
  const verdict = (head: string, files: string[]) => ({
    version: 1 as const,
    head_sha: head,
    guard: { ok: true, violations: [], notices: [], files: [] },
    packages: {
      backend: { status: 'accepted' as const, reasons: [], test_files: files, typecheck: null, baseline: null, patched: null, new_tests: { passed: 1, failed: 0 }, stability: null, coverage: null },
      frontend: { status: 'not_touched' as const, reasons: [], test_files: [], typecheck: null, baseline: null, patched: null, new_tests: { passed: 0, failed: 0 }, stability: null, coverage: null },
    },
    targets: [],
    final_patch_files: files,
    formatted_files: [],
  });
  const args = { patch, readFile: () => Buffer.from("it('x', () => {})"), repository: 'o/r', branch: 'feature', expectedHead: 'a'.repeat(40), runId: '7' };

  test('commits exactly the verified files with the agent trailer', () => {
    const input = buildCommitInput({ ...args, verdict: verdict('a'.repeat(40), ['backend/tests/health.test.ts']) });
    assert.equal(input.expectedHeadOid, 'a'.repeat(40));
    assert.deepEqual(input.fileChanges.additions.map((file) => file.path), ['backend/tests/health.test.ts']);
    assert.match(input.message.body, /Unit-Test-Agent: run=7/);
  });
  test('refuses stale, mismatched or unsafe patches', () => {
    assert.throws(() => buildCommitInput({ ...args, verdict: verdict('b'.repeat(40), ['backend/tests/health.test.ts']) }), /verified for/);
    assert.throws(() => buildCommitInput({ ...args, verdict: verdict('a'.repeat(40), ['backend/tests/other.test.ts']) }), /do not match/);
    assert.throws(() => buildCommitInput({ ...args, patch: patch.replaceAll('backend/tests/health.test.ts', 'backend/src/health.ts'), verdict: verdict('a'.repeat(40), ['backend/src/health.ts']) }), /guard/);
  });
});
