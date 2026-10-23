import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { useClearCompletedMutation } from '../hooks/useClearCompletedMutation'
import { ClearCompletedDialog } from './ClearCompletedDialog'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useClearCompletedMutation', () => ({
  useClearCompletedMutation: vi.fn(),
}))

beforeEach(() => vi.clearAllMocks())

function mockMutation(
  mutateAsync: ReturnType<typeof vi.fn>,
  state: { isPending: boolean; error: Error | null } = {
    isPending: false,
    error: null,
  },
) {
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    ...state,
    mutateAsync,
  } as unknown as ReturnType<typeof useClearCompletedMutation>)
}

it.each([
  [1, 'The completed task will be permanently deleted.'],
  [3, 'All 3 completed tasks will be permanently deleted.'],
])('describes what is deleted for %i completed task(s)', (count, text) => {
  mockMutation(vi.fn())
  render(
    <ClearCompletedDialog
      count={count}
      busy={false}
      onClose={vi.fn()}
      onCleared={vi.fn()}
    />,
  )
  expect(
    screen.getByRole('dialog', { name: 'Clear completed tasks?' }),
  ).toBeVisible()
  expect(screen.getByText(text)).toBeVisible()
  expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
})

it('shows a clearing error and allows cancelling without clearing', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn()
  mockMutation(mutateAsync, {
    isPending: false,
    error: new Error('Could not clear.'),
  })
  const onClose = vi.fn()
  const onCleared = vi.fn()
  render(
    <ClearCompletedDialog
      count={2}
      busy={false}
      onClose={onClose}
      onCleared={onCleared}
    />,
  )
  expect(screen.getByTestId('alert')).toHaveTextContent('Could not clear.')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(mutateAsync).not.toHaveBeenCalled()
  expect(onCleared).not.toHaveBeenCalled()
})

it('clears the completed tasks and reports the deleted count when confirmed', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn().mockResolvedValue({ deleted: 2 })
  mockMutation(mutateAsync)
  const onClose = vi.fn()
  const onCleared = vi.fn()
  render(
    <ClearCompletedDialog
      count={2}
      busy={false}
      onClose={onClose}
      onCleared={onCleared}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Clear completed' }))
  await waitFor(() => expect(onCleared).toHaveBeenCalledWith(2))
  expect(onCleared).toHaveBeenCalledTimes(1)
  expect(mutateAsync).toHaveBeenCalledTimes(1)
  expect(onClose).not.toHaveBeenCalled()
})

it('does not report clearing when it fails and allows retrying', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn().mockRejectedValue(new Error('Unavailable.'))
  mockMutation(mutateAsync)
  const onCleared = vi.fn()
  render(
    <ClearCompletedDialog
      count={2}
      busy={false}
      onClose={vi.fn()}
      onCleared={onCleared}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Clear completed' }))
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
  expect(onCleared).not.toHaveBeenCalled()
  expect(
    screen.getByRole('dialog', { name: 'Clear completed tasks?' }),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Clear completed' }))
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2))
  expect(onCleared).not.toHaveBeenCalled()
})

it.each([
  ['the clearing is pending', { isPending: true }, false],
  ['the page is busy', { isPending: false }, true],
])('locks the dialog while %s', async (_name, state, busy) => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn()
  mockMutation(mutateAsync, { ...state, error: null })
  const onClose = vi.fn()
  const onCleared = vi.fn()
  render(
    <ClearCompletedDialog
      count={2}
      busy={busy}
      onClose={onClose}
      onCleared={onCleared}
    />,
  )
  const confirm = screen.getByRole('button', { name: 'Clearing…' })
  expect(confirm).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
  await user.click(confirm)
  expect(mutateAsync).not.toHaveBeenCalled()
  expect(onCleared).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})
