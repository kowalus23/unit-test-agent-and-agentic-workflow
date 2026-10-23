import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createTestQueryClient, createWrapper } from '../../../test/queryClient'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'
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

it('does not create a list when nothing is cached', async () => {
  const client = createTestQueryClient()
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const { result } = renderHook(() => useDeleteTodoMutation(), {
    wrapper: createWrapper(client),
  })
  result.current.mutate(7)
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})

it('keeps the task in the cache and exposes the error when deleting fails', async () => {
  const client = createTestQueryClient()
  client.setQueryData<Todo[]>(todoKeys.list, [todoFixture])
  vi.mocked(todosApi.remove).mockRejectedValue(new Error('Task not found.'))
  const { result } = renderHook(() => useDeleteTodoMutation(), {
    wrapper: createWrapper(client),
  })
  result.current.mutate(7)
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.error?.message).toBe('Task not found.')
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('cancels an in-flight list refetch so stale data cannot bring the task back', async () => {
  const client = createTestQueryClient()
  client.setQueryData<Todo[]>(todoKeys.list, [todoFixture])
  let resolveList!: (todos: Todo[]) => void
  vi.mocked(todosApi.list).mockImplementation(
    () => new Promise((resolve) => (resolveList = resolve)),
  )
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const { result } = renderHook(
    () => ({ list: useTodosQuery(), remove: useDeleteTodoMutation() }),
    { wrapper: createWrapper(client) },
  )
  await waitFor(() => expect(result.current.list.isFetching).toBe(true))
  result.current.remove.mutate(7)
  await waitFor(() => expect(result.current.remove.isSuccess).toBe(true))
  resolveList([todoFixture])
  await waitFor(() => expect(result.current.list.isFetching).toBe(false))
  expect(result.current.list.data).toEqual([])
})
