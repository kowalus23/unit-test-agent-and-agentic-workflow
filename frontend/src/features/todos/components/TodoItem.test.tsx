import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('shows an active task and forwards edit requests', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={onEdit}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByRole('heading', { name: todoFixture.title })).toBeVisible()
  expect(screen.getByText('To do')).toBeVisible()
  expect(screen.getByText('Medium')).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  )
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onToggle).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

afterEach(() => vi.useRealTimers())

function handlers() {
  return { onToggle: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() }
}

it('shows a completed task and forwards toggle requests to mark it active', async () => {
  const user = userEvent.setup()
  const completed = {
    ...todoFixture,
    completed: true,
    priority: 'high' as const,
  }
  const props = handlers()
  render(<TodoItem todo={completed} busy={false} {...props} />)
  expect(screen.getByText('Completed')).toBeVisible()
  expect(screen.queryByText('To do')).not.toBeInTheDocument()
  expect(screen.getByText('High')).toBeVisible()
  expect(screen.getByText(`#${completed.id}`)).toBeVisible()
  const checkbox = screen.getByRole('checkbox', {
    name: `Mark as active: ${completed.title}`,
  })
  expect(checkbox).toBeChecked()
  await user.click(checkbox)
  expect(props.onToggle).toHaveBeenCalledTimes(1)
  expect(props.onEdit).not.toHaveBeenCalled()
  expect(props.onDelete).not.toHaveBeenCalled()
})

it('offers to complete an active task through its checkbox label', () => {
  render(<TodoItem todo={todoFixture} busy={false} {...handlers()} />)
  expect(
    screen.getByRole('checkbox', { name: `Complete: ${todoFixture.title}` }),
  ).not.toBeChecked()
})

it('forwards delete requests', async () => {
  const user = userEvent.setup()
  const props = handlers()
  render(<TodoItem todo={todoFixture} busy={false} {...props} />)
  await user.click(
    screen.getByRole('button', { name: `Delete: ${todoFixture.title}` }),
  )
  expect(props.onDelete).toHaveBeenCalledTimes(1)
  expect(props.onEdit).not.toHaveBeenCalled()
  expect(props.onToggle).not.toHaveBeenCalled()
})

it('shows the description only when the task has one', () => {
  const props = handlers()
  const { rerender } = render(
    <TodoItem todo={todoFixture} busy={false} {...props} />,
  )
  expect(screen.queryByText('Book the room')).not.toBeInTheDocument()
  rerender(
    <TodoItem
      todo={{ ...todoFixture, description: 'Book the room' }}
      busy={false}
      {...props}
    />,
  )
  expect(screen.getByText('Book the room')).toBeVisible()
})

it('disables every control and ignores clicks while busy', async () => {
  const user = userEvent.setup()
  const props = handlers()
  render(<TodoItem todo={todoFixture} busy {...props} />)
  const controls = [
    screen.getByRole('checkbox'),
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
    screen.getByRole('button', { name: `Delete: ${todoFixture.title}` }),
  ]
  for (const control of controls) {
    expect(control).toBeDisabled()
    await user.click(control)
  }
  expect(props.onToggle).not.toHaveBeenCalled()
  expect(props.onEdit).not.toHaveBeenCalled()
  expect(props.onDelete).not.toHaveBeenCalled()
})

it('shows no due date badge for a task without a due date', () => {
  render(<TodoItem todo={todoFixture} busy={false} {...handlers()} />)
  expect(screen.queryByText(/20\d\d/)).not.toBeInTheDocument()
})

it('marks a past due date of an active task as overdue', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
  render(
    <TodoItem
      todo={{ ...todoFixture, due_date: '2026-10-22' }}
      busy={false}
      {...handlers()}
    />,
  )
  expect(screen.getByText(/22 Oct 2026/)).toHaveTextContent(
    '22 Oct 2026 · overdue',
  )
})

it('does not mark a task due today as overdue', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
  render(
    <TodoItem
      todo={{ ...todoFixture, due_date: '2026-10-23' }}
      busy={false}
      {...handlers()}
    />,
  )
  expect(screen.getByText(/23 Oct 2026/)).toBeVisible()
  expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
})

it('does not mark a completed task with a past due date as overdue', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
  render(
    <TodoItem
      todo={{ ...todoFixture, completed: true, due_date: '2026-10-22' }}
      busy={false}
      {...handlers()}
    />,
  )
  expect(screen.getByText(/22 Oct 2026/)).toBeVisible()
  expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
})
