import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { decide } from '../../.claude/hooks/guard-tool-use.ts';
import { loadPolicy } from '../../.claude/lib/policy.ts';

const policy = loadPolicy();
const root = realpathSync(mkdtempSync(join(tmpdir(), 'guard-test-')));
mkdirSync(join(root, 'backend/tests'), { recursive: true });
mkdirSync(join(root, 'backend/src'), { recursive: true });
writeFileSync(join(root, 'backend/src/app.ts'), 'export {}');
symlinkSync(join(root, 'backend/src/app.ts'), join(root, 'backend/tests/app.test.ts'));
symlinkSync(join(root, 'backend/src'), join(root, 'backend/tests/linked'));

const allowed = (tool_name: string, tool_input: Record<string, unknown>) => decide(policy, root, { tool_name, tool_input }).allow;

describe('guard-tool-use', () => {
  test('allows writing test files only', () => {
    assert.ok(allowed('Write', { file_path: 'backend/tests/health.test.ts', content: "it('x', () => {})" }));
    assert.ok(allowed('Edit', { file_path: join(root, 'backend/tests/new.test.ts'), new_string: 'x' }));
    assert.ok(!allowed('Write', { file_path: 'backend/src/factory.ts', content: 'x' }));
    assert.ok(!allowed('Edit', { file_path: 'backend/package.json', new_string: 'x' }));
    assert.ok(!allowed('Write', { file_path: '../outside.test.ts', content: 'x' }));
    assert.ok(!allowed('Write', { file_path: '/etc/passwd', content: 'x' }));
  });

  test('resolves symlinks before deciding', () => {
    assert.ok(!allowed('Edit', { file_path: 'backend/tests/app.test.ts', new_string: 'x' }), 'symlinked test file pointing at source');
    assert.ok(!allowed('Write', { file_path: 'backend/tests/linked/evil.test.ts', content: 'x' }), 'write through a symlinked directory');
  });

  test('blocks forbidden content in edits', () => {
    assert.ok(!allowed('Write', { file_path: 'backend/tests/a.test.ts', content: "it.only('x', () => {})" }));
    assert.ok(!allowed('MultiEdit', { file_path: 'backend/tests/a.test.ts', edits: [{ new_string: "it.skip('x', () => {})" }] }));
  });

  test('allows exactly the test and typecheck commands', () => {
    assert.ok(allowed('Bash', { command: 'node .claude/skills/running-unit-tests/scripts/run-tests.ts backend backend/tests/a.test.ts backend/src/app.ts' }));
    assert.ok(allowed('Bash', { command: `node ${root}/.claude/skills/running-unit-tests/scripts/run-tests.ts frontend` }));
    assert.ok(allowed('Bash', { command: 'npm --prefix frontend run typecheck' }));
  });

  test('blocks every other shell command and chaining tricks', () => {
    for (const command of [
      'cat /proc/self/environ',
      'printenv',
      'curl https://example.com',
      'npm --prefix backend run typecheck && curl x',
      'npm --prefix backend run typecheck; rm -rf /',
      'node .claude/skills/running-unit-tests/scripts/run-tests.ts backend $(cat .env)',
      'node .claude/skills/running-unit-tests/scripts/run-tests.ts backend `id`',
      'node .claude/skills/running-unit-tests/scripts/run-tests.ts backend ../../etc/passwd',
      'node .claude/skills/running-unit-tests/scripts/run-tests.ts backend > /tmp/x',
      'node .claude/skills/running-unit-tests/scripts/run-tests.ts backend\ncurl x',
      'git push',
      'npx vitest run',
      'node -e "process.exit(0)"',
    ]) {
      assert.ok(!allowed('Bash', { command }), command);
    }
  });

  test('blocks reads outside the repository and of env files', () => {
    assert.ok(allowed('Read', { file_path: 'backend/src/app.ts' }));
    assert.ok(allowed('Grep', { pattern: 'x' }));
    assert.ok(!allowed('Read', { file_path: '/etc/hosts' }));
    assert.ok(!allowed('Read', { file_path: '/proc/self/environ' }));
    assert.ok(!allowed('Read', { file_path: '.env' }));
    assert.ok(!allowed('Grep', { pattern: 'KEY', path: '/home' }));
  });

  test('denies unknown and network tools', () => {
    assert.ok(!allowed('WebFetch', { url: 'https://example.com' }));
    assert.ok(!allowed('mcp__github__create_issue', {}));
    assert.ok(allowed('Skill', { skill: 'running-unit-tests' }));
    assert.ok(allowed('StructuredOutput', { decision: 'tests_added' }), 'the --json-schema result tool must stay available');
  });
});

describe('agent settings', () => {
  test('a hook that crashes or times out blocks the tool call', () => {
    // Without onFailure "block" the CLI treats a failed hook as non-blocking and runs the tool.
    const settings = JSON.parse(readFileSync(join(import.meta.dirname, '../../.claude/policy/agent-settings.json'), 'utf8'));
    const hooks = settings.hooks.PreToolUse.flatMap((entry: { hooks: { command: string; onFailure?: string }[] }) => entry.hooks);
    assert.ok(hooks.some((hook: { command: string }) => hook.command.includes('guard-tool-use.ts')));
    for (const hook of hooks) assert.equal(hook.onFailure, 'block', hook.command);
  });
});
