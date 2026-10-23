export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Headers accepts every HeadersInit form; a caller's Content-Type wins.
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`/api${path}`, { ...init, headers })
  } catch (error) {
    if (init?.signal?.aborted) throw error
    throw new Error('Cannot connect to the server. Please try again.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    if (response.status === 422)
      throw new Error(
        'Check the task details: title up to 120 characters, description up to 2000 characters, and a valid due date.',
      )
    throw new Error(
      typeof body?.detail === 'string'
        ? body.detail
        : 'The operation failed. Please try again.',
    )
  }
  if (response.status === 204) return undefined as T
  try {
    return (await response.json()) as T
  } catch (error) {
    if (init?.signal?.aborted) throw error
    throw new Error('The server sent an unexpected response. Please try again.')
  }
}
