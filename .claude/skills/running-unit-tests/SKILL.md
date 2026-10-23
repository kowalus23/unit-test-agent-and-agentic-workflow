---
name: running-unit-tests
description: Runs this repository's Vitest unit tests for the backend or frontend package and reports pass/fail per test file plus per-file coverage with uncovered line numbers. Use after writing or changing any test, before reporting results, and whenever you need to know which lines of a source file are still untested.
---

# Running unit tests

There is exactly one way to run tests, and one way to type-check. Other shell commands are blocked by policy, so do not try `npx`, `npm test`, `cd`, pipes or redirects. Run every command as its own Bash call: chaining with `;`, `&&` or `||` is blocked too.

## Commands

Run tests (from the repository root):

```
node .claude/skills/running-unit-tests/scripts/run-tests.ts <backend|frontend> [paths...]
```

- `paths` are repository-relative. Test files (`backend/tests/*.test.ts`, `frontend/src/**/*.test.ts(x)`) select which tests run; source files (`backend/src/**`, `frontend/src/**`) select which files get a coverage line in the output.
- Pass the test files you wrote **and** the source files they target, e.g.
  `node .claude/skills/running-unit-tests/scripts/run-tests.ts backend backend/tests/health.test.ts backend/src/api/health.ts`
- With no test files, the whole package suite runs. Do this once at the end for every package you touched, to make sure you did not break other tests.
- One package per call. Plain paths only: no globs, quotes or flags.

Type-check (once your tests pass):

```
npm --prefix backend run typecheck
npm --prefix frontend run typecheck
```

## Reading the output

```
RESULT: FAIL (5 passed, 1 failed, 1 file(s))
- backend/tests/health.test.ts: 1 passed, 1 failed
  FAIL health > returns 503 when the database is down
    AssertionError: expected 200 to be 503
COVERAGE (statements / branches / functions / lines):
- backend/src/api/health.ts: 80% / 50% / 100% / 80%
  uncovered lines: 9-10
  lines with untaken branches: 7
```

- `RESULT: PASS` is the only success signal. Exit code 0 means pass, 1 means failing tests, 2 means the command itself was invalid (fix the arguments).
- `ERROR:` under a file means it did not run at all (syntax error, bad import, hook failure). Fix that first.
- `uncovered lines` and `lines with untaken branches` refer to the **source** file. Read those lines and decide whether they hold behaviour worth a test. Coverage is a pointer, not a goal: do not write assertion-free tests just to execute lines.

## Fix loop (at most three iterations per target)

1. Run the new or changed test file together with its source file.
2. For each failure, decide which side is wrong:
   - **The test is wrong** (bad setup, wrong mock, wrong query, async timing): fix the test.
   - **The expectation is wrong** because you misread the code: re-read the source and fix the expectation.
   - **The code is wrong** (the behaviour contradicts names, types, OpenAPI or validation rules): do not adjust the test to the bug. Remove that case and report a `suspected_bug` finding.
3. Re-run. After three unsuccessful iterations on the same target, stop: keep only the passing cases and report the target as `skipped` or partially done, with the reason.

## Before finishing

- Every test file you created or changed has passed in its latest run.
- The full suite of each touched package passes (run without test-file arguments).
- `npm --prefix <package> run typecheck` passes for each touched package.
