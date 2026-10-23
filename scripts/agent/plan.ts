// Deterministic triage: turns a diff (PR mode) or an explicit file list (sweep
// mode) into plan.json, the only input the unit-test agent receives.
//
// Usage:
//   node scripts/agent/plan.ts --repo <checkout> --base <sha> --head <sha> --out plan.json
//   node scripts/agent/plan.ts --repo <checkout> --mode sweep --targets backend/src/api/health.ts,... --out plan.json
//
// It never executes code from the checkout: it only reads files and git objects.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { countLines, parseChangedLines, parseNameStatus, type LineRange, type NameStatus } from '../../.claude/lib/diff.ts';
import { matchesAny } from '../../.claude/lib/glob.ts';
import { ownerTestFor, relatedTestsFor, type RepoReader } from '../../.claude/lib/owner-tests.ts';
import { isSourceFile, isTestFile, loadPolicy, packageOf, type PackageName, type TestPolicy, type Tier, type TierName } from '../../.claude/lib/policy.ts';

export const AGENT_TRAILER = 'Unit-Test-Agent:';

export type PlanTarget = {
  package: PackageName;
  source: string;
  status: 'added' | 'modified' | 'existing';
  kind: 'component' | 'hook' | 'module';
  changed_lines: LineRange[] | 'all';
  changed_line_count: number;
  owner_test: string;
  owner_test_exists: boolean;
  related_tests: string[];
};

export type Routing = {
  tier: TierName | 'sweep';
  model: string;
  effort: string;
  max_turns: number;
  max_budget_usd: number;
  escalation_tier: TierName | null;
  reason: string;
};

export type Plan = {
  version: 1;
  mode: 'pr' | 'sweep';
  base_sha: string | null;
  head_sha: string;
  run_agent: boolean;
  skip_reason: string | null;
  /** The head commit is the agent's own (applied tests): keep the existing report, do nothing else. */
  agent_commit: boolean;
  targets: PlanTarget[];
  dropped_targets: string[];
  ignored: { path: string; reason: string }[];
  deleted_sources: string[];
  author_test_changes: string[];
  flags: {
    dependencies_changed: boolean;
    agent_config_changed: boolean;
    test_config_changed: boolean;
    database_changed: boolean;
    injection_suspected: boolean;
    injection_signals: string[];
  };
  routing: Routing | null;
};

export type PlanInput = {
  policy: TestPolicy;
  mode: 'pr' | 'sweep';
  baseSha: string | null;
  headSha: string;
  changes: NameStatus[];
  changedLines: Map<string, LineRange[]>;
  addedText: string;
  headCommitMessage: string;
  allFiles: string[];
  repo: RepoReader;
  sweepTargets?: string[];
  tierOverride?: TierName;
};

const INVISIBLE = /[‪-‮⁦-⁩​-‍⁠﻿]|[\u{E0000}-\u{E007F}]/u;
const INSTRUCTION_PHRASES = /\b(?:ignore (?:all |any )?(?:previous|prior|above) instructions|(?:note|message) to (?:the )?(?:ai|llm|agent)s?|system prompt|you are (?:now )?(?:an? )?(?:ai|assistant|agent)\b|do not tell the (?:user|reviewer))/i;

function kindOf(pkg: PackageName, source: string): PlanTarget['kind'] {
  if (pkg === 'frontend' && source.endsWith('.tsx')) return 'component';
  if (pkg === 'frontend' && /\/use[A-Z][^/]*\.ts$/.test(source)) return 'hook';
  return 'module';
}

// Paths end up in the agent prompt, so only plain repository paths are accepted.
const SAFE_PATH = /^[A-Za-z0-9._@/-]+$/;

/** Signals are fixed strings: no text from the pull request is echoed back into the prompt. */
export function detectInjection(addedText: string): string[] {
  const signals: string[] = [];
  if (INVISIBLE.test(addedText)) signals.push('invisible or bidirectional control characters in added lines');
  if (INSTRUCTION_PHRASES.test(addedText)) signals.push('instruction-like text addressed to an AI agent in added lines');
  return signals;
}

export function selectTier(policy: TestPolicy, targets: PlanTarget[], override?: TierName): { tier: Tier; reason: string } {
  const { tiers } = policy.routing;
  const lines = targets.reduce((sum, target) => sum + target.changed_line_count, 0);
  const components = targets.filter((target) => target.kind === 'component').length;
  const facts = `${targets.length} target(s), ${lines} changed source line(s), ${components} component(s)`;
  if (override) {
    const forced = tiers.find((tier) => tier.name === override);
    if (forced) return { tier: forced, reason: `tier ${override} forced; ${facts}` };
  }
  const fit = tiers.find((tier) => targets.length <= tier.maxTargets && lines <= tier.maxChangedLines && (tier.componentTargets || components === 0));
  const tier = fit ?? tiers[tiers.length - 1];
  return { tier, reason: `${facts} -> smallest fitting tier ${tier.name}` };
}

export function buildPlan(input: PlanInput): Plan {
  const { policy } = input;
  const allSources = input.allFiles.filter((path) => isSourceFile(policy, path));
  const testFiles = input.allFiles.filter((path) => isTestFile(policy, path));
  const flagged = (globs: string[]) => input.changes.some((change) => matchesAny(change.path, globs));
  const injectionSignals = input.mode === 'pr' ? detectInjection(input.addedText) : [];

  const plan: Plan = {
    version: 1,
    mode: input.mode,
    base_sha: input.baseSha,
    head_sha: input.headSha,
    run_agent: false,
    skip_reason: null,
    agent_commit: false,
    targets: [],
    dropped_targets: [],
    ignored: [],
    deleted_sources: [],
    author_test_changes: [],
    flags: {
      dependencies_changed: flagged(policy.dependencyPaths),
      agent_config_changed: flagged(policy.agentConfigPaths),
      test_config_changed: flagged(policy.testConfigPaths),
      database_changed: flagged(policy.databasePaths),
      injection_suspected: injectionSignals.length > 0,
      injection_signals: injectionSignals,
    },
    routing: null,
  };

  const candidates: { path: string; status: PlanTarget['status'] }[] = [];
  if (input.mode === 'sweep') {
    for (const path of input.sweepTargets ?? []) {
      if (SAFE_PATH.test(path) && isSourceFile(policy, path) && input.repo.exists(path)) candidates.push({ path, status: 'existing' });
      else plan.ignored.push({ path, reason: 'not an existing source file covered by the test policy' });
    }
  } else {
    for (const change of input.changes) {
      if (!SAFE_PATH.test(change.path)) {
        plan.ignored.push({ path: change.path.replace(/[^A-Za-z0-9._@/-]/g, '?'), reason: 'unsupported characters in path' });
      } else if (isTestFile(policy, change.path)) {
        plan.author_test_changes.push(change.path);
      } else if (!isSourceFile(policy, change.path)) {
        plan.ignored.push({ path: change.path, reason: packageOf(policy, change.path) ? 'not unit-testable source (types, stories, config, generated or excluded)' : 'outside backend/ and frontend/' });
      } else if (change.status === 'deleted') {
        plan.deleted_sources.push(change.path);
      } else if (change.status === 'type-changed') {
        plan.ignored.push({ path: change.path, reason: 'file type changed (e.g. symlink)' });
      } else {
        candidates.push({ path: change.path, status: change.status === 'added' ? 'added' : 'modified' });
      }
    }
  }

  const targets = candidates.map(({ path, status }): PlanTarget => {
    const pkg = packageOf(policy, path) as PackageName;
    const ranges = input.mode === 'sweep' ? 'all' : (input.changedLines.get(path) ?? []);
    const content = input.repo.read(path) ?? '';
    const owner = ownerTestFor(policy, path, allSources, input.repo) as string;
    return {
      package: pkg,
      source: path,
      status,
      kind: kindOf(pkg, path),
      changed_lines: ranges,
      changed_line_count: ranges === 'all' ? content.split('\n').length : countLines(ranges),
      owner_test: owner,
      owner_test_exists: input.repo.exists(owner),
      related_tests: relatedTestsFor(path, testFiles, owner, input.repo),
    };
  });

  // Respect the triage caps: keep the most-changed targets, report the rest.
  const { maxTargets, maxChangedSourceLines } = policy.limits;
  const ordered = [...targets].sort((a, b) => b.changed_line_count - a.changed_line_count);
  let budget = maxChangedSourceLines;
  for (const target of ordered) {
    if (plan.targets.length < maxTargets && (target.changed_line_count <= budget || plan.targets.length === 0)) {
      plan.targets.push(target);
      budget -= target.changed_line_count;
    } else {
      plan.dropped_targets.push(target.source);
    }
  }
  plan.targets.sort((a, b) => a.source.localeCompare(b.source));

  if (input.mode === 'pr' && input.headCommitMessage.includes(AGENT_TRAILER)) {
    plan.skip_reason = 'the head commit was created by the unit-test agent';
    plan.agent_commit = true;
  } else if (plan.targets.length === 0) {
    plan.skip_reason = plan.deleted_sources.length > 0 ? 'only deleted source files; existing tests still run in the regular test suites' : 'no unit-testable source changes';
  } else {
    plan.run_agent = true;
    if (input.mode === 'sweep') {
      const sweep = policy.routing.sweep;
      plan.routing = { tier: 'sweep', model: sweep.model, effort: sweep.effort, max_turns: sweep.maxTurns, max_budget_usd: sweep.maxBudgetUsd, escalation_tier: null, reason: 'sweep mode' };
    } else {
      const { tier, reason } = selectTier(policy, plan.targets, input.tierOverride);
      plan.routing = {
        tier: tier.name,
        model: tier.model,
        effort: tier.effort,
        max_turns: tier.maxTurns,
        max_budget_usd: tier.maxBudgetUsd,
        escalation_tier: policy.routing.escalation[tier.name],
        reason,
      };
    }
  }
  return plan;
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function main(): void {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string', default: '.' },
      base: { type: 'string' },
      head: { type: 'string', default: 'HEAD' },
      mode: { type: 'string', default: 'pr' },
      targets: { type: 'string' },
      tier: { type: 'string' },
      out: { type: 'string' },
    },
  });
  const repo = values.repo!;
  const mode = values.mode === 'sweep' ? 'sweep' : 'pr';
  if (mode === 'pr' && !values.base) throw new Error('--base is required in pr mode');
  const head = git(repo, ['rev-parse', values.head!]).trim();
  const diffArgs = ['--no-renames', '--no-ext-diff', '--no-textconv'];
  const range = values.base ? [`${values.base}...${head}`] : [];

  const plan = buildPlan({
    policy: loadPolicy(),
    mode,
    baseSha: values.base ? git(repo, ['rev-parse', values.base]).trim() : null,
    headSha: head,
    changes: mode === 'pr' ? parseNameStatus(git(repo, ['diff', '--name-status', '-z', ...diffArgs, ...range])) : [],
    changedLines: mode === 'pr' ? parseChangedLines(git(repo, ['diff', '-U0', ...diffArgs, ...range])) : new Map(),
    addedText: mode === 'pr'
      ? git(repo, ['diff', '-U0', ...diffArgs, ...range]).split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n')
      : '',
    headCommitMessage: git(repo, ['log', '-1', '--format=%B', head]),
    allFiles: git(repo, ['ls-tree', '-r', '--name-only', head]).split('\n').filter(Boolean),
    repo: {
      exists: (path) => existsSync(join(repo, path)),
      read: (path) => (existsSync(join(repo, path)) ? readFileSync(join(repo, path), 'utf8') : null),
    },
    sweepTargets: values.targets?.split(',').map((path) => path.trim()).filter(Boolean),
    tierOverride: (['S', 'M', 'L'] as const).find((tier) => tier === values.tier),
  });

  const json = `${JSON.stringify(plan, null, 2)}\n`;
  if (values.out) writeFileSync(values.out, json);
  else process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
