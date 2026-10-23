import { Alert, Button, Drawer, Text } from '../../../design-system'
import { useClearCompletedMutation } from '../hooks/useClearCompletedMutation'

export function ClearCompletedDialog({
  count,
  busy,
  onClose,
  onCleared,
}: {
  count: number
  busy: boolean
  onClose: () => void
  onCleared: (deleted: number) => void
}) {
  const clearCompleted = useClearCompletedMutation()
  const pending = busy || clearCompleted.isPending
  async function clear() {
    if (pending) return
    try {
      const { deleted } = await clearCompleted.mutateAsync()
      onCleared(deleted)
    } catch {
      // Keep confirmation open so the server error is visible and retry is possible.
    }
  }
  return (
    <Drawer
      isOpen
      title="Clear completed tasks?"
      busy={pending}
      onClose={onClose}
    >
      <Text>
        {count === 1
          ? 'The completed task will be permanently deleted.'
          : `All ${count} completed tasks will be permanently deleted.`}
      </Text>
      {clearCompleted.error && (
        <Alert variant="warning">{clearCompleted.error.message}</Alert>
      )}
      <div className="row actions">
        <Button variant="secondary" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={pending}
          onClick={() => void clear()}
        >
          {pending ? 'Clearing…' : 'Clear completed'}
        </Button>
      </div>
    </Drawer>
  )
}
