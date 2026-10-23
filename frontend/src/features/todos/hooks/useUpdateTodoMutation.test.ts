import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createTestQueryClient, createWrapper } from '../../../test/queryClient'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useTodosQuery } from './useTodosQuery'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))
beforeEach(() => vi.clearAllMocks())

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

it('leaves the cache untouched and exposes the error when updating fails', async () => {
  const client = createTestQueryClient()
  client.setQueryData<Todo[]>(todoKeys.list, [todoFixture])
  vi.mocked(todosApi.update).mockRejectedValue(new Error('Task not found.'))
  const { result } = renderHook(() => useUpdateTodoMutation(), {
    wrapper: createWrapper(client),
  })
  result.current.mutate({ id: 7, input: { completed: true } })
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.error?.message).toBe('Task not found.')
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('cancels an in-flight list refetch so stale data cannot overwrite the saved task', async () => {
  const client = createTestQueryClient()
  client.setQueryData<Todo[]>(todoKeys.list, [todoFixture])
  let resolveList!: (todos: Todo[]) => void
  vi.mocked(todosApi.list).mockImplementation(
    () => new Promise((resolve) => (resolveList = resolve)),
  )
  const saved: Todo = { ...todoFixture, completed: true }
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  const { result } = renderHook(
    () => ({ list: useTodosQuery(), update: useUpdateTodoMutation() }),
    { wrapper: createWrapper(client) },
  )
  await waitFor(() => expect(result.current.list.isFetching).toBe(true))
  result.current.update.mutate({ id: 7, input: { completed: true } })
  await waitFor(() => expect(result.current.update.isSuccess).toBe(true))
  resolveList([todoFixture])
  await waitFor(() => expect(result.current.list.isFetching).toBe(false))
  expect(result.current.list.data).toEqual([saved])
})
