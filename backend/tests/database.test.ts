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
it('propagates schema creation errors', async () => {
  const database = createDatabase('postgresql://test:test@127.0.0.1:1/test');
  vi.spyOn(database, '$executeRaw').mockRejectedValue(new Error('Database unavailable'));
  await expect(initialize(database)).rejects.toThrow('Database unavailable');
});
