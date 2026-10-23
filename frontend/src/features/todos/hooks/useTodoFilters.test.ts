import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { useTodoFilters } from './useTodoFilters'

const done: Todo = { ...todoFixture, id: 8, title: 'Ship it', completed: true }

it('starts with all tasks, no search and the newest sort', () => {
  const { result } = renderHook(() => useTodoFilters([todoFixture, done]))
  expect(result.current.filter).toBe('all')
  expect(result.current.search).toBe('')
  expect(result.current.sort).toBe('newest')
  expect(result.current.visible).toEqual([done, todoFixture])
})

it('narrows the visible tasks when the status filter changes', () => {
  const { result } = renderHook(() => useTodoFilters([todoFixture, done]))
  act(() => result.current.setFilter('completed'))
  expect(result.current.filter).toBe('completed')
  expect(result.current.visible).toEqual([done])
  act(() => result.current.setFilter('active'))
  expect(result.current.visible).toEqual([todoFixture])
})

it('reorders the visible tasks when the sort changes', () => {
  const high: Todo = { ...todoFixture, id: 3, priority: 'high' }
  const low: Todo = { ...todoFixture, id: 9, priority: 'low' }
  const { result } = renderHook(() => useTodoFilters([low, high]))
  expect(result.current.visible).toEqual([low, high])
  act(() => result.current.setSort('priority'))
  expect(result.current.sort).toBe('priority')
  expect(result.current.visible).toEqual([high, low])
})

it('recomputes the visible tasks when the search or the tasks change', () => {
  const { result, rerender } = renderHook(
    ({ todos }) => useTodoFilters(todos),
    { initialProps: { todos: [todoFixture] } },
  )
  act(() => result.current.setSearch('ship'))
  expect(result.current.search).toBe('ship')
  expect(result.current.visible).toEqual([])
  rerender({ todos: [todoFixture, done] })
  expect(result.current.visible).toEqual([done])
})
