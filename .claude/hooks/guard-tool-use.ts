// PreToolUse guard for the unit-test agent (fail-closed).
//
// Active only when UNIT_TEST_AGENT_GUARD=1 (set by scripts/agent/run-agent.ts
// locally and in CI), so regular interactive sessions in this repository are
// unaffected. Exit code 2 blocks the tool call and shows stderr to the model.
//
// This is a defence-in-depth layer: the authoritative decision about what the
// agent changed is made later by the patch guard on a machine without secrets.
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forbiddenContentIn, isWritable, loadPolicy, type TestPolicy } from '../lib/policy.ts';

type HookInput = { tool_name?: string; tool_input?: Record<string, unknown>; cwd?: string };

export type Decision = { allow: true } | { allow: false; reason: string };

const ALLOW: Decision = { allow: true };
const deny = (reason: string): Decision => ({ allow: false, reason });

const ALWAYS_ALLOWED_TOOLS = new Set(['Skill', 'Agent', 'Task', 'TodoWrite']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS']);

/** The only shell commands the agent may run, matched against the whole command line. */
export const ALLOWED_COMMANDS: readonly RegExp[] = [
  /^node \.claude\/skills\/running-unit-tests\/scripts\/run-tests\.ts (?:backend|frontend)(?: [A-Za-z0-9._@/-]+)*$/,
  /^npm --prefix (?:backend|frontend) run typecheck$/,
];

// Shell metacharacters that could chain, substitute or redirect commands.
const SHELL_META = /[;&|`$<>(){}\\\n\r\t*?!#~'"]/;

/** Resolves a path through symlinks, including not-yet-existing files (via their closest existing ancestor). */
function realResolve(absolute: string): string {
  let existing = absolute;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(existing.slice(parent.length + 1));
    existing = parent;
  }
  return resolve(realpathSync(existing), ...rest);
}

function repoRelative(root: string, path: string): string | null {
  const real = realResolve(isAbsolute(path) ? path : resolve(root, path));
  const rel = relative(root, real);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

export function decide(policy: TestPolicy, root: string, input: HookInput): Decision {
  const tool = input.tool_name ?? '';
  const args = input.tool_input ?? {};

  if (ALWAYS_ALLOWED_TOOLS.has(tool)) return ALLOW;

  if (WRITE_TOOLS.has(tool)) {
    const target = String(args.file_path ?? args.notebook_path ?? '');
    if (!target) return deny(`${tool}: missing file path`);
    const rel = repoRelative(root, target);
    if (!rel) return deny(`${tool}: ${target} is outside the repository`);
    const absolute = resolve(root, rel);
    if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) return deny(`${tool}: ${rel} is a symlink`);
    if (!isWritable(policy, rel)) {
      return deny(`${tool}: ${rel} is not a test file. The unit-test agent may only create or edit test files and test helpers (see .claude/policy/test-policy.json). Never change production code; report suspected bugs instead.`);
    }
    const content = [args.content, args.new_string, ...(Array.isArray(args.edits) ? args.edits.map((edit: { new_string?: unknown }) => edit.new_string) : [])]
      .filter((value): value is string => typeof value === 'string')
      .join('\n');
    const forbidden = forbiddenContentIn(policy, content);
    if (forbidden.length > 0) return deny(`${tool}: ${rel}: ${forbidden.map((rule) => rule.reason).join('; ')}`);
    return ALLOW;
  }

  if (READ_TOOLS.has(tool)) {
    const target = args.file_path ?? args.path;
    if (target === undefined || target === '') return ALLOW; // defaults to the working directory
    const rel = repoRelative(root, String(target));
    if (rel === null && resolve(root, String(target)) !== root) return deny(`${tool}: reading outside the repository is not allowed`);
    if (rel && /(?:^|\/)\.env(?:\.|$)/.test(rel) && !rel.endsWith('.env.example')) return deny(`${tool}: environment files are not readable`);
    return ALLOW;
  }

  if (tool === 'Bash') {
    const command = String(args.command ?? '').trim().replaceAll(`${root}/`, '');
    if (SHELL_META.test(command)) return deny('Bash: shell operators, substitutions and quoting are not allowed; run one allowed command at a time.');
    if (command.split(' ').some((part) => part === '..' || part.startsWith('../') || part.includes('/../'))) {
      return deny('Bash: parent-directory paths are not allowed');
    }
    if (ALLOWED_COMMANDS.some((pattern) => pattern.test(command))) return ALLOW;
    return deny(
      'Bash: command not allowed. Use the Read/Grep/Glob tools to inspect files. Allowed commands: ' +
        '`node .claude/skills/running-unit-tests/scripts/run-tests.ts <backend|frontend> [test files...]` and ' +
        '`npm --prefix <backend|frontend> run typecheck`.',
    );
  }

  return deny(`${tool || 'unknown tool'} is not available to the unit-test agent`);
}

function main(): void {
  if (process.env.UNIT_TEST_AGENT_GUARD !== '1') return;
  try {
    const input = JSON.parse(readFileSync(0, 'utf8')) as HookInput;
    const root = realpathSync(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
    const decision = decide(loadPolicy(), root, input);
    if (!decision.allow) {
      process.stderr.write(`Blocked by unit-test agent policy: ${decision.reason}\n`);
      process.exit(2);
    }
  } catch (error) {
    process.stderr.write(`Blocked: unit-test agent guard failed closed (${error instanceof Error ? error.message : String(error)})\n`);
    process.exit(2);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
