import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkPatch } from '../../.claude/lib/patch-guard.ts';
import { loadPolicy } from '../../.claude/lib/policy.ts';

const policy = loadPolicy();

const newFile = (path: string, lines: string[], mode = '100644') =>
  [`diff --git a/${path} b/${path}`, `new file mode ${mode}`, 'index 0000000..1111111', '--- /dev/null', `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`), ''].join('\n');

const modifiedFile = (path: string, removed: string[], added: string[]) =>
  [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`, `@@ -1,${removed.length} +1,${added.length} @@`, ...removed.map((line) => `-${line}`), ...added.map((line) => `+${line}`), ''].join('\n');

const TEST = ["import { expect, it } from 'vitest';", "it('returns ok', () => {", '  expect(1).toBe(1);', '});'];
const rules = (patch: string) => checkPatch(policy, patch).violations.map((violation) => violation.rule);

describe('checkPatch', () => {
  test('accepts new and extended test files', () => {
    const result = checkPatch(policy, newFile('backend/tests/health.test.ts', TEST) + newFile('frontend/src/lib/http.test.ts', TEST));
    assert.equal(result.ok, true, JSON.stringify(result.violations));
    assert.deepEqual(result.files.map((file) => file.package), ['backend', 'frontend']);
  });

  test('accepts an empty patch', () => {
    assert.equal(checkPatch(policy, '').ok, true);
  });

  test('rejects production code, configuration and CI changes', () => {
    assert.deepEqual(rules(newFile('backend/src/features/todos/router.ts', ['export {}'])), ['not-writable']);
    assert.deepEqual(rules(modifiedFile('backend/package.json', ['{}'], ['{"scripts":{}}'])), ['not-writable']);
    assert.deepEqual(rules(modifiedFile('backend/vitest.config.ts', ['a'], ['b'])), ['not-writable']);
    assert.deepEqual(rules(newFile('.github/workflows/x.yml', ['on: push'])), ['not-writable']);
    assert.deepEqual(rules(newFile('frontend/src/test/setup.ts', ['x'])), ['not-writable']);
  });

  test('rejects deletions, renames, symlinks, submodules, executables and binaries', () => {
    assert.ok(rules(['diff --git a/backend/tests/router.test.ts b/backend/tests/router.test.ts', 'deleted file mode 100644', 'index 1111111..0000000', '--- a/backend/tests/router.test.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-x', ''].join('\n')).includes('delete'));
    assert.ok(rules(['diff --git a/backend/tests/a.test.ts b/backend/tests/b.test.ts', 'similarity index 100%', 'rename from backend/tests/a.test.ts', 'rename to backend/tests/b.test.ts', ''].join('\n')).includes('rename'));
    assert.ok(rules(newFile('backend/tests/link.test.ts', ['../../.env'], '120000')).includes('file-mode'));
    assert.ok(rules(newFile('backend/tests/sub', ['Subproject commit abc'], '160000')).includes('file-mode'));
    assert.ok(rules(newFile('backend/tests/run.test.ts', TEST, '100755')).includes('file-mode'));
    assert.ok(rules(['diff --git a/backend/tests/a.test.ts b/backend/tests/a.test.ts', 'new file mode 100644', 'index 0000000..1111111', 'GIT binary patch', 'literal 3', 'abc', ''].join('\n')).includes('binary'));
  });

  test('rejects unsafe and traversing paths', () => {
    assert.ok(rules(newFile('backend/tests/../src/x.test.ts', TEST)).includes('unsafe-path'));
    assert.ok(rules(newFile('backend/tests/‮evil.test.ts', TEST)).includes('unsafe-path'));
    assert.ok(rules(newFile('backend/tests/a b.test.ts', TEST)).includes('unsafe-path'));
  });

  test('rejects forbidden test content', () => {
    assert.ok(rules(newFile('backend/tests/a.test.ts', ["it.only('x', () => {})"])).includes('forbidden-content'));
    assert.ok(rules(newFile('backend/tests/a.test.ts', ["it.skip('x', () => {})"])).includes('forbidden-content'));
  });

  test('enforces size limits', () => {
    const many = Array.from({ length: policy.limits.maxPatchFiles + 1 }, (_, i) => newFile(`backend/tests/f${i}.test.ts`, TEST)).join('');
    assert.ok(rules(many).includes('too-many-files'));
    const long = newFile('backend/tests/long.test.ts', Array.from({ length: policy.limits.maxPatchAddedLines + 1 }, () => '// x'));
    assert.ok(rules(long).includes('too-many-lines'));
  });

  test('reports changed human assertions as a notice, not a violation', () => {
    const result = checkPatch(policy, modifiedFile('backend/tests/router.test.ts', ['  expect(res.status).toBe(200);'], ['  expect(res.status).toBe(201);']));
    assert.equal(result.ok, true);
    assert.deepEqual(result.notices.map((notice) => notice.kind), ['changed_expectations']);
  });

  test('treats setup-only edits of existing tests as a softer notice', () => {
    const result = checkPatch(policy, modifiedFile('backend/tests/router.test.ts', ["import { x } from './a.ts';"], ["import { x, y } from './a.ts';"]));
    assert.deepEqual(result.notices.map((notice) => notice.kind), ['modified_existing_test']);
  });

  test('rejects content without file headers', () => {
    assert.ok(rules('just some text\n').includes('unparseable'));
  });
});
