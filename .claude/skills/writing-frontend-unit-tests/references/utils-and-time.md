# Pure functions, dates and timers

Contents
1. Pure functions with `it.each`
2. Sorting and filtering (`selectTodos`)
3. Fixed "now" for date logic
4. Timers
5. Timers together with user interaction

All snippets below passed in a copy of `frontend/` under `TZ=UTC`, `Europe/Warsaw`, `America/Los_Angeles` and `Asia/Tokyo`.

## 1. Pure functions with `it.each`

`frontend/src/features/todos/utils/todos.ts` has no dependencies: no mocks, direct calls, exact results. Owner test: `utils/todos.test.ts`, which groups by function with `describe` and builds variants from a local `base: Todo` (l.5-14). Reuse what the file already has.

Put boundary values in a table with a readable label as the first column, and include both sides of each limit:

```ts
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
  ])('rejects %s', (_case, change, errors) => {
    expect(validateTodo({ ...valid, ...change })).toEqual(errors)
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
```

- Expected messages come from the source copy (`todos.ts:8-21`); the limits mirror the backend validators. `toEqual(errors)` on the whole object also proves that no other field reported an error.
- One table per outcome (rejects / accepts) keeps each row's assertion identical; a table whose rows need different assertions should be separate tests.

## 2. Sorting and filtering (`selectTodos`)

Build a small list whose expected order is unambiguous, and cover each sort mode and tie-breaker in the source (`todos.ts:45-56`: `priority` high first, `due` with missing dates last, `newest` by `created_at` descending; ties by id descending in every mode):

```ts
describe('selectTodos', () => {
  it('puts tasks without a due date last when sorting by due date', () => {
    const noDate: Todo = { ...todoFixture, id: 1 }
    const later: Todo = { ...todoFixture, id: 2, due_date: '2026-12-01' }
    const sooner: Todo = { ...todoFixture, id: 3, due_date: '2026-11-01' }
    expect(selectTodos([noDate, later, sooner], 'all', '', 'due')).toEqual([
      sooner,
      later,
      noDate,
    ])
  })
})
```

The existing test also proves the input array is not mutated (`utils/todos.test.ts:27-32`); keep that check style for new sort modes.

## 3. Fixed "now" for date logic

`isOverdue` compares the due date with the **local** calendar date of `new Date()` (`todos.ts:59-63`); `formatDate` formats `en-GB` at local noon (`todos.ts:65-71`). Fake only `Date` inside the test, pin the clock at midday UTC (the local date is then the same in every common timezone), and restore with a file-level `afterEach` rather than nested setup hooks:

```ts
afterEach(() => vi.useRealTimers())

describe('isOverdue', () => {
  it.each([
    [true, 'due yesterday', { due_date: '2026-10-22' }],
    [false, 'due today', { due_date: '2026-10-23' }],
    [false, 'without a due date', { due_date: null }],
    [
      false,
      'completed after its due date',
      { due_date: '2026-10-22', completed: true },
    ],
  ])('returns %s for a task %s', (expected, _case, change) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
    expect(isOverdue({ ...todoFixture, ...change })).toBe(expected)
  })
})

it('formats an ISO date for display', () => {
  expect(formatDate('2026-10-01')).toBe('1 Oct 2026')
})
```

- Never depend on the real date: a test that passes today and fails next month is a broken test.
- Never build expectations with `toLocaleDateString()` or the code under test; write the literal (`'1 Oct 2026'`).
- The runner sets `TZ=UTC` when it is unset; a timezone-independent test passes on any machine anyway.

## 4. Timers

For behaviour driven by `setTimeout` (`useNotice.ts:8`, 4000 ms), use full fake timers and move time inside `act`, then assert synchronously. Example in [hooks](hooks.md) section 7. Useful checks: just before the deadline (3999 ms) nothing changed, at the deadline it did, and `vi.getTimerCount()` is 0 after unmount.

Plain `vi.useFakeTimers()` blocks Testing Library's async helpers: `user.*`, `findBy*` and `waitFor` wait on a `setTimeout` that only advances for Jest timers, so the test hangs until its timeout (verified with Vitest 4.1). Do not combine them.

## 5. Timers together with user interaction

When a test must click and then jump time, let fake time also advance on its own and give user-event the clock:

```tsx
afterEach(() => vi.useRealTimers())

function Notifier() {
  const { message, notify } = useNotice()
  return (
    <>
      <button onClick={() => notify('Task deleted.')}>Notify</button>
      <p role="status">{message}</p>
    </>
  )
}

it('hides the notice four seconds after the click', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<Notifier />)
  await user.click(screen.getByRole('button', { name: 'Notify' }))
  expect(screen.getByRole('status')).toHaveTextContent('Task deleted.')
  act(() => vi.advanceTimersByTime(4000))
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
})
```

`Notifier` stands in for the component under test in its `.tsx` owner test; render the real component there. A hook's `.test.ts` owner cannot hold JSX, so test the hook itself with `renderHook` and plain fake timers (section 4). Prefer the simpler patterns from sections 3 and 4 whenever the test does not need both.
