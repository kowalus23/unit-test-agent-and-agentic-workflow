// Minimal, dependency-free glob matcher for repository-relative POSIX paths.
// Supports `**` (any number of path segments), `*` and `?` (within a segment)
// and `{a,b}` alternation. Dotfiles are matched like any other name.

const cache = new Map<string, RegExp>();

function escapeRegExp(char: string): string {
  return /[\\^$.+()|[\]{}]/.test(char) ? `\\${char}` : char;
}

function translate(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        const atSegmentStart = i === 0 || glob[i - 1] === '/';
        const atSegmentEnd = i + 2 === glob.length || glob[i + 2] === '/';
        if (atSegmentStart && atSegmentEnd) {
          // `**/` matches zero or more whole segments; a trailing `**` matches the rest.
          if (glob[i + 2] === '/') {
            out += '(?:[^/]+/)*';
            i += 2;
          } else {
            out += '.*';
            i += 1;
          }
          continue;
        }
      }
      out += '[^/]*';
    } else if (char === '?') {
      out += '[^/]';
    } else if (char === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        out += '\\{';
        continue;
      }
      const options = glob.slice(i + 1, end).split(',').map(translate);
      out += `(?:${options.join('|')})`;
      i = end;
    } else {
      out += escapeRegExp(char);
    }
  }
  return out;
}

export function globToRegExp(glob: string): RegExp {
  let re = cache.get(glob);
  if (!re) {
    re = new RegExp(`^${translate(glob)}$`);
    cache.set(glob, re);
  }
  return re;
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

export function matchesAny(path: string, globs: readonly string[] | undefined): boolean {
  return (globs ?? []).some((glob) => matchesGlob(path, glob));
}
