import { afterEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../test/todoFixture'
import { request } from './http'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(status: number, body?: unknown) {
  const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) =>
    body === undefined
      ? new Response(null, { status })
      : new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
        }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function sentHeaders(fetchMock: ReturnType<typeof stubFetch>) {
  return new Headers(fetchMock.mock.calls[0][1]?.headers)
}

it('sends JSON requests under /api and returns the parsed body', async () => {
  const fetchMock = stubFetch(200, [todoFixture])
  await expect(
    request('/todos', { method: 'POST', body: '{}' }),
  ).resolves.toEqual([todoFixture])
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/todos',
    expect.objectContaining({ method: 'POST', body: '{}' }),
  )
  expect(sentHeaders(fetchMock).get('Content-Type')).toBe('application/json')
})

it('lets caller headers given as a plain object override the defaults', async () => {
  const fetchMock = stubFetch(200, {})
  await request('/todos', {
    headers: { 'Content-Type': 'text/plain', 'X-Trace': '1' },
  })
  const headers = sentHeaders(fetchMock)
  expect(headers.get('Content-Type')).toBe('text/plain')
  expect(headers.get('X-Trace')).toBe('1')
})

it('keeps the JSON Content-Type default when the caller sets other headers only', async () => {
  const fetchMock = stubFetch(200, {})
  await request('/todos', { headers: { 'X-Trace': '1' } })
  const headers = sentHeaders(fetchMock)
  expect(headers.get('Content-Type')).toBe('application/json')
  expect(headers.get('X-Trace')).toBe('1')
})

it('lets a Content-Type given through a Headers instance override the default', async () => {
  const fetchMock = stubFetch(200, {})
  await request('/todos', {
    headers: new Headers({ 'Content-Type': 'text/csv' }),
  })
  expect(sentHeaders(fetchMock).get('Content-Type')).toBe('text/csv')
})

it('accepts caller headers given as name-value pairs', async () => {
  const fetchMock = stubFetch(200, {})
  await request('/todos', {
    headers: [
      ['Content-Type', 'text/plain'],
      ['X-Trace', '2'],
    ],
  })
  const headers = sentHeaders(fetchMock)
  expect(headers.get('Content-Type')).toBe('text/plain')
  expect(headers.get('X-Trace')).toBe('2')
})

it('resolves to undefined for 204 No Content', async () => {
  stubFetch(204)
  await expect(
    request('/todos/7', { method: 'DELETE' }),
  ).resolves.toBeUndefined()
})

it('reports a 200 response with a non-JSON body as an unexpected response', async () => {
  stubFetch(200, '<html>Maintenance</html>')
  await expect(request('/todos')).rejects.toThrow(
    'The server sent an unexpected response. Please try again.',
  )
})

it('rethrows the original error when the request was aborted while reading the body', async () => {
  const controller = new AbortController()
  const abortError = new DOMException(
    'The operation was aborted.',
    'AbortError',
  )
  controller.abort()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(abortError),
    } as unknown as Response),
  )
  await expect(request('/todos', { signal: controller.signal })).rejects.toBe(
    abortError,
  )
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
