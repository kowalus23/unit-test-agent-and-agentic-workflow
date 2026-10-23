// Deterministic mapping from a source file to the unit test file that owns it.
//
// backend  (flat):      backend/src/features/todos/router.ts -> backend/tests/router.test.ts
//                       a second feature with its own router.ts -> backend/tests/<feature>.router.test.ts
// frontend (colocated): frontend/src/hooks/useNotice.ts -> frontend/src/hooks/useNotice.test.ts
import { posix } from 'node:path';
import { packageOf, type TestPolicy } from './policy.ts';

export type RepoReader = {
  exists(path: string): boolean;
  read(path: string): string | null;
};

const EXTENSION = /\.(?:tsx?|jsx?|mts|cts)$/;
const SPECIFIER = /\bfrom\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\bvi\.(?:mock|doMock)\(\s*['"]([^'"]+)['"]/g;

/** Repository-relative source paths (without extension) imported by a test file via relative specifiers. */
export function importedModules(testPath: string, content: string): Set<string> {
  const modules = new Set<string>();
  for (const match of content.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (!specifier.startsWith('.')) continue;
    modules.add(posix.normalize(posix.join(posix.dirname(testPath), specifier)).replace(EXTENSION, ''));
  }
  return modules;
}

function imports(testPath: string, repo: RepoReader, source: string): boolean {
  const content = repo.read(testPath);
  return content !== null && importedModules(testPath, content).has(source.replace(EXTENSION, ''));
}

export function ownerTestFor(policy: TestPolicy, source: string, allSources: readonly string[], repo: RepoReader): string | null {
  const name = packageOf(policy, source);
  if (!name) return null;
  const layout = policy.packages[name].ownerTest;
  const ext = posix.extname(source);
  const base = posix.basename(source, ext);

  if (layout.layout === 'colocated') {
    return posix.join(posix.dirname(source), `${base}.test${ext}`);
  }

  const flat = posix.join(layout.directory, `${base}.test.ts`);
  const feature = /\/src\/features\/([^/]+)\//.exec(source)?.[1];
  const prefixed = feature ? posix.join(layout.directory, `${feature}.${base}.test.ts`) : null;

  // An existing test that imports the source owns it, whichever naming it uses.
  for (const candidate of [flat, prefixed]) {
    if (candidate && repo.exists(candidate) && imports(candidate, repo, source)) return candidate;
  }

  const collides = allSources.some(
    (other) => other !== source && packageOf(policy, other) === name && posix.basename(other, posix.extname(other)) === base,
  );
  if (prefixed && layout.featurePrefixOnCollision && (collides || (repo.exists(flat) && !imports(flat, repo, source)))) {
    return prefixed;
  }
  return flat;
}

/** Existing test files (other than the owner) that import the source module. */
export function relatedTestsFor(source: string, testFiles: readonly string[], owner: string | null, repo: RepoReader): string[] {
  return testFiles.filter((test) => test !== owner && imports(test, repo, source));
}
