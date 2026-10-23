// The single entry point the unit-test agent uses to run tests.
//
// Usage: node .claude/skills/running-unit-tests/scripts/run-tests.ts <backend|frontend> [paths...]
//   paths: repository-relative test files to run and/or source files to report coverage for.
//   No test files: the whole package suite runs.
//
// Prints a compact, model-friendly summary. Pass/fail comes from Vitest's JSON
// report, not from its exit code (coverage thresholds of unrelated files would
// otherwise turn a passing run red).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSourceFile, isTestFile, loadPolicy, normalizeRepoPath, packageOf, PACKAGE_NAMES, type PackageName } from '../../../lib/policy.ts';
import { fileCoverage, formatRanges, summarizeTests, type IstanbulFileCoverage, type VitestJsonReport } from '../../../lib/vitest-report.ts';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');

function fail(message: string): never {
  process.stderr.write(`run-tests: ${message}\n`);
  process.exit(2);
}

function main(): void {
  const [pkgArg, ...paths] = process.argv.slice(2);
  const policy = loadPolicy();
  if (!PACKAGE_NAMES.includes(pkgArg as PackageName)) fail(`first argument must be one of: ${PACKAGE_NAMES.join(', ')}`);
  const pkg = pkgArg as PackageName;
  const packageRoot = join(REPO_ROOT, policy.packages[pkg].root);

  const tests: string[] = [];
  const sources: string[] = [];
  for (const raw of paths) {
    const path = normalizeRepoPath(raw);
    if (!path || packageOf(policy, path) !== pkg) fail(`${raw} is not a path inside ${pkg}/`);
    if (!existsSync(join(REPO_ROOT, path))) fail(`${path} does not exist`);
    if (isTestFile(policy, path)) tests.push(path);
    else if (isSourceFile(policy, path)) sources.push(path);
    else fail(`${path} is neither a test file nor a unit-testable source file`);
  }

  const vitest = join(packageRoot, 'node_modules', '.bin', 'vitest');
  if (!existsSync(vitest)) fail(`${pkg} dependencies are not installed (missing node_modules/.bin/vitest)`);
  const out = mkdtempSync(join(tmpdir(), `unit-test-agent-${pkg}-`));
  const reportFile = join(out, 'report.json');
  const coverageDir = join(out, 'coverage');
  const toPackage = (path: string) => relative(packageRoot, join(REPO_ROOT, path));

  const args = [
    'run',
    ...tests.map(toPackage),
    '--reporter=json',
    `--outputFile=${reportFile}`,
    '--coverage.enabled=true',
    '--coverage.reporter=json',
    `--coverage.reportsDirectory=${coverageDir}`,
    '--coverage.reportOnFailure=true',
  ];
  const run = spawnSync(vitest, args, {
    cwd: packageRoot,
    encoding: 'utf8',
    env: { ...process.env, TZ: process.env.TZ ?? 'UTC', CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1' },
    timeout: 240_000,
    maxBuffer: 32 * 1024 * 1024,
  });

  if (!existsSync(reportFile)) {
    const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim().slice(-3000);
    fail(`Vitest did not produce a report (exit ${run.status ?? run.signal}).\n${output}`);
  }
  const report = JSON.parse(readFileSync(reportFile, 'utf8')) as VitestJsonReport;
  const outcomes = summarizeTests(report, (absolute) => relative(REPO_ROOT, absolute));
  const failed = outcomes.reduce((sum, file) => sum + file.failed, 0);
  const passed = outcomes.reduce((sum, file) => sum + file.passed, 0);

  const lines: string[] = [`RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed} passed, ${failed} failed, ${outcomes.length} file(s))`];
  for (const file of outcomes) {
    lines.push(`- ${file.file}: ${file.passed} passed, ${file.failed} failed${file.skipped ? `, ${file.skipped} skipped` : ''}`);
    if (file.error) lines.push(`  ERROR: ${file.error.replace(/\n/g, '\n    ')}`);
    for (const failure of file.failures) lines.push(`  FAIL ${failure.name}\n    ${failure.message.replace(/\n/g, '\n    ')}`);
  }

  const coverageFile = join(coverageDir, 'coverage-final.json');
  if (sources.length > 0) {
    lines.push('', 'COVERAGE (statements / branches / functions / lines):');
    const coverage = existsSync(coverageFile) ? (JSON.parse(readFileSync(coverageFile, 'utf8')) as Record<string, IstanbulFileCoverage>) : {};
    for (const source of sources) {
      const data = coverage[join(REPO_ROOT, source)];
      if (!data) {
        lines.push(`- ${source}: not loaded by the selected tests`);
        continue;
      }
      const c = fileCoverage(data);
      lines.push(`- ${source}: ${c.statements.pct}% / ${c.branches.pct}% / ${c.functions.pct}% / ${c.lines.pct}%`);
      if (c.uncoveredLines.length) lines.push(`  uncovered lines: ${formatRanges(c.uncoveredLines)}`);
      if (c.partialBranchLines.length) lines.push(`  lines with untaken branches: ${formatRanges(c.partialBranchLines)}`);
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
