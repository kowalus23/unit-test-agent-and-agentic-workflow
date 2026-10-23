import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createTestQueryClient, createWrapper } from '../../../test/queryClient'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo, TodoInput } from '../types'
import { useCreateTodoMutation } from './useCreateTodoMutation'
import { useTodosQuery } from './useTodosQuery'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))
beforeEach(() => vi.clearAllMocks())

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

it('creates the cached list when nothing is cached yet', async () => {
  const client = createTestQueryClient()
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { result } = renderHook(() => useCreateTodoMutation(), {
    wrapper: createWrapper(client),
  })
  result.current.mutate(input)
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
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
