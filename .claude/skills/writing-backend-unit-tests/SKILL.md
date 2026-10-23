---
name: writing-backend-unit-tests
description: Writes and extends Vitest unit tests for the backend package (Express 5, zod, Prisma 7 under backend/src) in the exact style of backend/tests - flat basename.test.ts files, explicit vitest imports, .ts relative imports, setup() helpers, supertest, typed store mocks, Prisma delegate spies on a client aimed at a closed port, table-driven it.each, hermetic env, signals and timers. Use when creating or updating tests for backend routers, the app factory and error handler, repositories, validators, mappers, config, startup/shutdown or the entry point.
---

# Writing backend unit tests

The backend is a layered Express 5 app: `main.ts` → `core/lifespan.ts` → `factory.ts` (`createApp`) → feature routers → zod validators → repository (`TodoStore`) → Prisma client delegate `database.todo` → PostgreSQL. Every unit test runs without PostgreSQL; the whole suite takes well under a second. Match the existing tests so closely that a reviewer cannot tell which cases you added.

## Before writing

- [ ] **Target file.** If a test plan gave you `owner_test`, write exactly there. Otherwise apply the rule below.
- [ ] **Read** the source file, its owner test (if it exists) and at most two exemplars from the technique table. Do not explore further.
- [ ] **Glob** `backend/tests/helpers/**` and `backend/tests/fixture.ts` to see which shared helpers and fixtures already exist. Reuse them; never duplicate a fixture.
- [ ] **List behaviours** first (inputs → observable outputs, calls at the boundary, error paths). Coverage gaps from `running-unit-tests` are pointers to behaviour, not goals.

### Test file location and name

| Situation | Test file |
|---|---|
| `backend/src/**/<name>.ts` | `backend/tests/<name>.test.ts`, flat (`src/features/todos/router.ts` → `tests/router.test.ts`) |
| `backend/src/features/<feature>/<name>.ts` whose basename also exists elsewhere in `backend/src`, or whose flat name belongs to another module's test | `backend/tests/<feature>.<name>.test.ts` (a new `src/features/users/router.ts` → `tests/users.router.test.ts`) |
| The flat or the prefixed file already exists and imports the source | that file (an existing owner always wins) |
| Shared test data | `backend/tests/fixture.ts` (add new exports; never change `record` or `todo`, other tests depend on them) |
| Shared helpers (only if two or more files need them) | `backend/tests/helpers/<name>.ts` (no `.test` suffix, so Vitest does not collect it) |

`vitest.config.ts` collects only `tests/**/*.test.ts`, uses `environment: 'node'`, has no globals and no setup file. `src/features/todos/{validators,mappers}.ts` must stay at 100 % per-file coverage (`vitest.config.ts:13-18`).

When the owner file exists, **append** cases at the end and reuse its `setup()`. Do not reorder, rename or restyle existing tests.

## Conventions to imitate exactly

| Aspect | Rule | Evidence |
|---|---|---|
| Imports | Explicit `import { afterEach, it, expect, vi } from 'vitest'` (globals are off). Sources via relative `../src/...` **with the `.ts` extension**; fixtures via `./fixture.ts`. Order: third-party (`express`, `supertest`), `vitest`, `../src/...`, `./fixture.ts`; `node:` built-ins, when needed, go first. | `tests/router.test.ts:1-5`, `tests/repository.test.ts:1-4` |
| Structure | Top-level `it(...)`, no `describe`, unless the file already has one (`tests/validators.test.ts:5`: add cases inside it). A local `function setup()` builds the subject and returns an object that each test destructures: `const { app, repository } = setup();`. No `beforeEach` that builds the subject. | `tests/router.test.ts:7-13`, `tests/repository.test.ts:8-12` |
| Titles | Lowercase, present tense, behaviour in domain words ("tasks", not "todos"), no "should": `'gets a task by ID and handles missing tasks'`, `'propagates database errors'`. Table titles show the case: `'... : %j'`, `'... (%s)'`. | `tests/repository.test.ts:14-83`, `tests/router.test.ts:28-29` |
| Tables | `it.each([...])` for boundaries and invalid inputs; add `as const` when the tuple values must keep literal types. | `tests/validators.test.ts:18-24` |
| Assertions | Status and body in separate `expect`s (no supertest `.expect()`); `toEqual` on whole DTOs; `toHaveBeenCalledWith(<exact args>)`, `toHaveBeenCalledOnce()`; every rejection path also asserts `not.toHaveBeenCalled()` on the collaborator; `rejects.toThrow('<exact message>')`; `expect.any(Date)` for timestamps the code generates; `spy.mock.calls[0][0].data` to inspect one argument. | `tests/router.test.ts:16-33`, `tests/repository.test.ts:34-37,63-69` |
| Fixtures | Variants by spread: `{ ...record, completed: true }`, `{ ...todo, due_date }`. `record` is the Prisma row (Dates), `todo` the API DTO (ISO strings). | `tests/fixture.ts:3-8` |
| Ill-typed input | `JSON.parse('{"id":2}')` instead of `as any`. | `tests/repository.test.ts:67` |
| Format | 2 spaces, single quotes, semicolons, compact one-liners up to ~150 characters. | all files |

Vitest does not type-check. `npm --prefix backend run typecheck` covers `tests/**`, so wrong mock values fail there; keep mocks typed so that check means something.

## Choose the technique by module kind

Classify by shape, not by file name: a new feature's router is a "router", a new pure helper is a "validator/mapper".

| Kind (example) | Technique | Exemplar | Read |
|---|---|---|---|
| Router factory taking a store (`features/todos/router.ts`) | `express()` + `express.json()` + router at its real prefix; store = typed `vi.fn<Store['method']>()` per method | `tests/router.test.ts` | [patterns.md §1](references/patterns.md#1-router-with-a-typed-store-mock) |
| App factory, error handler, 404, `/openapi.json`, `/docs` (`factory.ts`) | `createApp(createDatabase(<closed-port DSN>))` + supertest; spies on `database.todo.*` | none yet | [patterns.md §2](references/patterns.md#2-app-factory-and-error-handler) |
| Router taking the Prisma client (`api/health.ts`) | minimal `express().use('/api', router)` + delegate spy | none yet | [patterns.md §3](references/patterns.md#3-router-that-takes-the-prisma-client) |
| Repository (`features/todos/repository.ts`) | real Prisma client + `vi.spyOn(database.todo, '<method>')` | `tests/repository.test.ts` | [patterns.md §4](references/patterns.md#4-repository-with-prisma-delegate-spies) |
| Raw SQL bootstrap (`core/database.ts` `initialize`) | spy on `database.$executeRaw`, assert the SQL and zero interpolated values | none yet | [patterns.md §5](references/patterns.md#5-raw-sql-bootstrap) |
| zod schemas (`features/todos/validators.ts`) | pure: `parse` / `safeParse` in `it.each` tables | `tests/validators.test.ts` | [patterns.md §6](references/patterns.md#6-validators) |
| Row → DTO mapping (`features/todos/mappers.ts`) | pure: fixtures + spread, immutability via `structuredClone` | `tests/mappers.test.ts` | [patterns.md §7](references/patterns.md#7-mappers) |
| Env-driven config (`core/config.ts`) | clear and stub every variable; mock `dotenv` | none yet | [process-patterns.md §1](references/process-patterns.md#1-configuration-from-the-environment) |
| Startup and shutdown (`core/lifespan.ts`) | mock `createDatabase`, capture `process.once`, port 0, fake timers | none yet | [process-patterns.md §2](references/process-patterns.md#2-startup-and-shutdown) |
| Entry point with import side effects (`main.ts`) | `vi.doMock` + dynamic `import()` + `vi.resetModules()` | none yet | [process-patterns.md §3](references/process-patterns.md#3-entry-point-with-import-side-effects) |

## The two base shapes (verified)

Router with a typed store; this is how a new router test file starts. In `tests/router.test.ts` keep its existing `setup()` and only append cases.

```ts
import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import type { TodoStore } from '../src/features/todos/types.ts';
import { todo } from './fixture.ts';

function setup() {
  const repository = {
    list: vi.fn<TodoStore['list']>().mockResolvedValue([todo]),
    get: vi.fn<TodoStore['get']>().mockResolvedValue(todo),
    create: vi.fn<TodoStore['create']>().mockResolvedValue(todo),
    update: vi.fn<TodoStore['update']>().mockResolvedValue(todo),
    delete: vi.fn<TodoStore['delete']>().mockResolvedValue(true),
  } satisfies TodoStore;
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}

it('deletes tasks with an empty 204 response', async () => {
  const { app, repository } = setup();
  const response = await request(app).delete('/api/todos/1');
  expect(response.status).toBe(204);
  expect(response.text).toBe('');
  expect(repository.delete).toHaveBeenCalledWith(1);
});
```

Anything that talks to Prisma: a real client, mocked IO. Port 1 is closed, so a forgotten spy rejects with `P1001` in about 50 ms instead of reaching whatever database listens on 5432. (`tests/repository.test.ts:10` still uses `localhost:5432`; leave existing setups alone, use the closed port in new ones.)

```ts
import { afterEach, it, expect, vi } from 'vitest';
import { createDatabase } from '../src/core/database.ts';
import { TodoRepository } from '../src/features/todos/repository.ts';
import { record, todo } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  // Real Prisma delegate, mocked IO: no PostgreSQL is needed, and a forgotten spy fails fast.
  const database = createDatabase('postgresql://test:test@127.0.0.1:1/test');
  return { database, repository: new TodoRepository(database) };
}

it('gets a task by ID', async () => {
  const { database, repository } = setup();
  const findUnique = vi.spyOn(database.todo, 'findUnique').mockResolvedValue(record);
  expect(await repository.get(1)).toEqual(todo);
  expect(findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
});
```

## Mock only the boundary

- Routers: mock the store interface they receive. Repository, factory, health: spy on Prisma delegate methods. Config and lifespan: env, `dotenv`, `createDatabase`, `process`, timers.
- Never mock the module under test or its pure collaborators: router tests run the real zod validators, repository tests run the real mapper.
- Spied Prisma methods are typed by the generated client, so `mockResolvedValue(record)` is checked against the schema. Do not cast mock values.
- Never write tests of Express, Prisma or zod themselves (that `express.json()` parses JSON, how Prisma builds queries). Assert this code's decisions: status, body, the exact call at the boundary.

## Asserting error responses

The `detail` strings below are shown to users by the frontend, so pin them exactly.

| Case | Expected | Test through | How |
|---|---|---|---|
| Missing resource | 404 `{ detail: 'Task not found.' }` | router | `toEqual` on the body |
| Unknown route or method (`PUT /api/todos/1`) | 404 `{ detail: 'Not Found' }` | `createApp` | `factory.ts:18` |
| zod validation (body or `:id`) | 422 `{ detail: ZodIssue[] }` | router | tables: `toEqual({ detail: expect.any(Array) })`; one case pins `path` and `code`, plus messages the app wrote (`'Provide at least one field to update.'`), never zod's own wording |
| Malformed JSON, or `null` top-level | 422 `{ detail: 'Invalid JSON.' }` | `createApp` | `.set('Content-Type', 'application/json').send('{bad')` |
| Body over 100 kb | 413 `{ detail: 'Request body too large.' }` | `createApp` | `.send({ title: 'x'.repeat(200 * 1024) })` |
| Unexpected error | 500 `{ detail: 'Internal Server Error' }` | `createApp` only: a bare router app answers with Express's HTML 500 | reject a delegate spy; silence and assert `console.error` was called with the error; assert `response.text` does not contain the error message |

On every rejected input also assert the store or delegate was **not** called.

## Hermetic and deterministic

- No real database and no network: only in-process servers (supertest, `start()` with `API_PORT=0`) on ephemeral local ports, never a fixed port.
- No sleeping. Use `vi.useFakeTimers()` + `vi.advanceTimersByTime()` for timeouts, `once(emitter, 'event')` from `node:events` for events, and `vi.waitFor()` only for an async callback you cannot await.
- Dates: build them with an explicit `Z` (`new Date('2026-10-15T00:00:00.000Z')`); timestamps the code creates are `expect.any(Date)`. Never depend on the machine's time zone or clock.
- `src/core/config.ts:4` loads the repository-root `.env` when imported (also via `lifespan.ts`). It exists on some machines and not on others, so stub every variable the code reads. Never read `.env` files.
- Never install real signal handlers, never let `process.exit` run, always reset `process.exitCode`.
- Clean up everything you change:

| You used | Undo in `afterEach` |
|---|---|
| `vi.spyOn` | `vi.restoreAllMocks()` (restores originals; it does **not** clear `vi.fn()` call history in Vitest 4) |
| module-level or `vi.hoisted` `vi.fn()` | `vi.clearAllMocks()` |
| `vi.stubEnv` | `vi.unstubAllEnvs()` |
| `vi.useFakeTimers` | `vi.useRealTimers()` |
| `vi.doMock` + dynamic import | `vi.doUnmock(path)` and `vi.resetModules()` |
| `process.exitCode` set by code | `process.exitCode = undefined` |
| a listening server | close it |

Every test must pass alone and in any order.

## Don't

| Don't | Why |
|---|---|
| `toMatchSnapshot` / `toMatchInlineSnapshot` | the oracle becomes whatever the code returns today; forbidden by `.claude/policy/test-policy.json` |
| `.only`, `.skip`, `.todo`, `.fails`, `xit` | hides or inverts tests; forbidden by the same policy |
| assert private internals (`app.router.stack`, `res.locals`, the repository's `allowed` list) | breaks on refactors and proves nothing a client can see |
| assert only the value you passed to `mockResolvedValue` | tests the mock; also assert the call arguments or the transformation |
| `as any`, untyped casts of mock values | hides type drift that the type check would catch |
| `node:child_process`, reading credentials from `process.env` | forbidden by the same policy; unit tests spawn nothing and need no credentials |
| assertion-free tests to execute lines | coverage without a check is noise |
| rewrite or delete existing cases, change existing fixture values | human assertions are protected; add new cases instead |

## When the code looks wrong

A test that fails against the current code may have found a bug. Decide from intent (names, types, `openapi.json`, validation messages, existing tests), not from current output. If the code is wrong: do not assert the current behaviour, do not weaken the assertion, do not mark the test skipped or failing. Remove that case, keep the correct ones, and report a `suspected_bug` with file, line, triggering input, expected and actual result. You may confirm actual behaviour with a temporary case and then remove it with Edit.

Patterns seen in this codebase (re-check each against the current code before reporting; they are examples, not a list to report):

- **A failure surfaces as a different, misleading error.** `start()` resolves its listen promise in the `app.listen` callback (`src/core/lifespan.ts:13-16`); Express 5 also calls that callback on a listen error, so a busy port rejects with `TypeError: Cannot read properties of null (reading 'port')` instead of `EADDRINUSE`.
- **Client mistakes reported as server errors.** The error handler maps only `entity.parse.failed` and `entity.too.large` (`src/factory.ts:21-22`). An unsupported charset (expected 415) or a malformed percent-encoded path such as `/api/todos/%E0%A4%A` (expected 400) falls through to 500 and `console.error`.
- **Validation looser than storage or contract.** `idSchema` uses `z.coerce.number()` (`src/features/todos/validators.ts:22`), so `'0x10'` becomes 16 and `'1e3'` becomes 1000, and ids up to `Number.MAX_SAFE_INTEGER` pass although the column is a 4-byte `SERIAL` (`src/core/database.ts:13`). Never add a case that treats such quirks as correct.

Unit tests with a mocked delegate cannot detect drift between `prisma/schema.prisma` and the DDL in `src/core/database.ts`; if a change touches either, say so in a finding instead of claiming coverage.

## Finish

1. Run the file with its source: `node .claude/skills/running-unit-tests/scripts/run-tests.ts backend backend/tests/<file>.test.ts backend/src/<path>.ts`.
2. Fix test-side mistakes (at most three iterations per target), then run the whole backend suite: `node .claude/skills/running-unit-tests/scripts/run-tests.ts backend`.
3. `npm --prefix backend run typecheck`.
4. Self-check: target path follows the layout rule; imports use `.ts` and explicit vitest names; every test calls `setup()` or builds its subject locally; each rejection path asserts the collaborator was not called; user-visible `detail` strings are exact; nothing reads `.env`, binds a fixed port, sleeps or leaks env, timers, mocks, servers or `process.exitCode`.
