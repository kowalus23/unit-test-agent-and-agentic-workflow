import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { useNotice } from '../../hooks/useNotice'
import { todoFixture } from '../../test/todoFixture'
import { ClearCompletedDialog } from './components/ClearCompletedDialog'
import { DeleteTodoDialog } from './components/DeleteTodoDialog'
import { TodoEditor } from './components/TodoEditor'
import { TodoList } from './components/TodoList'
import { TodosHeader } from './components/TodosHeader'
import type { Todo } from './types'
import { useTodoFilters } from './hooks/useTodoFilters'
import { useTodosBusy } from './hooks/useTodosBusy'
import { useTodosQuery } from './hooks/useTodosQuery'
import { useUpdateTodoMutation } from './hooks/useUpdateTodoMutation'
import { TodosPage } from './TodosPage'

vi.mock('../../design-system', () => import('../../design-system/mocks'))
vi.mock('../../hooks/useNotice', () => ({ useNotice: vi.fn() }))
vi.mock('./hooks/useTodoFilters', () => ({ useTodoFilters: vi.fn() }))
vi.mock('./hooks/useTodosBusy', () => ({ useTodosBusy: vi.fn() }))
vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
vi.mock('./hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./components/TodosHeader', () => ({
  TodosHeader: vi.fn(() => <h1>Tasks</h1>),
}))
vi.mock('./components/TodoFilters', () => ({ TodoFilters: () => null }))
vi.mock('./components/TodoList', () => ({
  TodoList: vi.fn(() => <p>Task list</p>),
}))
vi.mock('./components/TodoEditor', () => ({
  TodoEditor: vi.fn(() => <p>Editor open</p>),
}))
vi.mock('./components/DeleteTodoDialog', () => ({
  DeleteTodoDialog: vi.fn(() => <p>Delete dialog open</p>),
}))
vi.mock('./components/ClearCompletedDialog', () => ({
  ClearCompletedDialog: vi.fn(() => <p>Clear dialog open</p>),
}))
vi.mock('../../components/SuccessNotice', () => ({ SuccessNotice: () => null }))

beforeEach(() => vi.clearAllMocks())

const savedTodo = { ...todoFixture, completed: true }

function setup({
  busy = false,
  isPending = false,
  isFetching = false,
  isError = false,
  queryError = null,
  mutationError = null,
  data = [todoFixture],
  mutateAsync = vi.fn().mockResolvedValue(savedTodo),
}: {
  busy?: boolean
  isPending?: boolean
  isFetching?: boolean
  isError?: boolean
  queryError?: Error | null
  mutationError?: Error | null
  data?: Todo[]
  mutateAsync?: ReturnType<typeof vi.fn>
} = {}) {
  const refetch = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn()
  const notify = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue({
    data,
    isPending,
    isFetching,
    isError,
    error: queryError,
    refetch,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: mutationError,
    reset,
    mutateAsync,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(busy)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: data,
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  return { refetch, reset, notify, mutateAsync }
}

const listProps = () => vi.mocked(TodoList).mock.lastCall![0]
const editorProps = () => vi.mocked(TodoEditor).mock.lastCall![0]
const deleteProps = () => vi.mocked(DeleteTodoDialog).mock.lastCall![0]
const clearProps = () => vi.mocked(ClearCompletedDialog).mock.lastCall![0]
const completedTodo = { ...todoFixture, id: 8, completed: true }

it('displays a query failure and resets mutation errors before retrying', async () => {
  const user = userEvent.setup()
  const refetch = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [],
    isPending: false,
    isFetching: false,
    isError: true,
    error: new Error('The server is unavailable.'),
    refetch,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(false)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify: vi.fn() })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'The server is unavailable.',
  )
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
    refetch.mock.invocationCallOrder[0],
  )
})

it('passes the query state and known tasks to the task list', () => {
  setup({ isPending: true, isError: true, data: [] })
  const { rerender } = render(<TodosPage />)
  expect(listProps()).toEqual(
    expect.objectContaining({
      todos: [],
      hasTodos: false,
      loading: true,
      failed: true,
      busy: false,
    }),
  )
  setup({ data: [todoFixture] })
  rerender(<TodosPage />)
  expect(listProps()).toEqual(
    expect.objectContaining({
      todos: [todoFixture],
      hasTodos: true,
      loading: false,
      failed: false,
    }),
  )
})

it('treats a query without data as an empty task list', () => {
  setup({ isPending: true })
  vi.mocked(useTodosQuery).mockReturnValue({
    data: undefined,
    isPending: true,
    isFetching: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useTodosQuery>)
  render(<TodosPage />)
  expect(vi.mocked(useTodoFilters)).toHaveBeenCalledWith([])
  expect(listProps()).toEqual(
    expect.objectContaining({ hasTodos: false, loading: true }),
  )
})

it.each([
  ['the list is loading', { isPending: true }, true, false],
  ['the page is busy', { busy: true }, true, true],
  ['the page is idle', {}, false, false],
])(
  'sets the create control and the list busy state when %s',
  (_name, state, headerDisabled, listBusy) => {
    setup(state)
    render(<TodosPage />)
    expect(vi.mocked(TodosHeader).mock.lastCall![0].disabled).toBe(
      headerDisabled,
    )
    expect(listProps().busy).toBe(listBusy)
  },
)

it('hides the alert when neither the query nor the mutation failed', () => {
  setup()
  render(<TodosPage />)
  expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
})

it('prefers the mutation error over the query error in the alert', () => {
  setup({
    queryError: new Error('The server is unavailable.'),
    mutationError: new Error('Could not update the task.'),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'Could not update the task.',
  )
  expect(screen.getByTestId('alert')).not.toHaveTextContent(
    'The server is unavailable.',
  )
})

it.each([
  ['a refetch is running', { isFetching: true }],
  ['the page is busy', { busy: true }],
])('disables retrying while %s', async (_name, state) => {
  const user = userEvent.setup()
  const { refetch, reset } = setup({
    queryError: new Error('The server is unavailable.'),
    ...state,
  })
  render(<TodosPage />)
  const retry = screen.getByRole('button', { name: 'Try again' })
  expect(retry).toBeDisabled()
  await user.click(retry)
  expect(refetch).not.toHaveBeenCalled()
  expect(reset).not.toHaveBeenCalled()
})

it.each([
  [
    'completes an active task',
    todoFixture,
    'Another task complete. Well done!',
  ],
  [
    'reactivates a completed task',
    { ...todoFixture, completed: true },
    'Task marked as active.',
  ],
])('%s and announces the result', async (_name, todo, message) => {
  const mutateAsync = vi
    .fn()
    .mockResolvedValue({ ...todo, completed: !todo.completed })
  const { notify } = setup({ data: [todo], mutateAsync })
  render(<TodosPage />)
  act(() => listProps().onToggle(todo))
  await waitFor(() => expect(notify).toHaveBeenCalledWith(message))
  expect(mutateAsync).toHaveBeenCalledWith({
    id: todo.id,
    input: { completed: !todo.completed },
  })
})

it('does not toggle a task while the page is busy', async () => {
  const { mutateAsync, notify } = setup({ busy: true })
  render(<TodosPage />)
  act(() => listProps().onToggle(todoFixture))
  await act(async () => {})
  expect(mutateAsync).not.toHaveBeenCalled()
  expect(notify).not.toHaveBeenCalled()
})

it('does not announce success when toggling a task fails', async () => {
  const mutateAsync = vi.fn().mockRejectedValue(new Error('Could not update.'))
  const { notify } = setup({ mutateAsync })
  render(<TodosPage />)
  act(() => listProps().onToggle(todoFixture))
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
  expect(notify).not.toHaveBeenCalled()
})

it('opens the editor for a new task from the header and closes it on cancel', () => {
  setup()
  render(<TodosPage />)
  expect(screen.queryByText('Editor open')).not.toBeInTheDocument()
  act(() => vi.mocked(TodosHeader).mock.lastCall![0].onCreate())
  expect(screen.getByText('Editor open')).toBeVisible()
  expect(editorProps().todo).toBe('new')
  act(() => editorProps().onClose())
  expect(screen.queryByText('Editor open')).not.toBeInTheDocument()
})

it('opens the editor for a new task from the empty list', () => {
  setup()
  render(<TodosPage />)
  act(() => listProps().onCreate())
  expect(editorProps().todo).toBe('new')
})

it('opens the editor for the task chosen in the list', () => {
  setup({ busy: true })
  render(<TodosPage />)
  act(() => listProps().onEdit(todoFixture))
  expect(editorProps().todo).toBe(todoFixture)
  expect(editorProps().busy).toBe(true)
})

it('closes the editor and announces the message once a task is saved', () => {
  const { notify } = setup()
  render(<TodosPage />)
  act(() => listProps().onEdit(todoFixture))
  act(() => editorProps().onSaved('Changes saved.'))
  expect(screen.queryByText('Editor open')).not.toBeInTheDocument()
  expect(notify).toHaveBeenCalledWith('Changes saved.')
})

it('asks for confirmation before deleting and closes the dialog on cancel', () => {
  const { notify } = setup({ busy: true })
  render(<TodosPage />)
  expect(screen.queryByText('Delete dialog open')).not.toBeInTheDocument()
  act(() => listProps().onDelete(todoFixture))
  expect(screen.getByText('Delete dialog open')).toBeVisible()
  expect(deleteProps().todo).toBe(todoFixture)
  expect(deleteProps().busy).toBe(true)
  act(() => deleteProps().onClose())
  expect(screen.queryByText('Delete dialog open')).not.toBeInTheDocument()
  expect(notify).not.toHaveBeenCalled()
})

it('closes the dialog and announces the deletion once the task is deleted', () => {
  const { notify } = setup()
  render(<TodosPage />)
  act(() => listProps().onDelete(todoFixture))
  act(() => deleteProps().onDeleted())
  expect(screen.queryByText('Delete dialog open')).not.toBeInTheDocument()
  expect(notify).toHaveBeenCalledWith('Task deleted.')
})

it('offers to clear completed tasks only when there are some', () => {
  setup({ data: [todoFixture] })
  const { rerender } = render(<TodosPage />)
  expect(
    screen.queryByRole('button', { name: /Clear completed/ }),
  ).not.toBeInTheDocument()
  setup({ data: [todoFixture, completedTodo, { ...completedTodo, id: 9 }] })
  rerender(<TodosPage />)
  expect(
    screen.getByRole('button', { name: 'Clear completed (2)' }),
  ).toBeEnabled()
})

it('disables the clear completed control while the page is busy', async () => {
  const user = userEvent.setup()
  setup({ data: [completedTodo], busy: true })
  render(<TodosPage />)
  const button = screen.getByRole('button', { name: 'Clear completed (1)' })
  expect(button).toBeDisabled()
  await user.click(button)
  expect(screen.queryByText('Clear dialog open')).not.toBeInTheDocument()
})

it('asks for confirmation before clearing and closes the dialog on cancel', async () => {
  const user = userEvent.setup()
  const { notify } = setup({
    data: [todoFixture, completedTodo, { ...completedTodo, id: 9 }],
  })
  render(<TodosPage />)
  expect(screen.queryByText('Clear dialog open')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Clear completed (2)' }))
  expect(screen.getByText('Clear dialog open')).toBeVisible()
  expect(clearProps().count).toBe(2)
  expect(clearProps().busy).toBe(false)
  act(() => clearProps().onClose())
  expect(screen.queryByText('Clear dialog open')).not.toBeInTheDocument()
  expect(notify).not.toHaveBeenCalled()
})

it.each([
  [1, 'Cleared 1 completed task.'],
  [3, 'Cleared 3 completed tasks.'],
  [0, 'Cleared 0 completed tasks.'],
])(
  'closes the dialog and announces the result when %i tasks were cleared',
  async (deleted, message) => {
    const user = userEvent.setup()
    const { notify } = setup({ data: [completedTodo], busy: false })
    render(<TodosPage />)
    await user.click(
      screen.getByRole('button', { name: 'Clear completed (1)' }),
    )
    act(() => clearProps().onCleared(deleted))
    expect(screen.queryByText('Clear dialog open')).not.toBeInTheDocument()
    expect(notify).toHaveBeenCalledWith(message)
  },
)
