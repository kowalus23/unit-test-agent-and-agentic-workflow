// Loads .claude/policy/test-policy.json and answers path questions against it.
// Imported by the PreToolUse hook and by the CI scripts, so it must stay
// dependency-free and must only import from this trusted directory.
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesAny } from './glob.ts';

export type PackageName = 'backend' | 'frontend';

export type PackagePolicy = {
  root: string;
  sources: string[];
  sourceExcludes: string[];
  testFiles: string[];
  writable: string[];
  writableExcludes?: string[];
  ownerTest: { layout: 'flat'; directory: string; featurePrefixOnCollision: boolean } | { layout: 'colocated' };
};

export type ForbiddenContentRule = { pattern: string; reason: string };

export type TierName = 'S' | 'M' | 'L';

export type ModelSettings = { model: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; maxTurns: number; maxBudgetUsd: number };

export type Tier = ModelSettings & { name: TierName; maxTargets: number; maxChangedLines: number; componentTargets: boolean };

export type TestPolicy = {
  version: number;
  packages: Record<PackageName, PackagePolicy>;
  agentConfigPaths: string[];
  dependencyPaths: string[];
  testConfigPaths: string[];
  databasePaths: string[];
  routing: {
    tiers: Tier[];
    escalation: Record<TierName, TierName | null>;
    sweep: ModelSettings;
  };
  limits: {
    maxTargets: number;
    maxChangedSourceLines: number;
    maxPatchFiles: number;
    maxPatchAddedLines: number;
    maxPatchBytes: number;
  };
  forbiddenTestContent: ForbiddenContentRule[];
};

export const DEFAULT_POLICY_PATH = fileURLToPath(new URL('../policy/test-policy.json', import.meta.url));

export function loadPolicy(path: string = DEFAULT_POLICY_PATH): TestPolicy {
  return JSON.parse(readFileSync(path, 'utf8')) as TestPolicy;
}

export const PACKAGE_NAMES: readonly PackageName[] = ['backend', 'frontend'];

/** Normalizes a repository-relative path; returns null for paths escaping the repository. */
export function normalizeRepoPath(path: string): string | null {
  if (path.includes('\0') || posix.isAbsolute(path)) return null;
  const normalized = posix.normalize(path.replace(/\\/g, '/'));
  if (normalized === '..' || normalized.startsWith('../') || normalized === '.') return null;
  return normalized;
}

export function packageOf(policy: TestPolicy, path: string): PackageName | null {
  return PACKAGE_NAMES.find((name) => path.startsWith(`${policy.packages[name].root}/`)) ?? null;
}

export function isSourceFile(policy: TestPolicy, path: string): boolean {
  const name = packageOf(policy, path);
  if (!name) return false;
  const pkg = policy.packages[name];
  return matchesAny(path, pkg.sources) && !matchesAny(path, pkg.sourceExcludes);
}

export function isTestFile(policy: TestPolicy, path: string): boolean {
  const name = packageOf(policy, path);
  return name ? matchesAny(path, policy.packages[name].testFiles) : false;
}

/** True when the agent may create or modify this file. */
export function isWritable(policy: TestPolicy, path: string): boolean {
  const name = packageOf(policy, path);
  if (!name) return false;
  const pkg = policy.packages[name];
  return matchesAny(path, pkg.writable) && !matchesAny(path, pkg.writableExcludes);
}

export function forbiddenContentIn(policy: TestPolicy, content: string): ForbiddenContentRule[] {
  return policy.forbiddenTestContent.filter((rule) => new RegExp(rule.pattern).test(content));
}
