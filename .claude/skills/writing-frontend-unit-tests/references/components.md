# Component tests

Contents
1. What the design-system doubles render
2. Presentational component
3. Forms
4. Component with mocked hooks
5. Component with the real React Query hook
6. Container with child doubles
7. Dates in components
8. Design-system props: do not assert them
9. Providers (`AppProviders`)

All snippets below passed in a copy of `frontend/` with `TZ=UTC`, and the date cases also under other timezones.

## 1. What the design-system doubles render

Source: `frontend/src/design-system/mocks.tsx`. Each export is a `vi.fn(impl)`; `vi.clearAllMocks()` keeps those implementations. Design-only props (`variant`, `size`, `muted`, `label`, `error`, `options`, ...) are stripped before spreading onto the DOM (`mocks.tsx:24-48`), so they are not observable (section 8).

| Component | Renders | Query it with |
|---|---|---|
| `Alert` (l.64-66) | `<div data-testid="alert">`, **no role** | `getByTestId('alert')` + `toHaveTextContent` |
| `Drawer` (l.147-157) | nothing when closed; otherwise `<div role="dialog" aria-label={title}>` with a `Close` button that is `disabled` while `busy` | `getByRole('dialog', { name: 'Delete task?' })`, `getByRole('button', { name: 'Close' })` |
| `Button`, `IconButton` (l.74-80) | native `<button>` with `aria-label`, `disabled`, `onClick` | `getByRole('button', { name })` |
| `Input` (l.82-92) | `<label>{label}<input/textarea/>{error && <span>}</label>` | `getByLabelText(...)`, `getByRole('textbox', { name })`; the error as text |
| `Select` (l.94-106) | `<label>{label}<select><option/>...</select>{error}</label>` | `getByRole('combobox', { name })`, `user.selectOptions(el, 'To do')` (value or option text) |
| `Checkbox` (l.108-113) | `<label><input type="checkbox"/>{label}</label>` | `getByRole('checkbox', { name })` (name comes from `aria-label` when the label is empty) |
| `CheckboxGroup` (l.115-145) | `<fieldset><legend>` + one checkbox per option | `getByRole('group', { name })` |
| `Heading` (l.56-58) | `h{level}`, default `h1` | `getByRole('heading', { level, name })` |
| `Text` (l.60-62) | `<p>` or the `as` element; `role` passes through | `getByText`, `getByRole('status')` when `role="status"` |
| `Card`, `Badge`, `AppHeader` | `<div>`, `<span>`, `<header>` | through their text or `getByRole('banner')` |

Not reproduced by the doubles (do not assert): Alert's `role="alert"`/`"status"` (`Alert.tsx:8`), `aria-invalid` and `aria-describedby` on fields, Drawer focus management, Escape and backdrop handling.

## 2. Presentational component

Props in, DOM and callbacks out. Cover each branch of the JSX (`TodoEmptyState.tsx:15-30` has two):

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TodoEmptyState } from './TodoEmptyState'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('invites creating the first task when there are no tasks at all', async () => {
  const user = userEvent.setup()
  const onCreate = vi.fn()
  render(
    <TodoEmptyState hasTodos={false} disabled={false} onCreate={onCreate} />,
  )
  expect(
    screen.getByRole('heading', { level: 3, name: 'Add your first task' }),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Add your first task' }))
  expect(onCreate).toHaveBeenCalledTimes(1)
})

it('points to the filters instead of offering creation when tasks exist', () => {
  render(<TodoEmptyState hasTodos disabled={false} onCreate={vi.fn()} />)
  expect(
    screen.getByRole('heading', { name: 'No matching tasks' }),
  ).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
```

- For "disabled blocks the action", assert `toBeDisabled()` and that a click leaves the callback uncalled (`TodosHeader.test.tsx:21-24`).
- Use `rerender(<X {...props} loading={false} />)` to show a transition in one test (`TodoList.test.tsx:22-27`).

## 3. Forms

`user.type`, `user.clear`, `user.selectOptions` and `user.click` on the submit button. `type="date"` inputs accept `user.type(el, '2026-11-02')` and `user.clear(el)` in jsdom.

```tsx
it('prefills an existing task and submits a cleared due date as null', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  render(
    <TodoForm
      initial={{ ...todoFixture, due_date: '2026-11-02' }}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      busy={false}
      error={null}
    />,
  )
  const dueDate = screen.getByLabelText('Due date (optional)')
  expect(screen.getByLabelText(/Task title/)).toHaveValue(todoFixture.title)
  expect(dueDate).toHaveValue('2026-11-02')
  await user.clear(dueDate)
  await user.click(screen.getByRole('button', { name: 'Save task' }))
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ title: todoFixture.title, due_date: null }),
  )
})

it('disables the form and shows the server error while busy', () => {
  render(
    <TodoForm
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      busy
      error="Request body too large."
    />,
  )
  expect(screen.getByRole('group')).toBeDisabled()
  expect(screen.getByLabelText(/Task title/)).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'Request body too large.',
  )
})
```

- Validation: submit invalid input, assert the message from `utils/todos.ts` is visible and `onSubmit` was not called (`TodoForm.test.tsx:9-24`).
- Note: when `initial` is a full `Todo`, `TodoForm` passes `id`/`created_at` through to `onSubmit` (`TodoForm.tsx:27,36-40`); `todosApi` strips them. Test that contract at the API layer ([http-client](http-client.md)).

## 4. Component with mocked hooks

The repo default for components that call hooks. Mock each hook module, then return only the fields the component reads (`DeleteTodoDialog.test.tsx:9-20`, `TodoEditor.test.tsx:11-38`):

```tsx
vi.mock('../hooks/useDeleteTodoMutation', () => ({
  useDeleteTodoMutation: vi.fn(),
}))

vi.mocked(useDeleteTodoMutation).mockReturnValue({
  isPending: false,
  error: new Error('Could not delete.'),
  mutateAsync,
} as unknown as ReturnType<typeof useDeleteTodoMutation>)
```

- Successful path: `mutateAsync = vi.fn().mockResolvedValue(...)`, click, then `await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))` and `expect(mutateAsync).toHaveBeenCalledWith(todoFixture.id)`.
- Failure path: `mockRejectedValue(new Error(...))`; the callback stays uncalled and the dialog stays open.
- Guard path: `busy` or `isPending: true` -> buttons disabled and `mutateAsync` not called.
- Replace a heavy child with a trigger double when only its output matters (`TodoEditor.test.tsx:17-23` turns `TodoForm` into a button that calls `onSubmit(todoFixture)`).

## 5. Component with the real React Query hook

Use when the behaviour is the mutation's effect (pending lock, cache update, server error) and the owner test does not mock the hook module (SKILL.md section 4). `DeleteTodoDialog.test.tsx` already mocks its hook, so for `DeleteTodoDialog` itself add cases with hook doubles (section 4); the cases below show the shape for a component whose owner test is new. Mock `todosApi` and render inside `createWrapper` (helper code in SKILL.md section 7):

```tsx
vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))
beforeEach(() => vi.clearAllMocks())

function renderDialog() {
  const client = createTestQueryClient()
  client.setQueryData<Todo[]>(todoKeys.list, [todoFixture])
  const props = { onClose: vi.fn(), onDeleted: vi.fn() }
  render(<DeleteTodoDialog todo={todoFixture} busy={false} {...props} />, {
    wrapper: createWrapper(client),
  })
  return { client, ...props }
}

it('deletes the task, drops it from the cached list and reports success', async () => {
  const user = userEvent.setup()
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const { client, onDeleted } = renderDialog()
  await user.click(screen.getByRole('button', { name: 'Delete task' }))
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
  expect(todosApi.remove).toHaveBeenCalledWith(todoFixture.id)
  expect(client.getQueryData(todoKeys.list)).toEqual([])
})

it('locks the dialog while the deletion is pending', async () => {
  const user = userEvent.setup()
  let finish!: () => void
  vi.mocked(todosApi.remove).mockImplementation(
    () => new Promise<void>((resolve) => (finish = resolve)),
  )
  const { onDeleted } = renderDialog()
  await user.click(screen.getByRole('button', { name: 'Delete task' }))
  expect(
    await screen.findByRole('button', { name: 'Deleting…' }),
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
  finish()
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
})

it('keeps the dialog open with the server error when deletion fails', async () => {
  const user = userEvent.setup()
  vi.mocked(todosApi.remove).mockRejectedValue(new Error('Task not found.'))
  const { client, onDeleted } = renderDialog()
  await user.click(screen.getByRole('button', { name: 'Delete task' }))
  expect(await screen.findByTestId('alert')).toHaveTextContent(
    'Task not found.',
  )
  expect(screen.getByRole('dialog', { name: 'Delete task?' })).toBeVisible()
  expect(onDeleted).not.toHaveBeenCalled()
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
```

The pending test ends by resolving the deferred promise and awaiting the settled outcome, so no update lands after the test.

## 6. Container with child doubles

`TodosPage.test.tsx:11-28` mocks the design system, every hook and every child. To test wiring, make the child you inspect a `vi.fn` (keeping its JSX keeps existing assertions intact), read its props from `mock.lastCall`, and call the captured callback inside `act`. Excerpt (hook return values set as in `TodosPage.test.tsx:34-57`, with `visible: [todoFixture]`, `data: [todoFixture]`, `notify` as a `vi.fn` and `mutateAsync = vi.fn().mockResolvedValue({ ...todoFixture, completed: true })`):

```tsx
vi.mock('./components/TodoList', () => ({
  TodoList: vi.fn(() => <p>Task list</p>),
}))

render(<TodosPage />)
const listProps = vi.mocked(TodoList).mock.lastCall![0]
expect(listProps).toEqual(
  expect.objectContaining({
    todos: [todoFixture],
    hasTodos: true,
    loading: false,
  }),
)
act(() => listProps.onToggle(todoFixture))
await waitFor(() =>
  expect(notify).toHaveBeenCalledWith('Another task complete. Well done!'),
)
expect(mutateAsync).toHaveBeenCalledWith({
  id: 7,
  input: { completed: true },
})
```

## 7. Dates in components

`TodoItem` shows `' · overdue'` from `isOverdue` (local "today"). Fix the clock, fake only `Date`:

```tsx
afterEach(() => vi.useRealTimers())

it('marks a past due date as overdue', () => {
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
```

`handlers()` returns `{ onToggle: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() }`. Add the "due today is not overdue" case with `queryByText(/overdue/)`.

## 8. Design-system props: do not assert them

Reading `vi.mocked(Badge).mock.calls` or `vi.mocked(Alert).mock.calls` to check `variant`, `size` or `muted` tests how a component styles itself, not what a user perceives, and the double strips those props from the DOM. Instead:

- Assert the user-visible fact that goes with the prop: the `' · overdue'` text next to the warning badge (section 7), the heading level through `getByRole('heading', { level: 3 })`, the alert text through `getByTestId('alert')`.
- If the visual prop is the only signal of a changed behaviour (for example only an Alert `variant` changed), report a `not_unit_testable` finding rather than asserting the prop.
- `SuccessNotice.test.tsx:20-22` and `ApplicationHeader.test.tsx:17-23` are existing human tests that read DS props. Keep their assertions; do not extend the pattern.

Inspecting props of **feature child** doubles in container tests (section 6) is different: those props are the wiring under test.

## 9. Providers (`AppProviders`)

`AppProviders` renders the real `ThemeProvider` and `GlobalStyles`, which work in jsdom. Do not mock the design system here; check what children receive:

```tsx
function renderProviders(client?: QueryClient) {
  const seen: { client?: QueryClient; theme?: DefaultTheme } = {}
  function Probe() {
    seen.client = useQueryClient()
    seen.theme = useTheme()
    return <p>Child content</p>
  }
  render(
    <AppProviders client={client}>
      <Probe />
    </AppProviders>,
  )
  return seen
}

it('gives children the injected query client and the theme', () => {
  const client = createTestQueryClient()
  const seen = renderProviders(client)
  expect(screen.getByText('Child content')).toBeVisible()
  expect(seen.client).toBe(client)
  expect(seen.theme).toBe(theme)
})

it('falls back to the application query client', () => {
  expect(renderProviders().client).toBe(queryClient)
})
```

Imports: `type QueryClient, useQueryClient` from `@tanstack/react-query`, `type DefaultTheme, useTheme` from `styled-components`, `theme` from `../design-system`, `queryClient` from `../lib/queryClient` (only to compare identity).
