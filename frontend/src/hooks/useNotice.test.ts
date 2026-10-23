import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useNotice } from './useNotice'

afterEach(() => vi.useRealTimers())

it('starts without a notice and exposes a notification callback', () => {
  const { result } = renderHook(() => useNotice())
  expect(result.current.message).toBe('')
  expect(result.current.notify).toEqual(expect.any(Function))
})

it('clears the notice four seconds after the last notification', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('Task deleted.'))
  expect(result.current.message).toBe('Task deleted.')
  act(() => vi.advanceTimersByTime(3999))
  expect(result.current.message).toBe('Task deleted.')
  act(() => vi.advanceTimersByTime(1))
  expect(result.current.message).toBe('')
})

it('restarts the four-second window when the same text is notified again', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('Saved.'))
  act(() => vi.advanceTimersByTime(3000))
  act(() => result.current.notify('Saved.'))
  act(() => vi.advanceTimersByTime(3999))
  expect(result.current.message).toBe('Saved.')
  act(() => vi.advanceTimersByTime(1))
  expect(result.current.message).toBe('')
})

it('replaces the message with a newer notification', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('First.'))
  act(() => result.current.notify('Second.'))
  expect(result.current.message).toBe('Second.')
})

it('keeps the same notification callback across renders', () => {
  const { result, rerender } = renderHook(() => useNotice())
  const { notify } = result.current
  rerender()
  expect(result.current.notify).toBe(notify)
})

it('cancels the pending timer on unmount', () => {
  vi.useFakeTimers()
  const { result, unmount } = renderHook(() => useNotice())
  act(() => result.current.notify('Saved.'))
  expect(vi.getTimerCount()).toBe(1)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
