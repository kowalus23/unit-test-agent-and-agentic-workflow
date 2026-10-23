# Backend test patterns: HTTP and data

One verified pattern per module kind. Every code block below was run with Vitest 4.1.12 against this backend and passed `npm --prefix backend run typecheck`. Blocks titled "complete file" are a whole test file; blocks titled "append" are cases to add to an existing owner file, which already has the imports and `setup()` they need.

## Contents

1. [Router with a typed store mock](#1-router-with-a-typed-store-mock)
2. [App factory and error handler](#2-app-factory-and-error-handler)
3. [Router that takes the Prisma client](#3-router-that-takes-the-prisma-client)
4. [Repository with Prisma delegate spies](#4-repository-with-prisma-delegate-spies)
5. [Raw SQL bootstrap](#5-raw-sql-bootstrap)
6. [Validators](#6-validators)
7. [Mappers](#7-mappers)

## 1. Router with a typed store mock

Use for any `createXRouter(store)` (today `src/features/todos/router.ts`, owner `tests/router.test.ts`).

Facts:
- `router.param('id')` runs `idSchema` for every `/:id` route (`router.ts:7-12`): invalid ids answer 422 before any handler, so the store must not be called.
- Handlers pass `Number(res.locals.todoId)`: assert the store got the number `1`, not the string `'1'`.
- `DELETE` answers 204 with an empty body (`router.ts:33`): assert `response.text === ''`.
- A request without `Content-Type: application/json` leaves `req.body` undefined, which zod rejects with 422.
- This minimal app has no error handler, so a rejected store call gives Express's HTML 500. Test 500 responses through `createApp` (section 2).

Append to `tests/router.test.ts` (its untyped `setup()` works with these cases). For a new router file start from the typed `setup()` in SKILL.md.

```ts
it('gets a task by ID', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(todo);
  const response = await request(app).get('/api/todos/1');
  expect(response.status).toBe(200);
  expect(response.body).toEqual(todo);
  expect(repository.get).toHaveBeenCalledWith(1);
});
it.each(['get', 'patch', 'delete'] as const)('returns 404 for missing tasks (%s)', async (method) => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(null);
  repository.update.mockResolvedValue(null);
  repository.delete.mockResolvedValue(false);
  const response = await request(app)[method]('/api/todos/99').send({ title: 'Task' });
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
it.each(['0', '-1', '1.5', 'abc', '9007199254740992'])('rejects invalid task IDs without calling the repository: %s', async (id) => {
  const { app, repository } = setup();
  const response = await request(app).get(`/api/todos/${id}`);
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: expect.any(Array) });
  expect(repository.get).not.toHaveBeenCalled();
});
it('updates tasks with trimmed input', async () => {
  const { app, repository } = setup();
  repository.update.mockResolvedValue({ ...todo, title: 'New' });
  const response = await request(app).patch('/api/todos/1').send({ title: '  New  ' });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ ...todo, title: 'New' });
  expect(repository.update).toHaveBeenCalledWith(1, { title: 'New' });
});
it('rejects empty patches with the validation message', async () => {
  const { app, repository } = setup();
  const response = await request(app).patch('/api/todos/1').send({});
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: [expect.objectContaining({ code: 'custom', path: [], message: 'Provide at least one field to update.' })] });
  expect(repository.update).not.toHaveBeenCalled();
});
it('reports the invalid field in create errors', async () => {
  const { app, repository } = setup();
  const response = await request(app).post('/api/todos').send({ title: '  ' });
  expect(response.status).toBe(422);
  expect(response.body.detail).toEqual([expect.objectContaining({ code: 'too_small', path: ['title'] })]);
  expect(repository.create).not.toHaveBeenCalled();
});
it('rejects non-JSON bodies as invalid input', async () => {
  const { app, repository } = setup();
  const response = await request(app).post('/api/todos').set('Content-Type', 'text/plain').send('title=Task');
  expect(response.status).toBe(422);
  expect(repository.create).not.toHaveBeenCalled();
});
```

Notes:
- Use `expect.any(Array)` in id tables: some ids produce more than one zod issue (`'9007199254740992'` yields two).
- Do not add cases that accept odd ids such as `'0x10'` or `'1e3'`; see "When the code looks wrong" in SKILL.md.

## 2. App factory and error handler

Use for `src/factory.ts` (owner `tests/factory.test.ts`) and for any 404, 413, 422-JSON or 500 behaviour.

Facts:
- `createApp(database)` builds `TodoRepository` itself (`factory.ts:14`), so mock IO on `database.todo.*`, not on a store.
- Middleware order (`factory.ts:11-26`): `x-powered-by` off, `express.json()` (100 kb limit), `/api` health, `/api/todos`, `GET /openapi.json`, `/docs`, JSON 404, error handler.
- Express 5 forwards rejected promises from async handlers to the error handler.
- The error handler answers 422 `'Invalid JSON.'` for `entity.parse.failed` (also a top-level `null`), 413 for `entity.too.large`, and otherwise logs with `console.error(error)` and answers a generic 500 (`factory.ts:19-25`).

Complete file `backend/tests/factory.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createDatabase } from '../src/core/database.ts';
import { createApp } from '../src/factory.ts';
import { record, todo } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  // Real Prisma client on a closed port: an unmocked query fails fast instead of reaching a database.
  const database = createDatabase('postgresql://test:test@127.0.0.1:1/test');
  return { database, app: createApp(database) };
}

it('serves tasks through the repository and the Prisma delegate', async () => {
  const { app, database } = setup();
  const findMany = vi.spyOn(database.todo, 'findMany').mockResolvedValue([record]);
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(findMany).toHaveBeenCalledOnce();
});
it.each([['get', '/nope'], ['put', '/api/todos/1'], ['post', '/api/health']] as const)('returns a JSON 404 for unknown routes: %s %s', async (method, path) => {
  const { app } = setup();
  const response = await request(app)[method](path);
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Not Found' });
});
it.each(['{bad', 'null'])('rejects malformed JSON bodies: %s', async (body) => {
  const { app, database } = setup();
  const create = vi.spyOn(database.todo, 'create');
  const response = await request(app).post('/api/todos').set('Content-Type', 'application/json').send(body);
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
  expect(create).not.toHaveBeenCalled();
});
it('rejects bodies over the size limit', async () => {
  const { app } = setup();
  const response = await request(app).post('/api/todos').send({ title: 'x'.repeat(200 * 1024) });
  expect(response.status).toBe(413);
  expect(response.body).toEqual({ detail: 'Request body too large.' });
});
it('hides unexpected errors behind a generic 500 and logs them', async () => {
  const { app, database } = setup();
  const error = new Error('connect ECONNREFUSED 10.0.0.5:5432');
  vi.spyOn(database.todo, 'findMany').mockRejectedValue(error);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(response.text).not.toContain('ECONNREFUSED');
  expect(log).toHaveBeenCalledWith(error);
});
it('does not advertise Express', async () => {
  const { app } = setup();
  expect((await request(app).get('/nope')).headers['x-powered-by']).toBeUndefined();
});
it('serves the OpenAPI document and redirects /docs', async () => {
  const { app } = setup();
  const specification = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
  expect((await request(app).get('/openapi.json')).body).toEqual(specification);
  const docs = await request(app).get('/docs');
  expect(docs.status).toBe(301);
  expect(docs.headers.location).toBe('/docs/');
});
it('leaves errors after headers were sent to Express', async () => {
  const { app, database } = setup();
  vi.spyOn(database.todo, 'findMany').mockRejectedValue(new Error('late failure'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const outer = express();
  outer.use((req, res, next) => { res.flushHeaders(); next(); });
  outer.use(app);
  await expect(request(outer).get('/api/todos')).rejects.toThrow();
  expect(log).not.toHaveBeenCalled();
});
```

Notes:
- The last case covers the `res.headersSent` guard (`factory.ts:20`) from the outside. Add it only when that line is in scope; do not reach into `app.router.stack` instead.
- Silence `console.error` with `mockImplementation(() => {})` in every 500 case, and assert it was called with the error object.

## 3. Router that takes the Prisma client

Use for `src/api/health.ts` (owner `tests/health.test.ts`) and any router that receives `Database` directly.

Facts: `GET /api/health` runs `database.todo.findFirst({ select: { id: true } })` and answers `{ status: 'ok' }` (`health.ts:6-9`). A rejection has no handler inside the router, so assert the 500 through `createApp`.

Complete file `backend/tests/health.test.ts`:

```ts
import express from 'express';
import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createHealthRouter } from '../src/api/health.ts';
import { createDatabase } from '../src/core/database.ts';
import { createApp } from '../src/factory.ts';
import { record } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const database = createDatabase('postgresql://test:test@127.0.0.1:1/test');
  return { database, app: express().use('/api', createHealthRouter(database)) };
}

it('reports ok after a lightweight database query', async () => {
  const { app, database } = setup();
  const findFirst = vi.spyOn(database.todo, 'findFirst').mockResolvedValue(record);
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});
it('reports ok on an empty table', async () => {
  const { app, database } = setup();
  vi.spyOn(database.todo, 'findFirst').mockResolvedValue(null);
  expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
});
it('returns a generic 500 when the database is unavailable', async () => {
  const { database } = setup();
  vi.spyOn(database.todo, 'findFirst').mockRejectedValue(new Error('Database unavailable'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(createApp(database)).get('/api/health');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
});
```

## 4. Repository with Prisma delegate spies

Use for `src/features/todos/repository.ts` (owner `tests/repository.test.ts`) and any class that wraps `database.<model>`.

Facts:
- The repository depends on `Pick<Database, 'todo'>` (`repository.ts:5`); spy on the real client's delegate so mock values are checked against the generated `Todo` type.
- `create` and `update` set timestamps with `new Date()` (`repository.ts:18,41`): assert `expect.any(Date)` or `toBeInstanceOf(Date)`, never a literal time.
- `update` turns a `due_date` string into UTC midnight, keeps `null` (clear) and `undefined` (omit) (`repository.ts:40`).
- `update` returns `null` for an empty `updateManyAndReturn` result, `delete` returns `count > 0` (`repository.ts:44,49`).
- `mockResolvedValueOnce(a).mockResolvedValueOnce(b)` covers found and missing in one test (`tests/repository.test.ts:22`).

Append to `tests/repository.test.ts` (or a new file whose `setup()` is the closed-port version in SKILL.md):

```ts
it('updates a description without clearing other fields', async () => {
  const { database, repository } = setup();
  const update = vi.spyOn(database.todo, 'updateManyAndReturn').mockResolvedValue([{ ...record, description: 'New' }]);
  expect(await repository.update(1, { description: 'New' })).toEqual({ ...todo, description: 'New' });
  expect(update).toHaveBeenCalledWith({ where: { id: 1 }, data: { description: 'New', due_date: undefined, updated_at: expect.any(Date) } });
});
it('propagates database errors when getting a task', async () => {
  const { database, repository } = setup();
  vi.spyOn(database.todo, 'findUnique').mockRejectedValue(new Error('Database unavailable'));
  await expect(repository.get(1)).rejects.toThrow('Database unavailable');
});
```

## 5. Raw SQL bootstrap

Use for `initialize()` in `src/core/database.ts` (owner `tests/database.test.ts`) and any `$executeRaw` / `$queryRaw` call.

Facts: `initialize` runs one tagged-template `$executeRaw` that creates `todos` with two CHECK constraints that `prisma/schema.prisma` does not contain (`database.ts:12-21`). Asserting that the call received only the template strings proves no value is interpolated into the SQL.

Complete file `backend/tests/database.test.ts`:

```ts
import { afterEach, it, expect, vi } from 'vitest';
import { createDatabase, initialize } from '../src/core/database.ts';

afterEach(() => vi.restoreAllMocks());

it('creates the todos table with its check constraints and no interpolated values', async () => {
  const database = createDatabase('postgresql://test:test@127.0.0.1:1/test');
  const executeRaw = vi.spyOn(database, '$executeRaw').mockResolvedValue(0);
  await initialize(database);
  expect(executeRaw).toHaveBeenCalledOnce();
  const [strings, ...values] = executeRaw.mock.calls[0];
  expect(values).toEqual([]);
  const sql = (strings as TemplateStringsArray).join('');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS todos');
  expect(sql).toContain("CONSTRAINT todo_priority CHECK (priority IN ('low', 'medium', 'high'))");
  expect(sql).toContain('CONSTRAINT todo_title_not_empty CHECK (length(title) >= 1)');
});
```

Notes: this checks the SQL text only. Whether that DDL matches `schema.prisma` needs a real database; report such changes instead of claiming they are covered.

## 6. Validators

Use for zod schemas (`src/features/todos/validators.ts`, owner `tests/validators.test.ts`) and other pure input checks.

Facts: `createSchema` trims and fills defaults; `updateSchema` is a strict partial that rejects `{}` with `'Provide at least one field to update.'`; unknown keys fail as `unrecognized_keys` with path `[]`; `z.iso.date()` rejects impossible dates such as `2026-02-30`. `validators.ts` is held at 100 % coverage.

Append inside `describe('todo validation', ...)` in `tests/validators.test.ts`:

```ts
  it.each([
    [{ title: 'Task', due_date: '2026-02-30' }, ['due_date']],
    [{ title: 'x'.repeat(121) }, ['title']],
    [{ title: 'Task', priority: 'urgent' }, ['priority']],
    [{ title: 'Task', extra: true }, []],
  ])('reports the offending field for invalid create input: %j', (input, path) => {
    const result = createSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([path]);
  });
  it.each([
    [{ due_date: null }, { due_date: null }],
    [{ completed: true }, { completed: true }],
    [{ description: '  Notes  ' }, { description: 'Notes' }],
  ])('accepts single-field patches: %j', (input, expected) => {
    expect(updateSchema.parse(input)).toEqual(expected);
  });
```

Notes: test boundaries in pairs (120 / 121 characters, `2024-02-29` / `2025-02-29`); pin the field path, not zod's message text.

## 7. Mappers

Use for row-to-DTO functions (`src/features/todos/mappers.ts`, owner `tests/mappers.test.ts`).

Facts: `fromModel` turns Dates into ISO strings, `due_date` into `YYYY-MM-DD` or `null`, and validates the result with `todoSchema.parse`, so an invalid stored row throws (`mappers.ts:4-15`). It uses `toISOString`, so results do not depend on the time zone. Inputs must not be mutated (`tests/mappers.test.ts:5-10` checks with `structuredClone`). Held at 100 % coverage.

Append to `tests/mappers.test.ts`:

```ts
it.each([
  [new Date('2026-10-15T00:00:00.000Z'), '2026-10-15'],
  [null, null],
])('maps stored due dates to calendar dates (%s)', (due_date, expected) => {
  expect(fromModel({ ...record, due_date }).due_date).toBe(expected);
});
it('serializes timestamps as UTC ISO strings', () => {
  expect(fromModel(record)).toMatchObject({ created_at: '2026-10-01T12:00:00.000Z', updated_at: '2026-10-01T12:00:00.000Z' });
});
```
