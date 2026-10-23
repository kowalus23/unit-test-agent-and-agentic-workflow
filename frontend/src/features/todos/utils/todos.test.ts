import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDate, isOverdue, selectTodos, validateTodo } from './todos'
import type { Todo, TodoInput } from '../types'

afterEach(() => vi.useRealTimers())

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })

  it('breaks priority ties by newest id first', () => {
    const older: Todo = { ...base, id: 2, priority: 'low' }
    const newer: Todo = { ...base, id: 5, priority: 'low' }
    const high: Todo = { ...base, id: 1, priority: 'high' }
    expect(selectTodos([older, newer, high], 'all', '', 'priority')).toEqual([
      high,
      newer,
      older,
    ])
  })

  it('puts tasks without a due date last when sorting by due date', () => {
    const noDate: Todo = { ...base, id: 1 }
    const later: Todo = { ...base, id: 2, due_date: '2026-12-01' }
    const sooner: Todo = { ...base, id: 3, due_date: '2026-11-01' }
    expect(selectTodos([noDate, later, sooner], 'all', '', 'due')).toEqual([
      sooner,
      later,
      noDate,
    ])
  })

  it('breaks due date ties by newest id first', () => {
    const first: Todo = { ...base, id: 1, due_date: '2026-11-01' }
    const second: Todo = { ...base, id: 2, due_date: '2026-11-01' }
    expect(selectTodos([first, second], 'all', '', 'due')).toEqual([
      second,
      first,
    ])
  })

  it('keeps tasks without a due date last and orders them by newest id when sorting by due date', () => {
    const dated: Todo = { ...base, id: 1, due_date: '2026-11-01' }
    const undatedOld: Todo = { ...base, id: 2 }
    const undatedNew: Todo = { ...base, id: 3 }
    expect(
      selectTodos([undatedOld, undatedNew, dated], 'all', '', 'due'),
    ).toEqual([dated, undatedNew, undatedOld])
    expect(
      selectTodos([dated, undatedOld, undatedNew], 'all', '', 'due'),
    ).toEqual([dated, undatedNew, undatedOld])
  })

  it('sorts newest by creation time and breaks ties by id', () => {
    const oldest: Todo = { ...base, id: 9, created_at: '2026-09-01T12:00:00Z' }
    const newest: Todo = { ...base, id: 1, created_at: '2026-10-05T12:00:00Z' }
    const tieA: Todo = { ...base, id: 2 }
    const tieB: Todo = { ...base, id: 3 }
    expect(
      selectTodos([oldest, tieA, newest, tieB], 'all', '', 'newest'),
    ).toEqual([newest, tieB, tieA, oldest])
  })

  it('keeps only completed tasks for the completed filter and matches titles', () => {
    const done: Todo = { ...base, id: 2, completed: true }
    const otherDone: Todo = {
      ...base,
      id: 3,
      title: 'Retro',
      completed: true,
    }
    expect(
      selectTodos([base, done, otherDone], 'completed', 'SPRINT', 'newest'),
    ).toEqual([done])
  })

  it('returns an empty list when nothing matches the search', () => {
    expect(selectTodos([base], 'all', 'missing', 'newest')).toEqual([])
  })
})

const valid: TodoInput = {
  title: 'Prepare a demo',
  description: '',
  priority: 'medium',
  due_date: null,
  completed: false,
}

describe('validateTodo', () => {
  it.each([
    ['an empty title', { title: '' }, { title: 'Enter a task title.' }],
    [
      'a whitespace-only title',
      { title: '   ' },
      { title: 'Enter a task title.' },
    ],
    [
      'a 121-character title',
      { title: 'a'.repeat(121) },
      { title: 'The title must be at most 120 characters.' },
    ],
    [
      'a 2001-character description',
      { description: 'a'.repeat(2001) },
      { description: 'The description must be at most 2000 characters.' },
    ],
    [
      'a non-ISO date',
      { due_date: '2026-1-5' },
      { due_date: 'Enter a valid date.' },
    ],
    [
      'an impossible date',
      { due_date: '2026-02-30' },
      { due_date: 'Enter a valid date.' },
    ],
    [
      'a non-leap-year February 29',
      { due_date: '2025-02-29' },
      { due_date: 'Enter a valid date.' },
    ],
    [
      'a date with trailing text',
      { due_date: '2026-10-05x' },
      { due_date: 'Enter a valid date.' },
    ],
  ])('rejects %s', (_case, change, errors) => {
    expect(validateTodo({ ...valid, ...change })).toEqual(errors)
  })

  it('reports every invalid field at once', () => {
    expect(
      validateTodo({
        ...valid,
        title: ' ',
        description: 'a'.repeat(2001),
        due_date: 'tomorrow',
      }),
    ).toEqual({
      title: 'Enter a task title.',
      description: 'The description must be at most 2000 characters.',
      due_date: 'Enter a valid date.',
    })
  })

  it.each([
    [
      'a 120-character title padded with spaces',
      { title: ` ${'a'.repeat(120)} ` },
    ],
    ['a 2000-character description', { description: 'a'.repeat(2000) }],
    ['a leap day', { due_date: '2028-02-29' }],
    ['no due date', { due_date: null }],
  ])('accepts %s', (_case, change) => {
    expect(validateTodo({ ...valid, ...change })).toEqual({})
  })
})

describe('isOverdue', () => {
  it.each([
    [true, 'due yesterday', { due_date: '2026-10-22' }],
    [false, 'due today', { due_date: '2026-10-23' }],
    [false, 'due tomorrow', { due_date: '2026-10-24' }],
    [false, 'without a due date', { due_date: null }],
    [
      false,
      'completed after its due date',
      { due_date: '2026-10-22', completed: true },
    ],
  ])('returns %s for a task %s', (expected, _case, change) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
    expect(isOverdue({ ...base, ...change })).toBe(expected)
  })
})

describe('formatDate', () => {
  it.each([
    ['2026-10-01', '1 Oct 2026'],
    ['2028-02-29', '29 Feb 2028'],
    ['2026-12-31', '31 Dec 2026'],
  ])('formats %s as %s', (date, expected) => {
    expect(formatDate(date)).toBe(expected)
  })
})
