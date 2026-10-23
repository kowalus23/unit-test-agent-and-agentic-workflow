# Backend test patterns: config, startup and entry point

Advanced patterns for modules with side effects at import time or on the process. Every code block below is a complete test file that was run with Vitest 4.1.12 against this backend (also in shuffled order and with a root `.env` present) and passed `npm --prefix backend run typecheck`.

## Contents

1. [Configuration from the environment](#1-configuration-from-the-environment)
2. [Startup and shutdown](#2-startup-and-shutdown)
3. [Entry point with import side effects](#3-entry-point-with-import-side-effects)
4. [Rules that apply to all three](#4-rules-that-apply-to-all-three)

## 1. Configuration from the environment

Use for `src/core/config.ts` (owner `tests/config.test.ts`) and any module that reads `process.env`.

Facts:
- `config.ts:4` calls `dotenv.config({ path: <repository root>/.env, quiet: true })` when the module is imported. dotenv only fills variables that are not set yet. A developer machine usually has that `.env` (with `DATABASE_URL` or the `POSTGRES_*` values), other machines do not: without clean-up the same test passes on one and fails on the other.
- `resolveDatabaseUrl()` reads `process.env` on every call, so a static import is enough; `vi.resetModules()` and a dynamic import are not needed here.
- Lookup order (`config.ts:7-19`): the `override` argument, else `DATABASE_URL` (both with `postgresql+psycopg:` rewritten to `postgresql:`), else the five variables `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `DB_PORT`, `POSTGRES_DB`, checked in that order; an empty string counts as missing.
- `vi.stubEnv(name, undefined)` deletes a variable; `vi.unstubAllEnvs()` restores what was there before.

Complete file `backend/tests/config.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { afterEach, it, expect, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

// config.ts calls dotenv.config() on import; mock it so the developer's .env is never read.
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

const variables = ['DATABASE_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB'];
const parts = { POSTGRES_USER: 'user', POSTGRES_PASSWORD: 'pass', POSTGRES_HOST: 'db', DB_PORT: '5432', POSTGRES_DB: 'taskly' };

afterEach(() => vi.unstubAllEnvs());

function setup(env: Record<string, string> = {}) {
  // Clear every variable the module reads (the shell may define them too), then apply the case.
  for (const name of variables) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

it('loads the repository .env quietly on import', () => {
  expect(dotenv.config).toHaveBeenCalledWith({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
});
it('builds the URL from the separate variables', () => {
  setup(parts);
  expect(resolveDatabaseUrl()).toBe('postgresql://user:pass@db:5432/taskly');
});
it.each(Object.keys(parts))('reports a missing %s', (name) => {
  setup({ ...parts, [name]: '' });
  expect(() => resolveDatabaseUrl()).toThrow(`Missing environment variable: ${name}`);
});
it('prefers an explicit URL and normalizes the psycopg scheme', () => {
  setup({ ...parts, DATABASE_URL: 'postgresql+psycopg://a:b@h:1/d' });
  expect(resolveDatabaseUrl()).toBe('postgresql://a:b@h:1/d');
  expect(resolveDatabaseUrl('postgres://o:p@q:2/r')).toBe('postgres://o:p@q:2/r');
});
it('percent-encodes credentials and the database name', () => {
  setup({ ...parts, POSTGRES_USER: 'us er', POSTGRES_PASSWORD: 'p@ss:w/rd#?', POSTGRES_DB: 'my db' });
  expect(resolveDatabaseUrl()).toBe('postgresql://us%20er:p%40ss%3Aw%2Frd%23%3F@db:5432/my%20db');
});
```

Notes:
- Mocking `dotenv` and clearing the variables solve different leaks (the file versus the shell). Keep both.
- Only pin encodings that are correct. Inputs where the URL setters silently drop or keep a value (`DB_PORT='abc'`, `POSTGRES_HOST='db host'`, a literal `%41` in the password) currently fall back to defaults or reach the driver unencoded; treat that as a suspected bug, not as expected output.

## 2. Startup and shutdown

Use for `src/core/lifespan.ts` (owner `tests/lifespan.test.ts`).

Facts:
- `start()` (`lifespan.ts:7-33`) resolves the URL, creates the client, `$connect()`, `initialize()`, `createApp`, listens on `Number(API_PORT || 8000)` at `0.0.0.0`, logs the port, and registers `shutdown` with `process.once` for `SIGTERM` and `SIGINT`. Any failure after the client exists calls `$disconnect()` and rethrows.
- `shutdown` starts an unref'ed 10 s timer that calls `process.exit(1)`, closes the server, then `$disconnect()`; a disconnect error is logged and sets `process.exitCode = 1` (`lifespan.ts:18-25`).
- Importing `lifespan.ts` imports `config.ts`, so the root `.env` may set `API_PORT` and `DATABASE_URL`: stub both.
- Mock only `createDatabase`; `importOriginal` keeps the real `initialize`, which then calls the fake `$executeRaw`.
- `vi.hoisted` mocks live for the whole file: clear them with `vi.clearAllMocks()` (`vi.restoreAllMocks()` does not reset their call history).

Complete file `backend/tests/lifespan.test.ts`:

```ts
import { once } from 'node:events';
import { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, it, expect, vi } from 'vitest';
import { createDatabase } from '../src/core/database.ts';
import { start } from '../src/core/lifespan.ts';

// A fake client: lifespan only needs these members, and nothing may reach PostgreSQL.
const database = vi.hoisted(() => ({ $connect: vi.fn(), $disconnect: vi.fn(), $executeRaw: vi.fn(), todo: { findFirst: vi.fn() } }));
vi.mock('../src/core/database.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/database.ts')>()),
  createDatabase: vi.fn(() => database),
}));

const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  await Promise.all(servers.splice(0).filter((server) => server.listening).map((server) => new Promise((resolve) => server.close(resolve))));
});

function setup() {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@127.0.0.1:1/test');
  vi.stubEnv('API_PORT', '0');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  // Capture signal handlers instead of installing them in the test worker.
  const signals = new Map<string | symbol, () => void>();
  vi.spyOn(process, 'once').mockImplementation((event, listener) => {
    signals.set(event, listener as () => void);
    return process;
  });
  return { signals };
}
async function started() {
  const result = await start();
  servers.push(result.server);
  return result;
}

it('connects, creates the schema and listens on API_PORT', async () => {
  const { signals } = setup();
  const { server } = await started();
  expect(database.$connect.mock.invocationCallOrder[0]).toBeLessThan(database.$executeRaw.mock.invocationCallOrder[0]);
  expect(server.listening).toBe(true);
  expect(console.log).toHaveBeenCalledWith(`Taskly App Node API listening on port ${(server.address() as AddressInfo).port}`);
  expect([...signals.keys()]).toEqual(['SIGTERM', 'SIGINT']);
});
it('listens on port 8000 on all interfaces by default', async () => {
  setup();
  vi.stubEnv('API_PORT', undefined);
  const listen = Server.prototype.listen;
  // Record the requested port, but bind an ephemeral one so the test never occupies 8000.
  const spy = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (this: Server, ...args: unknown[]) {
    return listen.apply(this, [0, ...args.slice(1)] as Parameters<Server['listen']>);
  });
  await started();
  expect(spy.mock.calls[0].slice(0, 2)).toEqual([8000, '0.0.0.0']);
});
it.each(['SIGTERM', 'SIGINT'])('closes the server and disconnects on %s', async (signal) => {
  const { signals } = setup();
  const { server } = await started();
  signals.get(signal)!();
  await once(server, 'close');
  expect(server.listening).toBe(false);
  expect(database.$disconnect).toHaveBeenCalledOnce();
});
it('forces exit when shutdown hangs', async () => {
  const { signals } = setup();
  const { server } = await started();
  vi.useFakeTimers();
  vi.spyOn(server, 'close').mockImplementation(() => server);
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  signals.get('SIGTERM')!();
  vi.advanceTimersByTime(9999);
  expect(exit).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(exit).toHaveBeenCalledWith(1);
});
it('logs a failed disconnect and sets a failing exit code', async () => {
  const { signals } = setup();
  const error = new Error('disconnect failed');
  database.$disconnect.mockRejectedValueOnce(error);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await started();
  signals.get('SIGTERM')!();
  await vi.waitFor(() => expect(log).toHaveBeenCalledWith(error));
  expect(process.exitCode).toBe(1);
});
it.each(['$connect', '$executeRaw'] as const)('disconnects and rethrows when %s fails', async (step) => {
  setup();
  const error = new Error(`${step} failed`);
  database[step].mockRejectedValueOnce(error);
  await expect(start()).rejects.toBe(error);
  expect(database.$disconnect).toHaveBeenCalledOnce();
});
it('fails before creating a client when the database is not configured', async () => {
  setup();
  for (const name of ['DATABASE_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB']) vi.stubEnv(name, undefined);
  await expect(start()).rejects.toThrow('Missing environment variable: POSTGRES_USER');
  expect(createDatabase).not.toHaveBeenCalled();
});
```

Notes:
- Turn on fake timers only after `start()` resolved and right before triggering the timer; `afterEach` turns them off before closing servers.
- `vi.spyOn(server, 'close')` keeps the server open; `afterEach` restores the spy first, then closes it.
- Do not add a case that expects today's result on a busy port: `start()` rejects with a `TypeError` about `port` instead of `EADDRINUSE` (see "When the code looks wrong" in SKILL.md).

## 3. Entry point with import side effects

Use for `src/main.ts` (owner `tests/main.test.ts`): it calls `start()` at import time and on failure logs `'Cannot start Taskly App Node API:'` with the error and sets `process.exitCode = 1` (`main.ts:3-6`).

Facts: a module runs once per module registry. `vi.doMock` (not hoisted) plus `await import()` inside the test lets each case choose `start`'s behaviour; `vi.resetModules()` in `afterEach` is required, otherwise the second `import()` returns the cached module and `start` is never called.

Complete file `backend/tests/main.test.ts`:

```ts
import { afterEach, it, expect, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../src/core/lifespan.ts');
  vi.resetModules();
  process.exitCode = undefined;
});

it('reports startup failures and sets a failing exit code', async () => {
  const error = new Error('boom');
  vi.doMock('../src/core/lifespan.ts', () => ({ start: vi.fn().mockRejectedValue(error) }));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('../src/main.ts');
  await vi.waitFor(() => expect(log).toHaveBeenCalledWith('Cannot start Taskly App Node API:', error));
  expect(process.exitCode).toBe(1);
});
it('starts the API once on import', async () => {
  const start = vi.fn().mockResolvedValue(undefined);
  vi.doMock('../src/core/lifespan.ts', () => ({ start }));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('../src/main.ts');
  expect(start).toHaveBeenCalledOnce();
  expect(log).not.toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
});
```

## 4. Rules that apply to all three

| Rule | Reason |
|---|---|
| Stub every environment variable the code path reads, including ones a `.env` might set | results must not depend on the machine |
| Never read `.env` files | they hold local credentials and are not test input |
| Use `API_PORT=0` or the `Server.prototype.listen` redirect above | fixed ports collide with running services and parallel test files |
| Capture `process.once` / `process.on` handlers with a spy | real handlers stay registered on the test worker and change how it reacts to signals |
| Mock `process.exit`; reset `process.exitCode` | Vitest turns a real call into an error (`process.exit unexpectedly called`); a leftover exit code leaks into later cases that assert it |
| Prefer `once(emitter, 'event')` and fake timers over `vi.waitFor`; never `setTimeout` sleeps | waiting on time makes tests slow and flaky |
| Close every server `start()` opened (the `servers` list above) | open handles keep the worker alive and hold ports |
