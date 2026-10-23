import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createTestQueryClient, createWrapper } from '../../../test/queryClient'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
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

it('loads tasks with the abort signal provided by the query', async () => {
  vi.mocked(todosApi.list).mockResolvedValue([todoFixture])
  const client = createTestQueryClient()
  const { result } = renderHook(() => useTodosQuery(), {
    wrapper: createWrapper(client),
  })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(result.current.data).toEqual([todoFixture])
  expect(todosApi.list).toHaveBeenCalledWith(expect.any(AbortSignal))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
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
