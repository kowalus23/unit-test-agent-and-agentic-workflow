// Authoritative check of the patch produced by the unit-test agent. The CI
// verify job runs it on a machine without secrets before applying anything;
// the agent job runs it once more as an early, advisory signal.
import { parsePatch, type PatchFile } from './diff.ts';
import { forbiddenContentIn, isWritable, normalizeRepoPath, packageOf, type PackageName, type TestPolicy } from './policy.ts';

export type Violation = { path: string; rule: string; detail: string };

/** Non-blocking observations surfaced in the PR report. */
export type Notice = { path: string; kind: 'changed_expectations' | 'modified_existing_test'; detail: string };

export type GuardResult = {
  ok: boolean;
  violations: Violation[];
  notices: Notice[];
  files: { path: string; package: PackageName | null; status: PatchFile['status']; added: number; removed: number }[];
};

const SAFE_PATH = /^[A-Za-z0-9._@/-]+$/;
const REGULAR_FILE = '100644';
// A removed or rewritten line that asserted something, or a removed test case.
const ASSERTION_LINE = /\bexpect(?:\.\w+)?\s*\(|\.(?:to|not)\.|\bassert\w*\s*\(|^\s*(?:it|test)\s*\(/;

export function checkPatch(policy: TestPolicy, patch: string): GuardResult {
  const violations: Violation[] = [];
  const notices: Notice[] = [];
  const files = parsePatch(patch);
  const bytes = Buffer.byteLength(patch, 'utf8');
  const { limits } = policy;

  if (patch.trim() !== '' && files.length === 0) {
    violations.push({ path: '(patch)', rule: 'unparseable', detail: 'patch has content but no file headers' });
  }
  if (files.length > limits.maxPatchFiles) {
    violations.push({ path: '(patch)', rule: 'too-many-files', detail: `${files.length} files > ${limits.maxPatchFiles}` });
  }
  if (bytes > limits.maxPatchBytes) {
    violations.push({ path: '(patch)', rule: 'too-large', detail: `${bytes} bytes > ${limits.maxPatchBytes}` });
  }
  const totalAdded = files.reduce((sum, file) => sum + file.addedLines.length, 0);
  if (totalAdded > limits.maxPatchAddedLines) {
    violations.push({ path: '(patch)', rule: 'too-many-lines', detail: `${totalAdded} added lines > ${limits.maxPatchAddedLines}` });
  }

  const seen = new Set<string>();
  for (const file of files) {
    const reject = (rule: string, detail: string) => violations.push({ path: file.path, rule, detail });
    const normalized = normalizeRepoPath(file.path);

    if (!SAFE_PATH.test(file.path) || normalized !== file.path) {
      reject('unsafe-path', 'path must be a normalized repository path of [A-Za-z0-9._@/-]');
      continue;
    }
    if (seen.has(file.path)) reject('duplicate-path', 'file appears twice in the patch');
    seen.add(file.path);
    if (file.oldPath !== file.path || file.status === 'renamed') reject('rename', 'renames and copies are not allowed');
    if (file.status === 'deleted') reject('delete', 'the agent must not delete files; report orphaned tests instead');
    if (file.binary) reject('binary', 'binary content is not allowed');
    if (file.newMode !== null && file.newMode !== REGULAR_FILE) {
      reject('file-mode', `mode ${file.newMode} is not a regular non-executable file (symlinks, submodules and executables are rejected)`);
    }
    if (file.oldMode !== null && file.newMode !== null && file.oldMode !== file.newMode) {
      reject('mode-change', `mode change ${file.oldMode} -> ${file.newMode}`);
    }
    if (!isWritable(policy, file.path)) {
      reject('not-writable', 'path is outside the test files the agent may write');
    }
    for (const rule of forbiddenContentIn(policy, file.addedLines.join('\n'))) {
      reject('forbidden-content', rule.reason);
    }

    if (file.status === 'modified' && file.removedLines.length > 0) {
      const assertions = file.removedLines.filter((line) => ASSERTION_LINE.test(line));
      if (assertions.length > 0) {
        notices.push({
          path: file.path,
          kind: 'changed_expectations',
          detail: `${assertions.length} existing assertion or test-case line(s) changed or removed`,
        });
      } else {
        notices.push({ path: file.path, kind: 'modified_existing_test', detail: `${file.removedLines.length} existing line(s) changed (setup, imports or fixtures)` });
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    notices,
    files: files.map((file) => ({
      path: file.path,
      package: packageOf(policy, file.path),
      status: file.status,
      added: file.addedLines.length,
      removed: file.removedLines.length,
    })),
  };
}
