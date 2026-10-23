# Hook tests

Contents
1. Setup shared by React Query hook tests
2. Query hook (`useTodosQuery`)
3. Mutation hooks and the cache
4. Race: an in-flight refetch must not overwrite a saved task
5. Busy flag (`useTodosBusy`)
6. Plain state hook (`useTodoFilters`)
7. Timer hook (`useNotice`)
8. Pitfalls

All snippets below passed in a copy of `frontend/`. The race test in section 4 was also checked against a copy with the `cancelQueries` line removed: it fails there, so it guards real behaviour.

## 1. Setup shared by React Query hook tests

- File: `features/todos/hooks/useX.test.ts` (no JSX needed; the wrapper lives in the helper).
- Helper: `createTestQueryClient` / `createWrapper` from the shared `frontend/src/test/queryClient.tsx` (see SKILL.md section 7).
- Mock the API module, not React Query. The hooks call `todosApi` (`features/todos/api/todos.ts`); keep `useQueryClient`, `useMutation` and `cancelQueries` real, because the cache logic is what you test.

```ts
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createTestQueryClient, createWrapper } from '../../../test/queryClient'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo, TodoInput } from '../types'
import { useCreateTodoMutation } from './useCreateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))
beforeEach(() => vi.clearAllMocks())
```

Query keys come from `features/todos/api/queryKeys.ts`: the list lives under `todoKeys.list` (`['todos', 'list']`); mutations use `todoKeys.create|update|delete`, all prefixed by `todoKeys.all`.

## 2. Query hook (`useTodosQuery`)

```ts
it('loads tasks with the abort signal provided by the query', async () => {
  vi.mocked(todosApi.list).mockResolvedValue([todoFixture])
  const { result } = renderHook(() => useTodosQuery(), {
    wrapper: createWrapper(createTestQueryClient()),
  })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(result.current.data).toEqual([todoFixture])
  expect(todosApi.list).toHaveBeenCalledWith(expect.any(AbortSignal))
})

it('exposes a failed request as an error without retrying', async () => {
  vi.mocked(todosApi.list).mockRejectedValue(new Error('Cannot connect.'))
  const { result } = renderHook(() => useTodosQuery(), {
    wrapper: createWrapper(createTestQueryClient()),
  })
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.error).toEqual(new Error('Cannot connect.'))
  expect(todosApi.list).toHaveBeenCalledTimes(1)
})
```

The signal assertion is what makes the first test worth having: the data check alone would only echo the mock.

## 3. Mutation hooks and the cache

Seed the list, run the mutation with `mutate`, wait for `isSuccess` or `isError`, then assert the API call and `client.getQueryData(todoKeys.list)`.

Create (`useCreateTodoMutation.ts:11-17`: cancel list queries, then put the saved task first and drop any copy with the same id; an empty cache becomes `[saved]`):

```ts
const input: TodoInput = {
  title: 'Write tests',
  description: '',
  priority: 'high',
  due_date: null,
  completed: false,
}

it('puts the saved task first in the cached list and drops a stale copy', async () => {
  const client = createTestQueryClient()
  const older: Todo = { ...todoFixture, id: 3, title: 'Older task' }
  const saved: Todo = { ...todoFixture, ...input }
  client.setQueryData<Todo[]>(todoKeys.list, [older, todoFixture])
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const { result } = renderHook(() => useCreateTodoMutation(), {
    wrapper: createWrapper(client),
  })
  result.current.mutate(input)
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(todosApi.create).toHaveBeenCalledWith(input)
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, older])
})

it('leaves the cache untouched and exposes the error when saving fails', async () => {
  const client = createTestQueryClient()
  client.setQueryData<Todo[]>(todoKeys.list, [todoFixture])
  vi.mocked(todosApi.create).mockRejectedValue(
    new Error('Request body too large.'),
  )
  const { result } = renderHook(() => useCreateTodoMutation(), {
    wrapper: createWrapper(client),
  })
  result.current.mutate(input)
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.error?.message).toBe('Request body too large.')
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
```

Add the empty-cache case: no `setQueryData`, then `expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])`.

Update (`useUpdateTodoMutation.ts:12-16`: replace by id, leave others; an empty cache stays empty):

```ts
it('replaces only the updated task in the cached list', async () => {
  const client = createTestQueryClient()
  const other: Todo = { ...todoFixture, id: 3, title: 'Other' }
  const saved: Todo = { ...todoFixture, completed: true }
  client.setQueryData<Todo[]>(todoKeys.list, [other, todoFixture])
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  const { result } = renderHook(() => useUpdateTodoMutation(), {
    wrapper: createWrapper(client),
  })
  result.current.mutate({ id: 7, input: { completed: true } })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(todosApi.update).toHaveBeenCalledWith(7, { completed: true })
  expect(client.getQueryData(todoKeys.list)).toEqual([other, saved])
})

it('does not create a list when nothing is cached', async () => {
  const client = createTestQueryClient()
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  const { result } = renderHook(() => useUpdateTodoMutation(), {
    wrapper: createWrapper(client),
  })
  result.current.mutate({ id: 7, input: { completed: true } })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})
```

Delete (`useDeleteTodoMutation.ts:11-15`: remove by the id passed to `mutate`):

```ts
it('removes the deleted task from the cached list by id', async () => {
  const client = createTestQueryClient()
  const other: Todo = { ...todoFixture, id: 3 }
  client.setQueryData<Todo[]>(todoKeys.list, [other, todoFixture])
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const { result } = renderHook(() => useDeleteTodoMutation(), {
    wrapper: createWrapper(client),
  })
  result.current.mutate(7)
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(todosApi.remove).toHaveBeenCalledWith(7)
  expect(client.getQueryData(todoKeys.list)).toEqual([other])
})
```

The hooks write the cache with `setQueryData`; none of them calls `invalidateQueries`. Assert what the source does; if a change adds invalidation, assert the refetch through `todosApi.list` call counts.

## 4. Race: an in-flight refetch must not overwrite a saved task

`useCreateTodoMutation.ts:12-13` cancels list queries before writing. Render the query and the mutation together; the seeded data is stale (`staleTime` 0), so mounting starts a refetch that you hold open:

```ts
it('cancels an in-flight list refetch so stale data cannot overwrite the saved task', async () => {
  const client = createTestQueryClient()
  client.setQueryData<Todo[]>(todoKeys.list, [todoFixture])
  let resolveList!: (todos: Todo[]) => void
  vi.mocked(todosApi.list).mockImplementation(
    () => new Promise((resolve) => (resolveList = resolve)),
  )
  const saved: Todo = { ...todoFixture, id: 8, title: 'Created' }
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const { result } = renderHook(
    () => ({ list: useTodosQuery(), create: useCreateTodoMutation() }),
    { wrapper: createWrapper(client) },
  )
  // Cached data is stale (staleTime 0), so mounting the query starts a refetch.
  await waitFor(() => expect(result.current.list.isFetching).toBe(true))
  result.current.create.mutate(input)
  await waitFor(() => expect(result.current.create.isSuccess).toBe(true))
  resolveList([todoFixture])
  await waitFor(() => expect(result.current.list.isFetching).toBe(false))
  expect(result.current.list.data).toEqual([saved, todoFixture])
})
```

The same shape applies to update and delete (`useUpdateTodoMutation.ts:13`, `useDeleteTodoMutation.ts:12`).

## 5. Busy flag (`useTodosBusy`)

`useIsMutating({ mutationKey: todoKeys.all }) > 0` (`useTodosBusy.ts:5`). Hold a real mutation open with a deferred promise:

```ts
it('is busy exactly while a task mutation is pending', async () => {
  let finish!: () => void
  vi.mocked(todosApi.remove).mockImplementation(
    () => new Promise<void>((resolve) => (finish = resolve)),
  )
  const { result } = renderHook(
    () => ({ busy: useTodosBusy(), remove: useDeleteTodoMutation() }),
    { wrapper: createWrapper(createTestQueryClient()) },
  )
  expect(result.current.busy).toBe(false)
  result.current.remove.mutate(7)
  await waitFor(() => expect(result.current.busy).toBe(true))
  finish()
  await waitFor(() => expect(result.current.busy).toBe(false))
})

it('ignores mutations outside the tasks key', async () => {
  const { result } = renderHook(
    () => ({
      busy: useTodosBusy(),
      other: useMutation({
        mutationKey: ['settings'],
        mutationFn: () => new Promise<void>(() => {}),
      }),
    }),
    { wrapper: createWrapper(createTestQueryClient()) },
  )
  result.current.other.mutate()
  await waitFor(() => expect(result.current.other.isPending).toBe(true))
  expect(result.current.busy).toBe(false)
})
```

`useMutation` comes from `@tanstack/react-query`.

## 6. Plain state hook (`useTodoFilters`)

No provider. Call setters inside `act`; use `initialProps` + `rerender` for new input:

```ts
import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { useTodoFilters } from './useTodoFilters'

const done: Todo = { ...todoFixture, id: 8, title: 'Ship it', completed: true }

it('narrows the visible tasks when the status filter changes', () => {
  const { result } = renderHook(() => useTodoFilters([todoFixture, done]))
  expect(result.current.filter).toBe('all')
  expect(result.current.visible).toEqual([done, todoFixture])
  act(() => result.current.setFilter('completed'))
  expect(result.current.visible).toEqual([done])
})

it('recomputes the visible tasks when new tasks arrive', () => {
  const { result, rerender } = renderHook(
    ({ todos }) => useTodoFilters(todos),
    { initialProps: { todos: [todoFixture] } },
  )
  act(() => result.current.setSearch('ship'))
  expect(result.current.visible).toEqual([])
  rerender({ todos: [todoFixture, done] })
  expect(result.current.visible).toEqual([done])
})
```

Test the sorting and filtering rules themselves in `utils/todos.test.ts`, not through this hook.

## 7. Timer hook (`useNotice`)

`useNotice.ts:6-10` clears the message 4000 ms after each `notify` and clears the timeout on unmount. Full fake timers, synchronous assertions, no `waitFor`:

```ts
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useNotice } from './useNotice'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('clears the notice four seconds after the last notification', () => {
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('Task deleted.'))
  expect(result.current.message).toBe('Task deleted.')
  act(() => vi.advanceTimersByTime(3999))
  expect(result.current.message).toBe('Task deleted.')
  act(() => vi.advanceTimersByTime(1))
  expect(result.current.message).toBe('')
})

it('cancels the pending timer on unmount', () => {
  const { result, unmount } = renderHook(() => useNotice())
  act(() => result.current.notify('Saved.'))
  expect(vi.getTimerCount()).toBe(1)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
```

Also worth a case: a second `notify` with the same text restarts the 4000 ms window. The existing `useNotice.test.ts` checks only initial values; add these cases next to it.

## 8. Pitfalls

- Read `result.current` after each wait. Destructuring it early (`const { isSuccess } = result.current`) freezes the values of that render.
- `mutate` + `waitFor(isSuccess | isError)` keeps the test simple and never leaves a rejected promise unhandled.
- One client per test. Reusing a client between tests leaks cache and mutation state.
- Do not mock `useQueryClient`, `useMutation` or `useQuery`; that tests the mock, not the hook.
- Never use `lib/queryClient` (retries once, shared cache). Never import `main.tsx`.
