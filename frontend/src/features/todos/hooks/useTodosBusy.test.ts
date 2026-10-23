import { useMutation } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createTestQueryClient, createWrapper } from '../../../test/queryClient'
import { todosApi } from '../api/todos'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'
import { useTodosBusy } from './useTodosBusy'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))
beforeEach(() => vi.clearAllMocks())

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
