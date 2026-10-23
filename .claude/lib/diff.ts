// Parsers for the git outputs the agent tooling relies on. Inputs are produced
// by our own git invocations (always with --no-renames and core.quotePath=false).

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'type-changed';

export type NameStatus = { status: ChangeStatus; path: string };

const STATUS: Record<string, ChangeStatus> = { A: 'added', M: 'modified', D: 'deleted', T: 'type-changed' };

/** Parses `git diff --name-status -z --no-renames <a> <b>`. Unknown statuses are reported as modified. */
export function parseNameStatus(output: string): NameStatus[] {
  const fields = output.split('\0').filter((field) => field.length > 0);
  const entries: NameStatus[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    entries.push({ status: STATUS[fields[i][0]] ?? 'modified', path: fields[i + 1] });
  }
  return entries;
}

export type LineRange = [start: number, end: number];

/** Parses `git diff -U0` and returns, per new-side path, the changed line ranges of the new version. */
export function parseChangedLines(unifiedZero: string): Map<string, LineRange[]> {
  const result = new Map<string, LineRange[]>();
  let current: LineRange[] | null = null;
  for (const line of unifiedZero.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4);
      current = target === '/dev/null' ? null : [];
      if (current) result.set(target.replace(/^b\//, ''), current);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (count > 0) current.push([start, start + count - 1]);
    }
  }
  return result;
}

export function countLines(ranges: readonly LineRange[]): number {
  return ranges.reduce((sum, [start, end]) => sum + end - start + 1, 0);
}

export type PatchFile = {
  path: string;
  oldPath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldMode: string | null;
  newMode: string | null;
  binary: boolean;
  addedLines: string[];
  removedLines: string[];
};

/**
 * Parses a `git diff --binary` patch into per-file entries. Anything the guard
 * must reject (renames, mode changes, symlinks, submodules, binaries) is kept
 * visible in the result rather than silently normalized.
 */
export function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let file: PatchFile | null = null;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      file = { path: header[2], oldPath: header[1], status: 'modified', oldMode: null, newMode: null, binary: false, addedLines: [], removedLines: [] };
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) continue;
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (inHunk) {
      if (line.startsWith('+')) file.addedLines.push(line.slice(1));
      else if (line.startsWith('-')) file.removedLines.push(line.slice(1));
      else if (!line.startsWith(' ') && !line.startsWith('\\') && line !== '') inHunk = false;
      if (inHunk) continue;
    }
    let match: RegExpExecArray | null;
    if ((match = /^new file mode (\d+)$/.exec(line))) {
      file.status = 'added';
      file.newMode = match[1];
    } else if ((match = /^deleted file mode (\d+)$/.exec(line))) {
      file.status = 'deleted';
      file.oldMode = match[1];
    } else if ((match = /^old mode (\d+)$/.exec(line))) {
      file.oldMode = match[1];
    } else if ((match = /^new mode (\d+)$/.exec(line))) {
      file.newMode = match[1];
    } else if ((match = /^index [0-9a-f]+\.\.[0-9a-f]+ (\d+)$/.exec(line))) {
      file.oldMode ??= match[1];
      file.newMode ??= match[1];
    } else if (/^(?:rename|copy) (?:from|to) /.test(line) || /^similarity index /.test(line)) {
      file.status = 'renamed';
    } else if (line === 'GIT binary patch' || /^Binary files .* differ$/.test(line)) {
      file.binary = true;
    }
  }
  return files;
}
