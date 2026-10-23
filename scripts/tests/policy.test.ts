import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { matchesGlob } from '../../.claude/lib/glob.ts';
import { forbiddenContentIn, isSourceFile, isTestFile, isWritable, loadPolicy, normalizeRepoPath } from '../../.claude/lib/policy.ts';

const policy = loadPolicy();

describe('matchesGlob', () => {
  test('** matches zero or more directories', () => {
    assert.ok(matchesGlob('backend/src/a.ts', 'backend/src/**/*.ts'));
    assert.ok(matchesGlob('backend/src/x/y/a.ts', 'backend/src/**/*.ts'));
    assert.ok(matchesGlob('CLAUDE.md', '**/CLAUDE.md'));
    assert.ok(matchesGlob('frontend/CLAUDE.md', '**/CLAUDE.md'));
  });
  test('* does not cross directories and braces alternate', () => {
    assert.ok(!matchesGlob('backend/tests/a/b.test.ts', 'backend/tests/*.test.ts'));
    assert.ok(matchesGlob('frontend/src/A.test.tsx', 'frontend/src/**/*.test.{ts,tsx}'));
    assert.ok(!matchesGlob('frontend/src/A.test.js', 'frontend/src/**/*.test.{ts,tsx}'));
  });
  test('dots are literal', () => {
    assert.ok(!matchesGlob('backend/testsXfixture.ts', 'backend/tests.fixture.ts'));
  });
});

describe('test policy', () => {
  test('classifies production sources', () => {
    assert.ok(isSourceFile(policy, 'backend/src/features/todos/router.ts'));
    assert.ok(isSourceFile(policy, 'frontend/src/features/todos/components/TodoList.tsx'));
    for (const excluded of [
      'backend/src/features/todos/types.ts',
      'backend/src/generated/prisma/client.ts',
      'frontend/src/main.tsx',
      'frontend/src/design-system/components/Button/Button.tsx',
      'frontend/src/components/SuccessNotice.test.tsx',
      'frontend/src/design-system/components/Button/Button.stories.tsx',
      'backend/prisma.config.ts',
    ]) {
      assert.ok(!isSourceFile(policy, excluded), excluded);
    }
  });

  test('only test files and helpers are writable', () => {
    for (const allowed of ['backend/tests/health.test.ts', 'backend/tests/helpers/db.ts', 'backend/tests/fixture.ts', 'frontend/src/lib/http.test.ts', 'frontend/src/test/queryClient.tsx']) {
      assert.ok(isWritable(policy, allowed), allowed);
    }
    for (const denied of [
      'backend/src/factory.ts',
      'backend/package.json',
      'backend/vitest.config.ts',
      'frontend/src/test/setup.ts',
      'frontend/src/lib/http.ts',
      '.github/workflows/ci.yml',
      '.claude/policy/test-policy.json',
      'backend/tests/notes.md',
    ]) {
      assert.ok(!isWritable(policy, denied), denied);
    }
  });

  test('recognizes test files', () => {
    assert.ok(isTestFile(policy, 'backend/tests/router.test.ts'));
    assert.ok(isTestFile(policy, 'frontend/src/App.test.tsx'));
    assert.ok(!isTestFile(policy, 'backend/tests/fixture.ts'));
  });

  test('normalizes paths and rejects escapes', () => {
    assert.equal(normalizeRepoPath('backend/./tests/a.test.ts'), 'backend/tests/a.test.ts');
    assert.equal(normalizeRepoPath('../etc/passwd'), null);
    assert.equal(normalizeRepoPath('backend/../../x'), null);
    assert.equal(normalizeRepoPath('/etc/passwd'), null);
    assert.equal(normalizeRepoPath('a\0b'), null);
  });

  test('flags forbidden test content', () => {
    const reasons = (code: string) => forbiddenContentIn(policy, code).map((rule) => rule.reason);
    assert.equal(reasons("it('works', () => expect(1).toBe(1))").length, 0);
    assert.equal(reasons("it.only('x', () => {})").length, 1);
    assert.equal(reasons("test.skip('x', () => {})").length, 1);
    assert.equal(reasons("it.fails('x', () => {})").length, 1);
    assert.equal(reasons("describe.todo('x')").length, 1);
    assert.equal(reasons('expect(tree).toMatchSnapshot()').length, 1);
    assert.equal(reasons('const key = process.env.ANTHROPIC_API_KEY').length, 1);
    assert.equal(reasons("import { execSync } from 'node:child_process'").length, 1);
  });
});
