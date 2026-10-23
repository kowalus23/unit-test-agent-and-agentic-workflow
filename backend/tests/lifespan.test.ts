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
  await vi.waitFor(() => expect(database.$disconnect).toHaveBeenCalledOnce());
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
