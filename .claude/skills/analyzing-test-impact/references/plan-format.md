# Plan format

The plan is produced deterministically from the change (pr mode) or from an explicit file list (sweep mode). It never contains free text from the change: paths are restricted to `[A-Za-z0-9._@/-]` and injection signals are fixed sentences.

Contents:

1. Top-level fields
2. Target fields
3. Flags and the paths that set them
4. Example: sweep mode (real output)
5. Example: pr mode
6. Example: a rename

## 1. Top-level fields

| Field | Type | Meaning |
|---|---|---|
| `version` | `1` | Format version. |
| `mode` | `"pr"` or `"sweep"` | `pr`: targets changed between two commits. `sweep`: targets are existing files chosen for coverage work. |
| `base_sha`, `head_sha` | string or null | Commits compared. `base_sha` is null in sweep mode. Informational only. |
| `run_agent`, `skip_reason` | boolean, string or null | `run_agent: false` with a reason (e.g. no unit-testable source changes, or only deleted sources) means there is nothing to do: report `no_change_needed` with an empty `targets` list. |
| `targets` | array | The only entries that get a decision, sorted by `source` path. This order is the "plan order" of the result. |
| `dropped_targets` | string[] | Sources left out by the per-run limits (at most 10 targets and 1500 changed source lines; the most-changed sources are kept first). No decision, no result entry. |
| `ignored` | `{ path, reason }[]` | Changed paths that are not unit-testable sources. Reasons: `not unit-testable source (types, stories, config, generated or excluded)`, `outside backend/ and frontend/`, `file type changed (e.g. symlink)`, `unsupported characters in path` (characters replaced by `?`), and in sweep mode `not an existing source file covered by the test policy`. |
| `deleted_sources` | string[] | Unit-testable sources the change deleted. Check for orphaned tests; never delete tests. |
| `author_test_changes` | string[] | Test files the change itself added, edited or deleted. Human tests: read, never rewrite. |
| `flags` | object | Risk signals, see section 3. |
| `routing` | object or null | Model and budget selection for the run. Not relevant to test decisions. |

## 2. Target fields

| Field | Meaning |
|---|---|
| `package` | `backend` or `frontend`; selects the writing skill and the test command. |
| `source` | Repository-relative source path. Copy it verbatim into `source_file` of the result. |
| `status` | `added` or `modified` in pr mode, `existing` in sweep mode. |
| `kind` | `component` (frontend `.tsx`), `hook` (frontend `use<Name>.ts`), `module` (everything else, including every backend file). |
| `changed_lines` | pr mode: new-side ranges `[start, end]`, inclusive, e.g. `[[14, 18]]`. `[]` when the file only lost lines. Sweep mode: `"all"`. |
| `changed_line_count` | Sum of the ranges; in sweep mode the file's line count. |
| `owner_test` | The test file that owns this source. New cases go here and nowhere else. |
| `owner_test_exists` | Whether `owner_test` exists now. `false` means the owner test must be created. |
| `related_tests` | Other existing test files whose relative imports, dynamic `import()` or `vi.mock`/`vi.doMock` specifiers resolve to the source. A related test that mocks the source does not execute it. |

Owner mapping: backend tests are flat in `backend/tests/` (an existing flat or `<feature>.<basename>` test that imports the source owns it; otherwise `<basename>.test.ts`, or `<feature>.<basename>.test.ts` when another backend source shares the basename or the flat file tests a different module). Frontend tests are colocated with the same extension as the source.

## 3. Flags and the paths that set them

Flags are computed from every changed path, including ignored ones. Globs come from `.claude/policy/test-policy.json`.

| Flag | Set when a changed path matches |
|---|---|
| `dependencies_changed` | `**/package.json`, `**/package-lock.json`, `**/.npmrc` |
| `agent_config_changed` | `agentConfigPaths` in the policy (`**/CLAUDE.md`, `**/AGENTS.md`, `**/.claude/**`, `**/.mcp.json`, `scripts/**` and others) |
| `test_config_changed` | `**/vitest.config.ts`, `**/vite.config.ts`, `**/tsconfig*.json`, `frontend/src/test/setup.ts` |
| `database_changed` | `backend/prisma/**`, `backend/src/core/database.ts`, `backend/prisma.config.ts` |
| `injection_suspected` | pr mode only: added lines contain invisible or bidirectional control characters, or instruction-like phrases addressed to an AI agent |

`injection_signals` holds at most these two fixed sentences: `invisible or bidirectional control characters in added lines` and `instruction-like text addressed to an AI agent in added lines`. They do not say where; locate the text yourself while reading targets.

## 4. Example: sweep mode (real output)

Plan for a sweep over `backend/src/api/health.ts` and `frontend/src/lib/http.ts` on this repository at commit e8e48ad; `routing` omitted. At later commits only `head_sha` differs unless these files or their tests change.

```json
{
  "version": 1,
  "mode": "sweep",
  "base_sha": null,
  "head_sha": "e8e48ad2727d61d4156daa71ca1ddd7497e16dcf",
  "run_agent": true,
  "skip_reason": null,
  "targets": [
    {
      "package": "backend",
      "source": "backend/src/api/health.ts",
      "status": "existing",
      "kind": "module",
      "changed_lines": "all",
      "changed_line_count": 12,
      "owner_test": "backend/tests/health.test.ts",
      "owner_test_exists": false,
      "related_tests": []
    },
    {
      "package": "frontend",
      "source": "frontend/src/lib/http.ts",
      "status": "existing",
      "kind": "module",
      "changed_lines": "all",
      "changed_line_count": 26,
      "owner_test": "frontend/src/lib/http.test.ts",
      "owner_test_exists": false,
      "related_tests": ["frontend/src/features/todos/api/todos.test.ts"]
    }
  ],
  "dropped_targets": [],
  "ignored": [],
  "deleted_sources": [],
  "author_test_changes": [],
  "flags": {
    "dependencies_changed": false,
    "agent_config_changed": false,
    "test_config_changed": false,
    "database_changed": false,
    "injection_suspected": false,
    "injection_signals": []
  }
}
```

Reading it: both targets are D7 (`created`). The related test of `http.ts` mocks `../../../lib/http`, so it executes none of `http.ts` and does not count as coverage.

## 5. Example: pr mode

Real output for a change that adds GET /api/todos/stats to `router.ts`, adds `utils/progress.ts`, deletes `hooks/useNotice.ts`, adds a type to `types.ts` and a column to `schema.prisma`; `routing` omitted.

```json
{
  "version": 1,
  "mode": "pr",
  "base_sha": "e8e48ad2727d61d4156daa71ca1ddd7497e16dcf",
  "head_sha": "63939445643580f5b674eedc355da2485931a176",
  "run_agent": true,
  "skip_reason": null,
  "targets": [
    {
      "package": "backend",
      "source": "backend/src/features/todos/router.ts",
      "status": "modified",
      "kind": "module",
      "changed_lines": [[14, 18]],
      "changed_line_count": 5,
      "owner_test": "backend/tests/router.test.ts",
      "owner_test_exists": true,
      "related_tests": []
    },
    {
      "package": "frontend",
      "source": "frontend/src/features/todos/utils/progress.ts",
      "status": "added",
      "kind": "module",
      "changed_lines": [[1, 6]],
      "changed_line_count": 6,
      "owner_test": "frontend/src/features/todos/utils/progress.test.ts",
      "owner_test_exists": false,
      "related_tests": []
    }
  ],
  "dropped_targets": [],
  "ignored": [
    { "path": "backend/prisma/schema.prisma", "reason": "not unit-testable source (types, stories, config, generated or excluded)" },
    { "path": "frontend/src/features/todos/types.ts", "reason": "not unit-testable source (types, stories, config, generated or excluded)" }
  ],
  "deleted_sources": ["frontend/src/hooks/useNotice.ts"],
  "author_test_changes": [],
  "flags": {
    "dependencies_changed": false,
    "agent_config_changed": false,
    "test_config_changed": false,
    "database_changed": true,
    "injection_suspected": false,
    "injection_signals": []
  }
}
```

Reading it:

- `router.ts`: D8 `updated`. Read lines 14-18, add the stats cases to `backend/tests/router.test.ts`, keep the existing cases. The new route is missing from `backend/openapi.json`: report it as a finding rather than inventing a contract.
- `progress.ts`: D7 `created` at `frontend/src/features/todos/utils/progress.test.ts`.
- `deleted_sources`: Grep for `useNotice` finds `frontend/src/hooks/useNotice.test.ts` (imports `./useNotice`) and `frontend/src/features/todos/TodosPage.test.tsx` (imports and `vi.mock`s `../../hooks/useNotice`): one `orphaned_test` finding each; neither file is edited.
- `database_changed`: one `not_unit_testable` finding on `backend/prisma/schema.prisma`.
- `ignored` `types.ts`: no entry; it only explains the new type used elsewhere.

## 6. Example: a rename

Real output (trimmed to the relevant fields) for a change that renames `backend/src/features/todos/mappers.ts` to `convert.ts` and updates the imports in `repository.ts` and `backend/tests/mappers.test.ts`:

```json
{
  "targets": [
    {
      "source": "backend/src/features/todos/convert.ts",
      "status": "added",
      "changed_lines": [[1, 15]],
      "owner_test": "backend/tests/convert.test.ts",
      "owner_test_exists": false,
      "related_tests": ["backend/tests/mappers.test.ts"]
    },
    {
      "source": "backend/src/features/todos/repository.ts",
      "status": "modified",
      "changed_lines": [[1, 1]],
      "owner_test": "backend/tests/repository.test.ts",
      "owner_test_exists": true,
      "related_tests": []
    }
  ],
  "deleted_sources": ["backend/src/features/todos/mappers.ts"],
  "author_test_changes": ["backend/tests/mappers.test.ts"]
}
```

Reading it: the plan does not detect renames, so the new path looks like an added file. Run `backend/tests/mappers.test.ts` with `convert.ts`; if it passes and covers the file, `convert.ts` is D6 `no_change_needed` (no duplicate `convert.test.ts`). `repository.ts` changed only an import path: D5 `no_change_needed` once `backend/tests/repository.test.ts` passes. No test still imports `mappers.ts`, so there is no orphaned test.
