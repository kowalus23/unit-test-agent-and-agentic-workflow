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
