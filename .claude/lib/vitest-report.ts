// Parsers for Vitest's JSON test reporter and Istanbul's coverage-final.json.
// Shared by the agent's test runner and the CI verify step, so both report
// test outcomes and coverage the same way.

export type AssertionResult = { fullName?: string; title?: string; status: string; failureMessages?: string[] };
export type TestFileResult = { name: string; status: string; message?: string; assertionResults: AssertionResult[] };
export type VitestJsonReport = {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests?: number;
  numTodoTests?: number;
  success: boolean;
  testResults: TestFileResult[];
};

export type FileOutcome = { file: string; passed: number; failed: number; skipped: number; failures: { name: string; message: string }[]; error: string | null };

const ANSI = /\u001b\[[0-9;]*m/g;

export function summarizeTests(report: VitestJsonReport, toRelative: (absolute: string) => string, maxMessage = 800): FileOutcome[] {
  return report.testResults.map((file) => {
    const failures = file.assertionResults
      .filter((test) => test.status === 'failed')
      .map((test) => ({
        name: test.fullName ?? test.title ?? '(unnamed)',
        message: (test.failureMessages ?? []).join('\n').replace(ANSI, '').slice(0, maxMessage),
      }));
    const skipped = file.assertionResults.filter((test) => ['skipped', 'pending', 'todo', 'disabled'].includes(test.status)).length;
    // A file can fail without any failed assertion (syntax error, failing import, hook error).
    const error = file.status === 'failed' && failures.length === 0 ? (file.message ?? 'test file failed to run').replace(ANSI, '').slice(0, maxMessage) : null;
    return {
      file: toRelative(file.name),
      passed: file.assertionResults.filter((test) => test.status === 'passed').length,
      failed: failures.length + (error ? 1 : 0),
      skipped,
      failures,
      error,
    };
  });
}

type Location = { start: { line: number }; end: { line: number } };
export type IstanbulFileCoverage = {
  path: string;
  statementMap: Record<string, Location>;
  s: Record<string, number>;
  fnMap: Record<string, { loc: Location; name?: string }>;
  f: Record<string, number>;
  branchMap: Record<string, { locations: Location[]; loc?: Location; line?: number }>;
  b: Record<string, number[]>;
};

export type CoverageMetric = { covered: number; total: number; pct: number };
export type FileCoverage = {
  statements: CoverageMetric;
  branches: CoverageMetric;
  functions: CoverageMetric;
  lines: CoverageMetric;
  uncoveredLines: number[];
  /** Lines holding at least one branch that was never taken. */
  partialBranchLines: number[];
};

const metric = (covered: number, total: number): CoverageMetric => ({ covered, total, pct: total === 0 ? 100 : Math.round((covered / total) * 10000) / 100 });

export function fileCoverage(data: IstanbulFileCoverage): FileCoverage {
  const statementIds = Object.keys(data.statementMap);
  const lineHits = new Map<number, number>();
  for (const id of statementIds) {
    const line = data.statementMap[id].start.line;
    lineHits.set(line, Math.max(lineHits.get(line) ?? 0, data.s[id] ?? 0));
  }
  const branchCounts = Object.values(data.b).flat();
  const partial = new Set<number>();
  for (const [id, branch] of Object.entries(data.branchMap)) {
    (data.b[id] ?? []).forEach((count, index) => {
      if (count === 0) partial.add(branch.locations[index]?.start.line ?? branch.loc?.start.line ?? branch.line ?? 0);
    });
  }
  partial.delete(0);
  const uncoveredLines = [...lineHits].filter(([, hits]) => hits === 0).map(([line]) => line).sort((a, b) => a - b);
  return {
    statements: metric(statementIds.filter((id) => (data.s[id] ?? 0) > 0).length, statementIds.length),
    branches: metric(branchCounts.filter((count) => count > 0).length, branchCounts.length),
    functions: metric(Object.values(data.f).filter((count) => count > 0).length, Object.keys(data.f).length),
    lines: metric(lineHits.size - uncoveredLines.length, lineHits.size),
    uncoveredLines,
    partialBranchLines: [...partial].sort((a, b) => a - b),
  };
}

/** Compresses [1,2,3,7,9,10] into "1-3, 7, 9-10". */
export function formatRanges(lines: readonly number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let j = i;
    while (j + 1 < lines.length && lines[j + 1] === lines[j] + 1) j++;
    parts.push(j === i ? `${lines[i]}` : `${lines[i]}-${lines[j]}`);
    i = j;
  }
  return parts.join(', ');
}
