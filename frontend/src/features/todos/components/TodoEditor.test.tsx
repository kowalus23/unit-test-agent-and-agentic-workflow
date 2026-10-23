import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useCreateTodoMutation } from '../hooks/useCreateTodoMutation'
import { useUpdateTodoMutation } from '../hooks/useUpdateTodoMutation'
import type { TodoInput } from '../types'
import { TodoEditor } from './TodoEditor'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useCreateTodoMutation', () => ({
  useCreateTodoMutation: vi.fn(),
}))
vi.mock('../hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./TodoForm', () => ({
  TodoForm: ({
    onSubmit,
    initial,
    error,
  }: {
    onSubmit: (input: TodoInput) => Promise<void>
    initial?: TodoInput
    error: string | null
  }) => (
    <>
      <button onClick={() => void onSubmit(todoFixture)}>Submit form</button>
      <p>{initial ? `Editing ${initial.title}` : 'Blank form'}</p>
      {error && <p>{`Form error: ${error}`}</p>}
    </>
  ),
}))

beforeEach(() => vi.clearAllMocks())

it('creates a new task and reports a successful save', async () => {
  const user = userEvent.setup()
  const create = vi.fn().mockResolvedValue(todoFixture)
  const update = vi.fn()
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: create,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: update,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={onSaved} />,
  )
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('New task added.'))
  expect(create).toHaveBeenCalledWith(todoFixture)
  expect(update).not.toHaveBeenCalled()
})

function mockMutations({
  create = vi.fn(),
  update = vi.fn(),
  createPending = false,
  updatePending = false,
}: {
  create?: ReturnType<typeof vi.fn>
  update?: ReturnType<typeof vi.fn>
  createPending?: boolean
  updatePending?: boolean
} = {}) {
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: createPending,
    error: null,
    mutateAsync: create,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: updatePending,
    error: null,
    mutateAsync: update,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  return { create, update }
}

it('updates an existing task and reports the saved changes', async () => {
  const user = userEvent.setup()
  const { create, update } = mockMutations({
    update: vi.fn().mockResolvedValue(todoFixture),
  })
  const onSaved = vi.fn()
  render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Changes saved.'))
  expect(update).toHaveBeenCalledWith({
    id: todoFixture.id,
    input: todoFixture,
  })
  expect(create).not.toHaveBeenCalled()
})

it('does not report a save when the mutation fails', async () => {
  const user = userEvent.setup()
  const { create } = mockMutations({
    create: vi.fn().mockRejectedValue(new Error('Could not save.')),
  })
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={onSaved} />,
  )
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  expect(onSaved).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
})

it('prefills the form only for an existing task', () => {
  mockMutations()
  const props = { busy: false, onClose: vi.fn(), onSaved: vi.fn() }
  const { rerender } = render(<TodoEditor todo="new" {...props} />)
  expect(screen.getByText('Blank form')).toBeVisible()
  rerender(<TodoEditor todo={todoFixture} {...props} />)
  expect(screen.getByText(`Editing ${todoFixture.title}`)).toBeVisible()
})

it('shows the error of the mutation that belongs to the edited task', () => {
  mockMutations()
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: new Error('Create failed.'),
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: new Error('Update failed.'),
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  const props = { busy: false, onClose: vi.fn(), onSaved: vi.fn() }
  const { rerender } = render(<TodoEditor todo="new" {...props} />)
  expect(screen.getByText('Form error: Create failed.')).toBeVisible()
  rerender(<TodoEditor todo={todoFixture} {...props} />)
  expect(screen.getByText('Form error: Update failed.')).toBeVisible()
})

it('does not save while the page is busy', async () => {
  const user = userEvent.setup()
  const { create } = mockMutations()
  const onSaved = vi.fn()
  render(<TodoEditor todo="new" busy onClose={vi.fn()} onSaved={onSaved} />)
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  expect(create).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
})

it('does not save a new task while the create mutation is pending', async () => {
  const user = userEvent.setup()
  const { create } = mockMutations({ createPending: true })
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={onSaved} />,
  )
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  expect(create).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
})

it('ignores a pending create mutation when editing an existing task', async () => {
  const user = userEvent.setup()
  const { update } = mockMutations({
    createPending: true,
    update: vi.fn().mockResolvedValue(todoFixture),
  })
  const onSaved = vi.fn()
  render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Changes saved.'))
  expect(update).toHaveBeenCalledTimes(1)
})
