import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createTestQueryClient, createWrapper } from '../../../test/queryClient'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useClearCompletedMutation } from './useClearCompletedMutation'
import { useTodosQuery } from './useTodosQuery'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    clearCompleted: vi.fn(),
  },
}))
beforeEach(() => vi.clearAllMocks())

it('removes completed tasks from the cached list and returns the deleted count', async () => {
  const client = createTestQueryClient()
  const done: Todo = { ...todoFixture, id: 3, completed: true }
  client.setQueryData<Todo[]>(todoKeys.list, [done, todoFixture])
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 1 })
  const { result } = renderHook(() => useClearCompletedMutation(), {
    wrapper: createWrapper(client),
  })
  result.current.mutate()
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(todosApi.clearCompleted).toHaveBeenCalledTimes(1)
  expect(result.current.data).toEqual({ deleted: 1 })
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('does not create a list when nothing is cached', async () => {
  const client = createTestQueryClient()
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 0 })
  const { result } = renderHook(() => useClearCompletedMutation(), {
    wrapper: createWrapper(client),
  })
  result.current.mutate()
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})

it('keeps the cached tasks and exposes the error when clearing fails', async () => {
  const client = createTestQueryClient()
  const done: Todo = { ...todoFixture, id: 3, completed: true }
  client.setQueryData<Todo[]>(todoKeys.list, [done, todoFixture])
  vi.mocked(todosApi.clearCompleted).mockRejectedValue(
    new Error('The server is unavailable.'),
  )
  const { result } = renderHook(() => useClearCompletedMutation(), {
    wrapper: createWrapper(client),
  })
  result.current.mutate()
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.error?.message).toBe('The server is unavailable.')
  expect(client.getQueryData(todoKeys.list)).toEqual([done, todoFixture])
})

it('cancels an in-flight list refetch so stale data cannot bring completed tasks back', async () => {
  const client = createTestQueryClient()
  const done: Todo = { ...todoFixture, id: 3, completed: true }
  client.setQueryData<Todo[]>(todoKeys.list, [done, todoFixture])
  let resolveList!: (todos: Todo[]) => void
  vi.mocked(todosApi.list).mockImplementation(
    () => new Promise((resolve) => (resolveList = resolve)),
  )
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 1 })
  const { result } = renderHook(
    () => ({ list: useTodosQuery(), clear: useClearCompletedMutation() }),
    { wrapper: createWrapper(client) },
  )
  await waitFor(() => expect(result.current.list.isFetching).toBe(true))
  result.current.clear.mutate()
  await waitFor(() => expect(result.current.clear.isSuccess).toBe(true))
  resolveList([done, todoFixture])
  await waitFor(() => expect(result.current.list.isFetching).toBe(false))
  expect(result.current.list.data).toEqual([todoFixture])
})
