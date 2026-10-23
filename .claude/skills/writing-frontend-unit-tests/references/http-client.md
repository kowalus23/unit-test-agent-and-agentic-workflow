# HTTP client and API module tests

Contents
1. What `request()` does
2. Stubbing `fetch`
3. `request()` test file
4. Behaviour to report, not assert
5. `todosApi` tests

All snippets below passed in a copy of `frontend/`.

## 1. What `request()` does

`frontend/src/lib/http.ts`, owner test `frontend/src/lib/http.test.ts`:

| Line | Behaviour |
|---|---|
| 4-7 | `fetch('/api' + path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })` |
| 8-10 | `fetch` rejects: rethrows the original error when `init.signal.aborted`, otherwise `Error('Cannot connect to the server. Please try again.')` |
| 12-13 | non-OK response: reads the JSON body, `null` when it is not JSON |
| 14-17 | 422: fixed validation message, whatever the body says |
| 18-22 | other errors: `body.detail` when it is a string, otherwise `'The operation failed. Please try again.'` |
| 24 | 204: `undefined`; otherwise `response.json()` |

## 2. Stubbing `fetch`

- `vi.stubGlobal('fetch', mock)` and `afterEach(() => vi.unstubAllGlobals())`, which restores the original `fetch`. Never assign `globalThis.fetch` yourself.
- `Response`, `Headers`, `AbortController` and `DOMException` exist in this jsdom environment; build real `Response` objects instead of hand-made `{ ok, json }` objects, so `ok`, `status` and body parsing behave as in production.
- A `Response` body can be read once. `vi.fn().mockResolvedValue(new Response(...))` shares one object between calls, and a second read throws `TypeError`. Create a new `Response` per call (as `stubFetch` below does) when the code may fetch more than once.

## 3. `request()` test file

```ts
import { afterEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../test/todoFixture'
import { request } from './http'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(status: number, body?: unknown) {
  const fetchMock = vi.fn(async () =>
    body === undefined
      ? new Response(null, { status })
      : new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
        }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

it('sends JSON requests under /api and returns the parsed body', async () => {
  const fetchMock = stubFetch(200, [todoFixture])
  await expect(
    request('/todos', { method: 'POST', body: '{}' }),
  ).resolves.toEqual([todoFixture])
  expect(fetchMock).toHaveBeenCalledWith('/api/todos', {
    method: 'POST',
    body: '{}',
    headers: { 'Content-Type': 'application/json' },
  })
})

it('lets caller headers given as a plain object override the defaults', async () => {
  const fetchMock = stubFetch(200, {})
  await request('/todos', {
    headers: { 'Content-Type': 'text/plain', 'X-Trace': '1' },
  })
  expect(fetchMock).toHaveBeenCalledWith('/api/todos', {
    headers: { 'Content-Type': 'text/plain', 'X-Trace': '1' },
  })
})

it('resolves to undefined for 204 No Content', async () => {
  stubFetch(204)
  await expect(
    request('/todos/7', { method: 'DELETE' }),
  ).resolves.toBeUndefined()
})

it.each([
  [404, { detail: 'Task not found.' }, 'Task not found.'],
  [
    422,
    { detail: 'Invalid JSON.' },
    'Check the task details: title up to 120 characters, description up to 2000 characters, and a valid due date.',
  ],
  [
    500,
    { detail: [{ message: 'x' }] },
    'The operation failed. Please try again.',
  ],
  [502, '<html>Bad Gateway</html>', 'The operation failed. Please try again.'],
])(
  'maps HTTP %i with body %j to a user-facing error',
  async (status, body, message) => {
    stubFetch(status, body)
    await expect(request('/todos')).rejects.toThrow(new Error(message))
  },
)

it('reports a network failure as a connection error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
  )
  await expect(request('/todos')).rejects.toThrow(
    'Cannot connect to the server. Please try again.',
  )
})

it('rethrows the original error when the request was aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const abortError = new DOMException(
    'The operation was aborted.',
    'AbortError',
  )
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
  await expect(request('/todos', { signal: controller.signal })).rejects.toBe(
    abortError,
  )
})
```

Why these cases: the error strings are what users read, and the abort branch matters because React Query cancels queries through the signal (`useTodosQuery.ts:8`); `rejects.toBe` proves the original error object is passed through.

## 4. Behaviour to report, not assert

At the time of writing, `request()` does two things that look unintended. If they are still present, leave them out of the tests and add a `suspected_bug` finding instead (ground rule: never pin a bug):

- **Headers given as a `Headers` instance are dropped** (`http.ts:6`): spreading a `Headers` object yields `{}`, so only `Content-Type` is sent. Expected: caller headers are kept whatever form they take.
- **A 200 response with a non-JSON body rejects with a raw `SyntaxError`** (`http.ts:24`), whose parser message reaches the UI. Expected: a user-facing error, as for the other failure paths.

Check the current source before reporting; if a fix has landed, test the fixed behaviour instead.

## 5. `todosApi` tests

`frontend/src/features/todos/api/todos.ts` builds requests; mock `request` and assert the path and the init object (`api/todos.test.ts:6-7`):

```ts
import { beforeEach, expect, it, vi } from 'vitest'
import { request } from '../../../lib/http'
import { todoFixture } from '../../../test/todoFixture'
import { todosApi } from './todos'

vi.mock('../../../lib/http', () => ({ request: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('sends only the changed fields when updating a task', async () => {
  vi.mocked(request).mockResolvedValue({ ...todoFixture, completed: true })
  await todosApi.update(7, { completed: true })
  expect(request).toHaveBeenCalledWith('/todos/7', {
    method: 'PATCH',
    body: '{"completed":true}',
  })
})

it('never sends read-only fields when updating from a full task', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await todosApi.update(7, { ...todoFixture, title: 'Renamed' })
  const body = JSON.parse(vi.mocked(request).mock.calls[0][1]?.body as string)
  expect(body).toEqual({
    title: 'Renamed',
    description: '',
    priority: 'medium',
    due_date: null,
    completed: false,
  })
})

it('deletes a task by id', async () => {
  vi.mocked(request).mockResolvedValue(undefined)
  await todosApi.remove(7)
  expect(request).toHaveBeenCalledWith('/todos/7', { method: 'DELETE' })
})
```

- The read-only-field contract (`todos.ts:7`) is the important one: the form hands a full `Todo` to the API layer when editing, and only `title`, `description`, `priority`, `due_date` and `completed` may leave it.
- An exact body string (`'{"completed":true}'`) proves that `undefined` fields are omitted; `JSON.parse` + `toEqual` compares a structure independently of key order.
- Pair every resolved value check with a call check: `resolves.toEqual(x)` alone only echoes the mock (`api/todos.test.ts:9-14` does both).
