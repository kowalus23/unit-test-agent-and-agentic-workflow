import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoEmptyState } from './TodoEmptyState'
import { TodoItem } from './TodoItem'
import { TodoList } from './TodoList'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('./TodoEmptyState', () => ({
  TodoEmptyState: vi.fn(() => <p>Empty task list</p>),
}))
vi.mock('./TodoItem', () => ({
  TodoItem: vi.fn(({ todo }: { todo: { title: string } }) => (
    <li>{todo.title}</li>
  )),
}))

beforeEach(() => vi.clearAllMocks())

function baseProps() {
  return {
    todos: [],
    hasTodos: false,
    loading: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
}

it('shows loading feedback before showing an empty list', () => {
  const props = {
    todos: [],
    hasTodos: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
  const { rerender } = render(<TodoList {...props} loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…')
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  rerender(<TodoList {...props} loading={false} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('Empty task list')).toBeVisible()
})

it('shows loading feedback even when a previous load failed', () => {
  render(<TodoList {...baseProps()} loading failed />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…')
  expect(
    screen.queryByText('The task list is temporarily unavailable'),
  ).not.toBeInTheDocument()
})

it('shows an unavailable message when loading failed and there are no tasks', () => {
  render(<TodoList {...baseProps()} failed />)
  expect(
    screen.getByRole('heading', {
      level: 3,
      name: 'The task list is temporarily unavailable',
    }),
  ).toBeVisible()
  expect(screen.getByText('Try again to load your tasks.')).toBeVisible()
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
})

it('keeps showing known tasks when a refresh failed', () => {
  render(<TodoList {...baseProps()} failed hasTodos todos={[todoFixture]} />)
  const list = screen.getByRole('region', { name: 'Task list' })
  expect(within(list).getByText(todoFixture.title)).toBeVisible()
  expect(
    screen.queryByText('The task list is temporarily unavailable'),
  ).not.toBeInTheDocument()
})

it('lists each task and calls handlers with that task', () => {
  const second = { ...todoFixture, id: 8, title: 'Write the report' }
  const props = baseProps()
  render(<TodoList {...props} hasTodos busy todos={[todoFixture, second]} />)
  expect(
    screen.getAllByRole('listitem').map((item) => item.textContent),
  ).toEqual([todoFixture.title, second.title])
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  const items = vi.mocked(TodoItem).mock.calls.map(([itemProps]) => itemProps)
  expect(items.map((item) => item.busy)).toEqual([true, true])
  act(() => {
    items[1].onToggle()
    items[1].onEdit()
    items[0].onDelete()
  })
  expect(props.onToggle).toHaveBeenCalledExactlyOnceWith(second)
  expect(props.onEdit).toHaveBeenCalledExactlyOnceWith(second)
  expect(props.onDelete).toHaveBeenCalledExactlyOnceWith(todoFixture)
})

it('passes the empty state whether tasks exist, its busy state and the create handler', () => {
  const props = baseProps()
  render(<TodoList {...props} hasTodos busy />)
  const emptyProps = vi.mocked(TodoEmptyState).mock.lastCall![0]
  expect(emptyProps.hasTodos).toBe(true)
  expect(emptyProps.disabled).toBe(true)
  act(() => emptyProps.onCreate())
  expect(props.onCreate).toHaveBeenCalledTimes(1)
})
