---
name: writing-frontend-unit-tests
description: Writes and extends Vitest unit tests for this repository's React frontend (React 19, React Query 5, Testing Library, user-event, jest-dom, jsdom) - components, React Query hooks, plain hooks, the fetch-based HTTP client, the todos API module and pure utilities. Covers file placement, design-system mocks, a fresh QueryClient wrapper, fetch stubs, fixed dates and fake timers, and accessible queries. Use whenever a test target lives under frontend/src, before creating or changing any frontend test file.
---

# Writing frontend unit tests

The frontend runs Vitest 4 in jsdom (`frontend/vite.config.ts:7-9`). `frontend/src/test/setup.ts` loads the jest-dom matchers and registers `afterEach(cleanup)`; nothing else is global. Run tests only through the **running-unit-tests** skill. File paths in this skill are relative to `frontend/src/` unless they start with `frontend/` or `.claude/`.

## 1. Before writing

- [ ] Read the target source and its owner test: the colocated `X.test.tsx` / `x.test.ts` next to it. If it exists, add cases to it in its existing style and keep every existing assertion.
- [ ] Pick the pattern in section 2 and read the reference file it names.
- [ ] Glob `frontend/src/test/*` for helpers before creating one.
- [ ] List the behaviours from the source: branches, user-visible copy, callbacks and their arguments, API calls, cache effects. The UI strings in the source and the types are the oracle; never derive an expected value by running the code.

## 2. Choose the pattern

| Target | Render / call with | Mock | Read |
|---|---|---|---|
| Presentational component (`TodoItem`, `TodoEmptyState`, `TodoForm`) | `render` | design system | [components](references/components.md) |
| Component calling hooks (`DeleteTodoDialog`, `TodoEditor`) | `render` | design system + the hook modules (repo default) | [components](references/components.md) |
| Same, when the behaviour is the query/mutation outcome and the owner test does not mock the hook module | `render` + `createWrapper(client)` | design system + `todosApi` | [components](references/components.md), [hooks](references/hooks.md) |
| Container (`TodosPage`) | `render` | design system, every hook, children as `vi.fn` | [components](references/components.md) |
| React Query hook (`features/todos/hooks/*`) | `renderHook` + wrapper | `todosApi` | [hooks](references/hooks.md) |
| Plain hook (`useTodoFilters`, `useNotice`) | `renderHook` | nothing (fake timers for `useNotice`) | [hooks](references/hooks.md) |
| `lib/http.ts` | direct call | `fetch` via `vi.stubGlobal` | [http-client](references/http-client.md) |
| `features/todos/api/todos.ts` | direct call | `lib/http` `request` | [http-client](references/http-client.md) |
| `features/todos/utils/todos.ts` | direct call | nothing | [utils-and-time](references/utils-and-time.md) |
| `app/AppProviders.tsx` | `render` with the real design system | nothing | [components](references/components.md) |

Not unit-test targets (excluded in `.claude/policy/test-policy.json`): `design-system/**`, `main.tsx`, `test/**`, `types.ts`, `*.types.ts`, `index.ts`, `api/queryKeys.ts`, `lib/queryClient.ts`.

Best exemplars (read at most two): `features/todos/components/TodosHeader.test.tsx` (props, `rerender`, disabled), `features/todos/components/TodoForm.test.tsx` (form input, validation), `features/todos/components/DeleteTodoDialog.test.tsx` (mocked hook), `features/todos/TodosPage.test.tsx` (container), `features/todos/api/todos.test.ts` (module mock), `features/todos/utils/todos.test.ts` (pure function). No existing test uses a `QueryClient` yet: take those patterns from [hooks](references/hooks.md).

## 3. Files and style

- Colocate with the source's extension: `X.tsx` -> `X.test.tsx`, `x.ts` -> `x.test.ts` (the owner-test rule; never pick another name). A `.test.ts` file cannot contain JSX: test hooks there with `renderHook` and a wrapper from `frontend/src/test/`.
- Import every test API from `'vitest'`: `import { beforeEach, describe, expect, it, vi } from 'vitest'`. Globals are off, but `frontend/tsconfig.json:13` loads the `vitest/globals` types, so a missing import passes the type check and then fails at runtime with `ReferenceError: it is not defined`.
- Use `it`, never `test`. Top-level `it` by default; `describe` only to group one function of a multi-function module (`utils/todos.test.ts:16`).
- Name each test with a present-tense sentence about behaviour, no "should": `'shows a deletion error and allows cancelling without deleting'`.
- Import order: packages (`@tanstack/react-query`, `@testing-library/react`, `@testing-library/user-event`), then `vitest`, then relative helpers, fixtures and mocked modules, the unit under test last. Relative paths without extensions.
- Prettier style (`frontend/.prettierrc.json`): no semicolons, single quotes, trailing commas, 80 columns.
- Fixture: `todoFixture` from `frontend/src/test/todoFixture.ts` (id 7, `'Prepare a demo'`, medium, active, no due date). Derive variants by spreading: `{ ...todoFixture, id: 8, completed: true }`. Never mutate it.
- One behaviour per `it`. Several `expect`s are fine when they describe that one behaviour; use `rerender` to show a state transition (`TodosHeader.test.tsx:11-24`).

## 4. Mocking

**Design system.** Every component test that renders design-system components mocks the barrel with the existing test doubles, using the path from the test file:

```tsx
vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
```

Why: the real components need a styled-components `ThemeProvider` (without one they throw `Cannot read properties of undefined (reading 'ink')`), and the real `Drawer` calls `dialog.showModal()` (`Drawer.tsx:21`), which jsdom does not implement (`showModal is not a function`). The factory must be async (`() => import(...)`) because `vi.mock` is hoisted (`design-system/mocks.tsx:18-20`). What each double renders, and how to query it, is in [components](references/components.md).

- `design-system/mocks.tsx` and `test/setup.ts` are not writable. Work with what the doubles render. Behaviour that only exists in the real design system (focus handling, Escape, `aria-invalid`, Alert roles) is not unit-testable here: do not assert it; if such behaviour is what a target changed, report a `not_unit_testable` finding.
- Mock one boundary below the unit: component -> its hook modules (repo convention) or `todosApi`; React Query hook -> `todosApi`; `todosApi` -> `request`; `request` -> `fetch`. Never mock the module under test or the pure helpers it uses (`utils/todos.ts`).
- `vi.mock` applies to the whole file, and new cases go only into the owner test; never create a second test file for the same source. If the owner test already mocks `../hooks/useX`, keep using hook doubles there; cache effects are pinned in the hook's own owner test when the hook is a target. The real-hook pattern fits only an owner test that does not mock the hook (for example a new one).
- Hook doubles return only the fields the unit reads, cast once: `vi.mocked(useX).mockReturnValue({ isPending: false, error: null, mutateAsync } as unknown as ReturnType<typeof useX>)` (`DeleteTodoDialog.test.tsx:16-20`).
- A child double whose props you inspect must be a `vi.fn`: `TodoList: vi.fn(() => <p>Task list</p>)`. Plain functions (`TodoList.test.tsx:6-9`) cannot be inspected.
- Add `beforeEach(() => vi.clearAllMocks())` to every file that asserts on mock calls: call history otherwise accumulates across the tests of a file. It keeps implementations, so set each test's return values inside that test.
- Replace globals only with `vi.stubGlobal(...)` plus `afterEach(() => vi.unstubAllGlobals())`; never assign to `globalThis`.

## 5. Queries, interactions and async

Query priority (Testing Library), with what works in this repo:

| # | Query | Use for |
|---|---|---|
| 1 | `getByRole(role, { name })` | buttons, `checkbox`, `dialog`, `heading` (with `level`), `region` (`section` with `aria-label`), `combobox`, `textbox`, `listitem`, `status`, `group` (fieldset) |
| 2 | `getByLabelText` | form fields; regex when the label has a suffix (`/Task title/` for `'Task title *'`) |
| 3 | `getByText` | non-interactive copy |
| 4 | `getByTestId('alert')` | only the Alert double, which has no role |

- Scope with `within(screen.getByRole('region', { name: 'Task list' }))`. Never use `container.querySelector` or class names.
- `queryBy*` only to assert absence: `expect(screen.queryByRole('button')).not.toBeInTheDocument()`.
- Create `const user = userEvent.setup()` at the start of the test, before `render`, and `await` every `user.*` call. Do not use `fireEvent`.
- Something appears later: `expect(await screen.findByRole(...)).toBeVisible()`. A callback or side effect happens later: `await waitFor(() => expect(onSaved).toHaveBeenCalledWith('New task added.'))`. One assertion per `waitFor`, no side effects inside it.
- Never sleep (`setTimeout`, `await new Promise((r) => setTimeout(r, n))`): wait for the observable result instead.

## 6. act() and unfinished async work

React will not warn you here: Testing Library enables React's act environment only through global test hooks, which are off, and `setup.ts` does not enable it, so "not wrapped in act(...)" warnings are never printed (verified), and the runner reports only pass/fail. Prevent their cause instead:

- Await every async effect the test starts until its final, visible state before the last assertion. A pending-state test resolves its deferred promise and awaits the settled state (see the pending example in [components](references/components.md)).
- Use `act()` only to call something outside React's event system: a setter taken from `renderHook`'s `result.current`, a callback captured from a mocked child, or `vi.advanceTimersByTime`. `render`, `user.*`, `findBy*` and `waitFor` already wrap act.

## 7. React Query

- Never import `lib/queryClient`: it retries failed queries once (`lib/queryClient.ts:5`), so an error state arrives after `waitFor`'s 1 s default timeout, and its cache is shared between tests.
- Give each test a fresh client from the shared helper `frontend/src/test/queryClient.tsx`: `createTestQueryClient()` (no retries, no garbage collection of seeded data) and `createWrapper(client)` for `render` / `renderHook`. Do not edit or duplicate it.

- Seed the cache with `client.setQueryData<Todo[]>(todoKeys.list, [todoFixture])` and assert with `client.getQueryData(todoKeys.list)`. Query hooks: [hooks](references/hooks.md).

## 8. Time and dates

- The runner sets `TZ=UTC` when TZ is unset. Still write timezone-independent tests: put the system time at midday UTC, so the local date is the same in every common timezone.
- Fixed "now" (`isOverdue`, overdue badges): `vi.useFakeTimers({ toFake: ['Date'] })` and `vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))`, with `afterEach(() => vi.useRealTimers())`. Faking only `Date` keeps `userEvent`, `findBy*` and `waitFor` working.
- Timer-driven behaviour (`useNotice` clears after 4000 ms): `vi.useFakeTimers()` and `act(() => vi.advanceTimersByTime(4000))`, then assert synchronously.
- Plain `vi.useFakeTimers()` combined with `userEvent`, `findBy*` or `waitFor` hangs until the test times out (verified). If a test needs both, use `vi.useFakeTimers({ shouldAdvanceTime: true })` and `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.

## 9. Assertions

- State accessible behaviour with jest-dom: `toBeVisible`, `toBeDisabled`, `toBeChecked`, `toHaveValue`, `toHaveTextContent`, `toHaveAccessibleName`, `toHaveAttribute('href', '/')`, `toBeEmptyDOMElement`, `not.toBeInTheDocument`.
- Callbacks: exact arguments with `toHaveBeenCalledWith`, counts with `toHaveBeenCalledTimes`, and `not.toHaveBeenCalled()` for guarded paths (busy, validation errors, cancel).
- Call order only when order is the requirement: `mock.invocationCallOrder` (`TodosPage.test.tsx:65-67`).
- Do not assert props passed to design-system doubles (`vi.mocked(Badge).mock.calls`): visual props such as `variant` are stripped by the double (`design-system/mocks.tsx:24-48`) and no user sees them. Assert the DOM fact instead (heading level via `getByRole('heading', { level: 2 })`, the `' · overdue'` text). If a visual prop is the only signal of a changed behaviour, report `not_unit_testable`. Two existing tests do assert such props (`SuccessNotice.test.tsx:20-22`, `ApplicationHeader.test.tsx:17-23`): keep them, do not copy the pattern.
- Every test must fail when its behaviour breaks. A test whose only check is the value a mock returned, or `expect.any(Function)` / `toBeDefined()`, proves nothing; add the call or transformation it is about.

## 10. Do not

| Don't | Why |
|---|---|
| Snapshots (`toMatchSnapshot`, `toMatchInlineSnapshot`) | Blocked by the policy; the oracle becomes whatever the code renders today |
| `.only`, `.skip`, `.todo`, `.fails`, `xit` | Blocked; hides tests or pins failures |
| Assert class names, styles or DOM structure | Classes here are layout-only (`todo-row`, `notice-position`); users see roles and text |
| Assert component state, hook internals or private functions | Implementation details: refactors break the test while bugs pass |
| Test design-system internals through the doubles, or assert their props | The doubles do not reproduce real behaviour and strip visual props; `design-system/**` is excluded |
| `fireEvent`, sleeps, real 4-second timers | Skips real interaction rules; slow and flaky |
| Rewrite or delete existing assertions to make room | Add new cases; existing human assertions are protected |
| Edit production code, `setup.ts`, `mocks.tsx`, config or packages | Not writable; the tooling blocks it |
| Assert behaviour that looks wrong | Never pin a bug: leave the case out and report a `suspected_bug` (examples in [http-client](references/http-client.md)) |

## 11. Finish

- [ ] Explicit `vitest` imports; `it` only; no forbidden content.
- [ ] Every async action awaited to its end; fake timers restored; globals unstubbed; mocks cleared where calls are asserted.
- [ ] For each test, imagine flipping the condition or dropping the call it covers: the test must fail.
- [ ] The new or changed files pass with **running-unit-tests** (test file plus its source); re-read uncovered lines and add only behaviour worth a test.
- [ ] The whole frontend suite passes (`node .claude/skills/running-unit-tests/scripts/run-tests.ts frontend`), then `npm --prefix frontend run typecheck`.
