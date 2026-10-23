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
