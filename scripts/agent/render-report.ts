// Renders the pull-request report (sticky comment and job summary) from the
// artifacts of one run. Runs without a model and without the PR's code.
//
// Usage: node scripts/agent/render-report.ts --dir <artifacts> [--run-url <url>] [--out report.md]
//   <dir> may contain plan.json, metrics.json, agent-result.json, verdict.json, final.patch.
//
// Agent-written text is untrusted: it is reduced to plain text before rendering
// so it cannot add links, images, HTML or @mentions to a public page.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { FileCoverage } from '../../.claude/lib/vitest-report.ts';
import type { Plan } from './plan.ts';
import type { Attempt } from './run-agent.ts';
import type { Verdict } from './verify.ts';

export const REPORT_MARKER = '<!-- unit-test-agent:report -->';
const MAX_COMMENT = 60_000;
const MAX_DIFF_LINES = 400;

type AgentTarget = { source_file: string; decision: string; test_files: string[]; behaviours?: string[]; reason: string; local_result: string };
type AgentFinding = { kind: string; file: string; line?: number; detail: string };
type AgentResult = { decision: string; summary: string; targets: AgentTarget[]; findings: AgentFinding[]; skills_used: string[] };
type Metrics = { status: string; reason?: string; total_cost_usd?: number; total_turns?: number; total_duration_ms?: number; accepted_attempt?: number | null; attempts: Attempt[] };

export type ReportInput = { plan: Plan | null; metrics: Metrics | null; result: unknown; verdict: Verdict | null; finalPatch: string; runUrl?: string };

/** Reduces model-written text to safe, single-line plain text. */
export function plain(text: unknown, max = 500): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\b(?:https?|ftp|file|data|javascript):\S*/gi, '[link removed]')
    .replace(/www\.\S+/gi, '[link removed]')
    .replace(/@(?=[A-Za-z0-9-])/g, '@​')
    .replace(/[`*_~|\\]/g, (char) => `\\${char}`)
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩​-‍⁠﻿]/g, (char) => (char === '​' ? char : ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Inline code for trusted, policy-validated repository paths. */
const code = (path: string) => `\`${path.replace(/`/g, '')}\``;

function isAgentResult(value: unknown): value is AgentResult {
  const v = value as AgentResult;
  return !!v && typeof v === 'object' && typeof v.decision === 'string' && Array.isArray(v.targets) && Array.isArray(v.findings);
}

const pct = (coverage: FileCoverage | null | undefined) => (coverage ? `${coverage.lines.pct}%` : 'n/a');
const money = (value: number | undefined) => `$${(value ?? 0).toFixed(2)}`;
const duration = (ms: number | undefined) => {
  const seconds = Math.round((ms ?? 0) / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
};

const FINDING_LABEL: Record<string, string> = {
  suspected_bug: '🐞 Suspected bug',
  changed_expectations: '⚠️ Changed expectations',
  orphaned_test: '🧹 Orphaned test',
  not_unit_testable: 'ℹ️ Not unit-testable',
  suspected_injection: '🛡️ Suspected prompt injection',
  other: 'ℹ️ Note',
};

function fence(content: string): string {
  const longest = Math.max(2, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  return '`'.repeat(longest + 1);
}

export function renderReport(input: ReportInput): string {
  const { plan, metrics, verdict } = input;
  const result = isAgentResult(input.result) ? input.result : null;
  const lines: string[] = [REPORT_MARKER, ''];
  const head = plan?.head_sha ? ` for ${code(plan.head_sha.slice(0, 7))}` : '';

  if (!plan) {
    lines.push('## 🧪 Unit-test agent: no result', '', 'The planning step did not produce a plan, so the agent did not run. See the workflow run for details.');
    return finish(lines, input.runUrl);
  }
  if (!plan.run_agent) {
    lines.push(`## 🧪 Unit-test agent: skipped${head}`, '', `**Reason:** ${plan.skip_reason ?? 'not applicable'}. No model was called.`);
    if (plan.ignored.length > 0) lines.push('', `<details><summary>${plan.ignored.length} changed file(s) not targeted</summary>`, '', ...plan.ignored.map((item) => `- ${code(item.path)}: ${item.reason}`), '', '</details>');
    return finish(lines, input.runUrl);
  }

  const packages = verdict ? Object.entries(verdict.packages).filter(([, pkg]) => pkg.status !== 'not_touched') : [];
  const accepted = packages.filter(([, pkg]) => pkg.status === 'accepted');
  const proposedTests = accepted.reduce((sum, [, pkg]) => sum + pkg.new_tests.passed, 0);
  let headline: string;
  if (!verdict) headline = 'agent did not finish';
  else if (!verdict.guard.ok) headline = 'patch rejected by policy';
  else if (packages.length === 0) headline = result?.decision === 'no_change_needed' ? 'no test changes needed' : 'no test changes proposed';
  else if (accepted.length === packages.length) headline = `${verdict.final_patch_files.length} verified test file(s) proposed`;
  else if (accepted.length > 0) headline = 'partially verified';
  else headline = 'proposed tests failed verification';
  lines.push(`## 🧪 Unit-test agent: ${headline}${head}`, '');

  if (result?.summary) lines.push(`> ${plain(result.summary, 1200)}`, '');

  const flags = plan.flags;
  const warnings = [
    flags.injection_suspected && '🛡️ The diff contains text or characters that look like instructions to an AI agent. The agent treated them as data; review the changes carefully.',
    flags.agent_config_changed && '⚙️ This PR changes automation or agent configuration. The agent ran with the configuration of the base branch.',
    flags.dependencies_changed && '📦 Dependencies changed: tests ran against the PR lockfile with install scripts disabled.',
    flags.test_config_changed && '🧪 Test configuration changed: results reflect the PR configuration.',
    flags.database_changed && '🗄️ Database schema or setup changed: unit tests mock Prisma and cannot detect schema drift; an integration test or migration review is needed.',
    plan.dropped_targets.length > 0 && `✂️ ${plan.dropped_targets.length} target(s) exceeded the per-run limits and were not analyzed: ${plan.dropped_targets.map(code).join(', ')}.`,
  ].filter(Boolean) as string[];
  if (warnings.length > 0) lines.push(...warnings.map((warning) => `- ${warning}`), '');

  lines.push('### Decisions', '', '| Source | Agent decision | Test files | Line coverage | Why |', '|---|---|---|---|---|');
  for (const target of plan.targets) {
    const decision = result?.targets.find((entry) => entry.source_file === target.source);
    const coverage = verdict?.targets.find((entry) => entry.source === target.source);
    const tests = (decision?.test_files ?? []).filter((file) => verdict?.guard.files.some((entry) => entry.path === file) || file === target.owner_test);
    lines.push(
      `| ${code(target.source)} | ${decision ? plain(decision.decision, 30) : 'not reported'} | ${tests.map(code).join('<br>') || '—'} | ${pct(coverage?.before)} → ${pct(coverage?.after)} | ${plain(decision?.reason ?? '', 300) || '—'} |`,
    );
  }
  lines.push('');

  if (verdict) {
    lines.push('### Verification', '', 'Re-run independently on a clean machine without secrets. Only packages that pass every gate are proposed.', '');
    if (!verdict.guard.ok) {
      lines.push('**Rejected by the patch guard:**', ...verdict.guard.violations.map((violation) => `- ${code(violation.path)}: ${violation.rule} (${violation.detail})`), '');
    }
    if (packages.length > 0) {
      lines.push('| Package | Verdict | Agent tests | Full suite | Stability | Type check | Line coverage |', '|---|---|---|---|---|---|---|');
      for (const [name, pkg] of packages) {
        lines.push(
          `| ${name} | ${pkg.status === 'accepted' ? '✅ accepted' : '❌ rejected'} | ${pkg.new_tests.passed} passed, ${pkg.new_tests.failed} failed | ${pkg.patched ? `${pkg.patched.passed} passed, ${pkg.patched.failed} failed` : 'n/a'} | ${pkg.stability ? `${pkg.stability.runs} shuffled runs${pkg.stability.failures.length ? `, ${pkg.stability.failures.length} failure(s)` : ', stable'}` : 'n/a'} | ${pkg.typecheck ? (pkg.typecheck.patched ? 'passes' : 'fails') : 'n/a'} | ${pkg.coverage ? `${pkg.coverage.lines_before ?? 'n/a'}% → ${pkg.coverage.lines_after ?? 'n/a'}%` : 'n/a'} |`,
        );
      }
      for (const [name, pkg] of packages) if (pkg.reasons.length > 0) lines.push(`- **${name}:** ${pkg.reasons.map((reason) => plain(reason, 300)).join('; ')}`);
      lines.push('');
    }
    if (verdict.guard.notices.length > 0) lines.push(...verdict.guard.notices.map((notice) => `- ⚠️ ${code(notice.path)}: ${notice.detail}`), '');
  }

  if (result && result.findings.length > 0) {
    lines.push('### Findings', '');
    for (const finding of result.findings.slice(0, 20)) {
      const where = `${plain(finding.file, 200)}${typeof finding.line === 'number' ? `:${finding.line}` : ''}`;
      lines.push(`- ${FINDING_LABEL[finding.kind] ?? FINDING_LABEL.other} in ${where}: ${plain(finding.detail, 600)}`);
    }
    lines.push('');
  }

  if (input.finalPatch.trim() !== '' && verdict) {
    const diff = input.finalPatch.split('\n');
    const shown = diff.slice(0, MAX_DIFF_LINES).join('\n');
    const marker = fence(shown);
    lines.push(
      `### Proposed tests (${verdict.final_patch_files.length} file(s), ${proposedTests} passing test(s))`,
      '',
      'These tests are **not committed**. Add the `unit-test-agent:apply` label to commit exactly this verified patch to the PR branch, or apply it locally from the `unit-test-agent-final-patch` artifact with `git apply final.patch`.',
      '',
      '<details><summary>Show diff</summary>',
      '',
      `${marker}diff`,
      shown,
      marker,
      diff.length > MAX_DIFF_LINES ? `\n_Diff truncated to ${MAX_DIFF_LINES} of ${diff.length} lines; the artifact contains the full patch._` : '',
      '</details>',
      '',
    );
  }

  if (metrics) {
    const attempts = metrics.attempts ?? [];
    const last = attempts[attempts.length - 1];
    const route = plan.routing ? `tier ${plan.routing.tier} (${plain(plan.routing.reason, 160)})` : '';
    const models = attempts.map((attempt) => `${attempt.model} ${attempt.effort}`).join(' → ');
    lines.push(
      '<sub>',
      `${route} · ${models || 'no model call'} · ${metrics.total_turns ?? 0} turns · ${money(metrics.total_cost_usd)} · ${duration(metrics.total_duration_ms)}${attempts.length > 1 ? ` · ${attempts.length} attempts (escalated: ${plain(attempts[0].escalation_reason ?? '', 120)})` : ''}${last && last.status !== 'ok' ? ` · last attempt: ${last.status}` : ''}${result?.skills_used.length ? ` · skills: ${result.skills_used.map((skill) => plain(skill, 60)).join(', ')}` : ''}`,
      '</sub>',
    );
  }
  return finish(lines, input.runUrl);
}

function finish(lines: string[], runUrl?: string): string {
  if (runUrl && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+(?:\/attempts\/\d+)?$/.test(runUrl)) lines.push('', `<sub>[Workflow run](${runUrl})</sub>`);
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  return body.length > MAX_COMMENT ? `${body.slice(0, MAX_COMMENT)}\n\n_Report truncated._` : body;
}

function readJson<T>(dir: string, name: string): T | null {
  const path = join(dir, name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function main(): void {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, 'run-url': { type: 'string' }, out: { type: 'string' } } });
  if (!values.dir) throw new Error('--dir is required');
  const dir = values.dir;
  const report = renderReport({
    plan: readJson<Plan>(dir, 'plan.json'),
    metrics: readJson<Metrics>(dir, 'metrics.json'),
    result: readJson<unknown>(dir, 'agent-result.json'),
    verdict: readJson<Verdict>(dir, 'verdict.json'),
    finalPatch: existsSync(join(dir, 'final.patch')) ? readFileSync(join(dir, 'final.patch'), 'utf8') : '',
    runUrl: values['run-url'],
  });
  if (values.out) writeFileSync(values.out, `${report}\n`);
  else process.stdout.write(`${report}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
