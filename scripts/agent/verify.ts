// Independent verification of the agent's patch. Runs in a job without secrets,
// on a clean checkout of the PR head with dependencies installed.
//
// Usage: node scripts/agent/verify.ts --repo <checkout> --plan plan.json --patch agent.patch --out <dir>
//
// Writes <dir>/verdict.json and <dir>/final.patch (only the packages whose
// tests passed every gate). Every number in the PR report comes from here.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { checkPatch, type GuardResult } from '../../.claude/lib/patch-guard.ts';
import { loadPolicy, PACKAGE_NAMES, type PackageName, type TestPolicy } from '../../.claude/lib/policy.ts';
import { fileCoverage, summarizeTests, type FileCoverage, type FileOutcome, type IstanbulFileCoverage, type VitestJsonReport } from '../../.claude/lib/vitest-report.ts';
import type { Plan } from './plan.ts';

export const STABILITY_RUNS = 3;

type SuiteRun = {
  ran: boolean;
  passed: number;
  failed: number;
  failedTests: string[];
  files: FileOutcome[];
  coverage: Record<string, FileCoverage>;
  totals: { lines: number; branches: number } | null;
};

export type PackageVerdict = {
  status: 'accepted' | 'rejected' | 'not_touched';
  reasons: string[];
  test_files: string[];
  typecheck: { baseline: boolean; patched: boolean } | null;
  baseline: Omit<SuiteRun, 'coverage' | 'files'> | null;
  patched: Omit<SuiteRun, 'coverage' | 'files'> | null;
  new_tests: { passed: number; failed: number };
  stability: { runs: number; failures: string[] } | null;
  coverage: { lines_before: number | null; lines_after: number | null; branches_before: number | null; branches_after: number | null } | null;
};

export type TargetCoverage = { source: string; package: PackageName; before: FileCoverage | null; after: FileCoverage | null };

export type Verdict = {
  version: 1;
  head_sha: string;
  guard: GuardResult;
  packages: Record<PackageName, PackageVerdict>;
  targets: TargetCoverage[];
  final_patch_files: string[];
  formatted_files: string[];
};

function exec(cmd: string, args: string[], cwd: string, timeoutMs = 300_000) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, TZ: 'UTC', CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1' },
  });
}

function runSuite(packageRoot: string, repo: string, out: string, opts: { coverage: boolean; files?: string[]; seed?: number }): SuiteRun {
  mkdirSync(out, { recursive: true });
  const report = join(out, 'report.json');
  const coverageDir = join(out, 'coverage');
  const args = ['run', ...(opts.files ?? []), '--reporter=json', `--outputFile=${report}`];
  if (opts.coverage) {
    args.push('--coverage.enabled=true', '--coverage.reporter=json', '--coverage.reporter=json-summary', `--coverage.reportsDirectory=${coverageDir}`, '--coverage.reportOnFailure=true');
  }
  if (opts.seed !== undefined) args.push('--sequence.shuffle', `--sequence.seed=${opts.seed}`);
  exec(join(packageRoot, 'node_modules/.bin/vitest'), args, packageRoot);
  if (!existsSync(report)) return { ran: false, passed: 0, failed: 0, failedTests: [], files: [], coverage: {}, totals: null };

  const files = summarizeTests(JSON.parse(readFileSync(report, 'utf8')) as VitestJsonReport, (absolute) => relative(repo, absolute));
  const coverage: Record<string, FileCoverage> = {};
  let totals: SuiteRun['totals'] = null;
  const finalFile = join(coverageDir, 'coverage-final.json');
  if (opts.coverage && existsSync(finalFile)) {
    for (const [path, data] of Object.entries(JSON.parse(readFileSync(finalFile, 'utf8')) as Record<string, IstanbulFileCoverage>)) {
      coverage[relative(repo, path)] = fileCoverage(data);
    }
    const summary = JSON.parse(readFileSync(join(coverageDir, 'coverage-summary.json'), 'utf8')) as { total: { lines: { pct: number }; branches: { pct: number } } };
    totals = { lines: summary.total.lines.pct, branches: summary.total.branches.pct };
  }
  return {
    ran: true,
    passed: files.reduce((sum, file) => sum + file.passed, 0),
    failed: files.reduce((sum, file) => sum + file.failed, 0),
    failedTests: files.flatMap((file) => [...file.failures.map((failure) => `${file.file} > ${failure.name}`), ...(file.error ? [`${file.file} (did not run)`] : [])]),
    files,
    coverage,
    totals,
  };
}

const strip = ({ coverage: _coverage, files: _files, ...rest }: SuiteRun) => rest;

function typecheck(packageRoot: string): boolean {
  return exec('npm', ['run', '--silent', 'typecheck'], packageRoot).status === 0;
}

/** Decides one package. Pure, so the acceptance rules are unit-tested. */
export function judgePackage(input: {
  testFiles: string[];
  typecheck: { baseline: boolean; patched: boolean };
  baseline: SuiteRun;
  patched: SuiteRun;
  stability: { failures: string[] };
}): { status: 'accepted' | 'rejected'; reasons: string[]; newTests: { passed: number; failed: number } } {
  const reasons: string[] = [];
  const own = input.patched.files.filter((file) => input.testFiles.includes(file.file));
  const newTests = { passed: own.reduce((sum, file) => sum + file.passed, 0), failed: own.reduce((sum, file) => sum + file.failed, 0) };

  if (!input.patched.ran) reasons.push('the test suite did not produce a report after applying the patch');
  if (input.typecheck.baseline && !input.typecheck.patched) reasons.push('type check fails with the patch (passes without it)');
  for (const file of input.testFiles) {
    if (!input.patched.files.some((outcome) => outcome.file === file)) reasons.push(`${file} was not discovered by the test runner`);
  }
  if (newTests.failed > 0) reasons.push(`${newTests.failed} test(s) in the agent's test files fail`);
  if (newTests.passed === 0 && input.testFiles.length > 0) reasons.push('the agent test files contain no passing tests');
  const regressions = input.patched.failedTests.filter((test) => !input.baseline.failedTests.includes(test) && !input.testFiles.some((file) => test.startsWith(`${file} `)));
  if (regressions.length > 0) reasons.push(`previously passing tests now fail: ${regressions.slice(0, 5).join('; ')}`);
  if (input.stability.failures.length > 0) reasons.push(`unstable under shuffled re-runs: ${[...new Set(input.stability.failures)].slice(0, 5).join('; ')}`);
  const before = input.baseline.totals?.lines;
  const after = input.patched.totals?.lines;
  if (before !== undefined && after !== undefined && after + 0.1 < before) reasons.push(`line coverage dropped from ${before}% to ${after}%`);
  return { status: reasons.length === 0 ? 'accepted' : 'rejected', reasons, newTests };
}

function git(repo: string, args: string[], env?: Record<string, string>) {
  return spawnSync('git', ['-C', repo, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
}

function patchFor(repo: string, scratch: string, paths: string[]): string {
  if (paths.length === 0) return '';
  const env = { GIT_INDEX_FILE: join(scratch, 'final.index') };
  git(repo, ['read-tree', 'HEAD'], env);
  git(repo, ['add', '--', ...paths], env);
  const patch = git(repo, ['diff', '--cached', '--binary', '--no-renames', '--no-ext-diff', '--no-textconv', 'HEAD', '--', ...paths], env).stdout;
  rmSync(env.GIT_INDEX_FILE, { force: true });
  return patch;
}

function emptyPackage(): PackageVerdict {
  return { status: 'not_touched', reasons: [], test_files: [], typecheck: null, baseline: null, patched: null, new_tests: { passed: 0, failed: 0 }, stability: null, coverage: null };
}

export function verify(policy: TestPolicy, repo: string, plan: Plan, patch: string, out: string): { verdict: Verdict; finalPatch: string } {
  const guard = checkPatch(policy, patch);
  const packages = Object.fromEntries(PACKAGE_NAMES.map((name) => [name, emptyPackage()])) as Record<PackageName, PackageVerdict>;
  const verdict: Verdict = { version: 1, head_sha: plan.head_sha, guard, packages, targets: [], final_patch_files: [], formatted_files: [] };
  const touched = PACKAGE_NAMES.filter((name) => guard.files.some((file) => file.package === name));

  if (!guard.ok) {
    for (const name of touched) packages[name] = { ...emptyPackage(), status: 'rejected', reasons: ['patch rejected by the guard'], test_files: guard.files.filter((file) => file.package === name).map((file) => file.path) };
    return { verdict, finalPatch: '' };
  }

  const roots = Object.fromEntries(PACKAGE_NAMES.map((name) => [name, join(repo, policy.packages[name].root)])) as Record<PackageName, string>;
  const targetPackages = new Set([...touched, ...plan.targets.map((target) => target.package)]);
  const baselines = {} as Record<PackageName, { run: SuiteRun; typecheck: boolean }>;
  for (const name of targetPackages) {
    baselines[name] = { run: runSuite(roots[name], repo, join(out, name, 'baseline'), { coverage: true }), typecheck: touched.includes(name) ? typecheck(roots[name]) : true };
  }

  if (patch.trim() !== '') {
    const patchFile = join(out, 'agent.patch');
    writeFileSync(patchFile, patch);
    const check = git(repo, ['apply', '--check', patchFile]);
    if (check.status !== 0) {
      for (const name of touched) packages[name] = { ...emptyPackage(), status: 'rejected', reasons: [`patch does not apply: ${check.stderr.trim().slice(0, 300)}`] };
      return { verdict, finalPatch: '' };
    }
    git(repo, ['apply', patchFile]);
  }

  // Formatting is mechanical, so it is applied here instead of being left to the model.
  const frontendFiles = guard.files.filter((file) => file.package === 'frontend').map((file) => file.path);
  if (frontendFiles.length > 0) {
    exec(join(roots.frontend, 'node_modules/.bin/prettier'), ['--write', ...frontendFiles.map((file) => relative(roots.frontend, join(repo, file)))], roots.frontend);
    verdict.formatted_files = frontendFiles;
  }

  const accepted: string[] = [];
  const patchedRuns = {} as Record<PackageName, SuiteRun>;
  for (const name of targetPackages) {
    patchedRuns[name] = touched.includes(name) ? runSuite(roots[name], repo, join(out, name, 'patched'), { coverage: true }) : baselines[name].run;
  }
  for (const name of touched) {
    const testFiles = guard.files.filter((file) => file.package === name && /\.test\.tsx?$/.test(file.path)).map((file) => file.path);
    const patched = patchedRuns[name];
    const typecheckResult = { baseline: baselines[name].typecheck, patched: typecheck(roots[name]) };
    const stabilityFailures: string[] = [];
    for (let seed = 1; seed <= STABILITY_RUNS && testFiles.length > 0; seed++) {
      const rerun = runSuite(roots[name], repo, join(out, name, `stability-${seed}`), { coverage: false, seed, files: testFiles.map((file) => relative(roots[name], join(repo, file))) });
      if (!rerun.ran) stabilityFailures.push(`seed ${seed}: no report`);
      stabilityFailures.push(...rerun.failedTests);
    }
    const decision = judgePackage({ testFiles, typecheck: typecheckResult, baseline: baselines[name].run, patched, stability: { failures: stabilityFailures } });
    packages[name] = {
      status: decision.status,
      reasons: decision.reasons,
      test_files: guard.files.filter((file) => file.package === name).map((file) => file.path),
      typecheck: typecheckResult,
      baseline: strip(baselines[name].run),
      patched: strip(patched),
      new_tests: decision.newTests,
      stability: { runs: STABILITY_RUNS, failures: [...new Set(stabilityFailures)] },
      coverage: {
        lines_before: baselines[name].run.totals?.lines ?? null,
        lines_after: patched.totals?.lines ?? null,
        branches_before: baselines[name].run.totals?.branches ?? null,
        branches_after: patched.totals?.branches ?? null,
      },
    };
    if (decision.status === 'accepted') accepted.push(...packages[name].test_files);
  }

  verdict.targets = plan.targets.map((target) => ({
    source: target.source,
    package: target.package,
    before: baselines[target.package]?.run.coverage[target.source] ?? null,
    after: patchedRuns[target.package]?.coverage[target.source] ?? null,
  }));
  verdict.final_patch_files = accepted;
  return { verdict, finalPatch: patchFor(repo, out, accepted) };
}

function main(): void {
  const { values } = parseArgs({ options: { repo: { type: 'string', default: '.' }, plan: { type: 'string' }, patch: { type: 'string' }, out: { type: 'string' } } });
  if (!values.plan || !values.patch || !values.out) throw new Error('--plan, --patch and --out are required');
  const out = resolve(values.out);
  mkdirSync(out, { recursive: true });
  const plan = JSON.parse(readFileSync(values.plan, 'utf8')) as Plan;
  const patch = existsSync(values.patch) ? readFileSync(values.patch, 'utf8') : '';
  const { verdict, finalPatch } = verify(loadPolicy(), resolve(values.repo!), plan, patch, out);
  writeFileSync(join(out, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);
  writeFileSync(join(out, 'final.patch'), finalPatch);
  for (const [name, result] of Object.entries(verdict.packages)) {
    if (result.status !== 'not_touched') console.log(`${name}: ${result.status}${result.reasons.length ? ` (${result.reasons.join('; ')})` : ''}`);
  }
  if (!verdict.guard.ok) console.log(`guard: ${verdict.guard.violations.map((violation) => `${violation.path}: ${violation.rule}`).join('; ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
