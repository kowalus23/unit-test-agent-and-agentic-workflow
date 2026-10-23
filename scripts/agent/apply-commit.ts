// Builds the GraphQL `createCommitOnBranch` input for a verified patch.
// Runs in the apply workflow on a checkout of the PR head after `git apply`.
//
// Usage: node scripts/agent/apply-commit.ts --repo <checkout> --patch final.patch --verdict verdict.json
//          --repository owner/name --branch <head ref> --expected-head <sha> --run-id <id> --out input.json
//
// Refuses (exit 1) unless the patch passes the guard again, matches the verdict
// file list and was verified for exactly the expected head commit.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { checkPatch } from '../../.claude/lib/patch-guard.ts';
import { loadPolicy } from '../../.claude/lib/policy.ts';
import { AGENT_TRAILER } from './plan.ts';
import type { Verdict } from './verify.ts';

export type CommitInput = {
  branch: { repositoryNameWithOwner: string; branchName: string };
  expectedHeadOid: string;
  message: { headline: string; body: string };
  fileChanges: { additions: { path: string; contents: string }[] };
};

export function buildCommitInput(args: {
  patch: string;
  verdict: Verdict;
  readFile: (path: string) => Buffer;
  repository: string;
  branch: string;
  expectedHead: string;
  runId: string;
}): CommitInput {
  const guard = checkPatch(loadPolicy(), args.patch);
  if (!guard.ok) throw new Error(`patch rejected by the guard: ${guard.violations.map((violation) => `${violation.path} ${violation.rule}`).join(', ')}`);
  if (args.verdict.head_sha !== args.expectedHead) throw new Error(`the patch was verified for ${args.verdict.head_sha}, not for the current head ${args.expectedHead}`);
  const patchFiles = guard.files.map((file) => file.path).sort();
  const verdictFiles = [...args.verdict.final_patch_files].sort();
  if (patchFiles.length === 0) throw new Error('the verified patch is empty');
  if (JSON.stringify(patchFiles) !== JSON.stringify(verdictFiles)) throw new Error('patch files do not match the verdict');

  const packages = Object.entries(args.verdict.packages).filter(([, pkg]) => pkg.status === 'accepted').map(([name]) => name);
  const tests = Object.values(args.verdict.packages).reduce((sum, pkg) => sum + (pkg.status === 'accepted' ? pkg.new_tests.passed : 0), 0);
  return {
    branch: { repositoryNameWithOwner: args.repository, branchName: args.branch },
    expectedHeadOid: args.expectedHead,
    message: {
      headline: `test: add unit tests verified by the unit-test agent (${packages.join(', ')})`,
      body: [
        `${patchFiles.length} test file(s), ${tests} passing test(s), verified on a clean runner for ${args.expectedHead.slice(0, 12)}.`,
        '',
        ...patchFiles.map((file) => `- ${file}`),
        '',
        `${AGENT_TRAILER} run=${args.runId} source=${args.expectedHead}`,
      ].join('\n'),
    },
    fileChanges: { additions: patchFiles.map((path) => ({ path, contents: args.readFile(path).toString('base64') })) },
  };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string', default: '.' },
      patch: { type: 'string' },
      verdict: { type: 'string' },
      repository: { type: 'string' },
      branch: { type: 'string' },
      'expected-head': { type: 'string' },
      'run-id': { type: 'string' },
      out: { type: 'string' },
    },
  });
  for (const key of ['patch', 'verdict', 'repository', 'branch', 'expected-head', 'run-id', 'out'] as const) {
    if (!values[key]) throw new Error(`--${key} is required`);
  }
  const input = buildCommitInput({
    patch: readFileSync(values.patch!, 'utf8'),
    verdict: JSON.parse(readFileSync(values.verdict!, 'utf8')) as Verdict,
    readFile: (path) => readFileSync(join(values.repo!, path)),
    repository: values.repository!,
    branch: values.branch!,
    expectedHead: values['expected-head']!,
    runId: values['run-id']!,
  });
  writeFileSync(values.out!, JSON.stringify({ input }));
  console.log(`Prepared commit of ${input.fileChanges.additions.length} file(s) on ${values.branch} (expected head ${values['expected-head']}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
