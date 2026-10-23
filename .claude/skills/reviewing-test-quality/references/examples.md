# Bad and good examples

Every snippet below was run against this repository's code and passed. Where a mutant is named, it was applied to a copy of the source: the bad version stayed green and the good version failed.

Contents:

1. Existence test vs behaviour with fake timers (Q1, Q10, Q16)
2. Call-only route test vs contract assertions (Q16)
3. Mock echo vs boundary call (Q3)
4. Stubbing fetch with cleanup (Q9, Q11)
5. Prisma without a database (Q9)
6. Waiting for async UI (Q8)

## 1. Existence test vs behaviour with fake timers (Q1, Q10, Q16)

Bad, the existing `frontend/src/hooks/useNotice.test.ts:5-9`: it asserts only that `notify` is a function, so changing the timeout in `useNotice.ts:8` from 4000 to 3000 leaves it green.

```ts
expect(result.current.notify).toEqual(expect.any(Function))
```

Good: drives the behaviour and controls time. Fails on the 4000 -> 3000 mutant.

```ts
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useNotice } from './useNotice'

afterEach(() => vi.useRealTimers())

it('shows a notice and clears it after four seconds', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('Task created.'))
  expect(result.current.message).toBe('Task created.')
  act(() => vi.advanceTimersByTime(3999))
  expect(result.current.message).toBe('Task created.')
  act(() => vi.advanceTimersByTime(1))
  expect(result.current.message).toBe('')
})
```

## 2. Call-only route test vs contract assertions (Q16)

Both use `setup()` from `backend/tests/router.test.ts:7-13`. Mutant: `router.ts:21` `status(404)` -> `status(200)`.

Bad: survives the mutant, because it never looks at the response.

```ts
it('looks up a missing task', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(null);
  await request(app).get('/api/todos/99');
  expect(repository.get).toHaveBeenCalledWith(99);
});
```

Good: asserts the status and body declared in `backend/openapi.json` and the copy in `router.ts:21`; fails on the mutant.

```ts
it('returns 404 with a detail message when the task does not exist', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(null);
  const response = await request(app).get('/api/todos/99');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
  expect(repository.get).toHaveBeenCalledWith(99);
});
```

## 3. Mock echo vs boundary call (Q3)

Context: `frontend/src/features/todos/api/todos.test.ts:1-7` (`request` mocked, `vi.clearAllMocks()` before each test). Mutant: `todos.ts:23` `method: 'PATCH'` -> `'PUT'`.

Bad: only echoes the mocked value; survives the mutant.

```ts
it('updates a task', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await expect(todosApi.update(7, { completed: true })).resolves.toEqual(
    todoFixture,
  )
})
```

Good: asserts what `update` itself decides (URL, method, body without undefined fields); fails on the mutant.

```ts
it('sends only the changed fields in a PATCH to the task URL', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await todosApi.update(7, { completed: true })
  expect(request).toHaveBeenCalledWith('/todos/7', {
    method: 'PATCH',
    body: JSON.stringify({ completed: true }),
  })
})
```

## 4. Stubbing fetch with cleanup (Q9, Q11)

`vi.unstubAllGlobals()` restores only what `vi.stubGlobal` replaced, so stub `fetch` that way and never assign `globalThis.fetch` directly. Expected messages come from `frontend/src/lib/http.ts:10` and `:9` (aborted requests rethrow the original error).

```ts
import { afterEach, expect, it, vi } from 'vitest'
import { request } from './http'

afterEach(() => vi.unstubAllGlobals())

it('reports an unreachable server with a readable message', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
  await expect(request('/todos')).rejects.toThrow(
    'Cannot connect to the server. Please try again.',
  )
})

it('rethrows the original error when the request was aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const abort = new DOMException('Aborted', 'AbortError')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort))
  await expect(request('/todos', { signal: controller.signal })).rejects.toBe(abort)
})
```

## 5. Prisma without a database (Q9)

Build the real client against an unroutable address and spy on the delegate the code path uses. A call you forgot to spy on rejects quickly instead of reaching a database. Restore spies afterwards (`backend/tests/repository.test.ts:6`).

```ts
const database = createDatabase('postgresql://test:test@127.0.0.1:1/test');
const repository = new TodoRepository(database);
vi.spyOn(database.todo, 'findUnique').mockResolvedValue(record);
expect(await repository.get(1)).toEqual(todo);
```

## 6. Waiting for async UI (Q8)

Bad: passes, but `waitFor` plus `getBy*` is the long form and invites extra assertions inside the callback.

```tsx
await waitFor(() => expect(screen.getByText('Task created.')).toBeVisible())
```

Good:

```tsx
expect(await screen.findByText('Task created.')).toBeVisible()
```
