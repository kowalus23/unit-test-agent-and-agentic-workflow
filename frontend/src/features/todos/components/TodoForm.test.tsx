import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoForm } from './TodoForm'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

describe('TodoForm', () => {
  it('rejects a whitespace-only title without submitting', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '   ')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(screen.getByText('Enter a task title.')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits trimmed values and the selected priority', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '  Prepare a demo  ')
    await user.selectOptions(screen.getByLabelText('Priority'), 'high')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Prepare a demo',
      description: '',
      priority: 'high',
      due_date: null,
      completed: false,
    })
  })

  it('submits a trimmed description and a typed due date', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), 'Prepare a demo')
    await user.type(
      screen.getByLabelText('Description (optional)'),
      '  Book the room  ',
    )
    await user.type(screen.getByLabelText('Due date (optional)'), '2026-11-02')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Prepare a demo',
      description: 'Book the room',
      priority: 'medium',
      due_date: '2026-11-02',
      completed: false,
    })
  })

  it('prefills an existing task and submits a cleared due date as null', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        initial={{
          ...todoFixture,
          description: 'Book the room',
          priority: 'low',
          due_date: '2026-11-02',
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    const dueDate = screen.getByLabelText('Due date (optional)')
    expect(screen.getByLabelText(/Task title/)).toHaveValue(todoFixture.title)
    expect(screen.getByLabelText('Description (optional)')).toHaveValue(
      'Book the room',
    )
    expect(screen.getByLabelText('Priority')).toHaveValue('low')
    expect(dueDate).toHaveValue('2026-11-02')
    await user.clear(dueDate)
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: todoFixture.title,
        description: 'Book the room',
        priority: 'low',
        due_date: null,
      }),
    )
  })

  it.each([
    ['title', /Task title/, 121, 'The title must be at most 120 characters.'],
    [
      'description',
      'Description (optional)',
      2001,
      'The description must be at most 2000 characters.',
    ],
  ])(
    'shows a message and does not submit when the %s is too long',
    async (_field, label, length, message) => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()
      render(
        <TodoForm
          initial={{ ...todoFixture, title: 'Prepare a demo' }}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          busy={false}
          error={null}
        />,
      )
      const field = screen.getByLabelText(label)
      await user.clear(field)
      await user.click(field)
      await user.paste('a'.repeat(length))
      await user.click(screen.getByRole('button', { name: 'Save task' }))
      expect(screen.getByText(message)).toBeVisible()
      expect(onSubmit).not.toHaveBeenCalled()
    },
  )

  it('clears a validation message once the input becomes valid', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(screen.getByText('Enter a task title.')).toBeVisible()
    await user.type(screen.getByLabelText(/Task title/), 'Prepare a demo')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(screen.queryByText('Enter a task title.')).not.toBeInTheDocument()
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('cancels without submitting', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={onCancel}
        busy={false}
        error={null}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows the server error only when there is one', () => {
    const props = { onSubmit: vi.fn(), onCancel: vi.fn(), busy: false }
    const { rerender } = render(<TodoForm {...props} error={null} />)
    expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
    rerender(<TodoForm {...props} error="Request body too large." />)
    expect(screen.getByTestId('alert')).toHaveTextContent(
      'Request body too large.',
    )
  })

  it('disables the form and shows the saving state while busy', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(
      <TodoForm onSubmit={onSubmit} onCancel={onCancel} busy error={null} />,
    )
    expect(screen.getByRole('group')).toBeDisabled()
    expect(screen.getByLabelText(/Task title/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save task' })).toBeNull()
    const saving = screen.getByRole('button', { name: 'Saving…' })
    expect(saving).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.click(saving)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })
})
