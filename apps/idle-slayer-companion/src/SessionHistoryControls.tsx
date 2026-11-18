import { useId } from 'react'
import { historyActionLabel, type HistoryAction } from './domain/profile-history'

export function SessionHistoryControls({ undoAction, redoAction, busy, onUndo, onRedo }: {
  undoAction?: HistoryAction; redoAction?: HistoryAction; busy: boolean; onUndo: () => void; onRedo: () => void
}) {
  const id = useId()
  return <div className="session-history-controls" role="group" aria-label="Session history">
    {(['Undo', 'Redo'] as const).map((direction) => {
      const action = direction === 'Undo' ? undoAction : redoAction
      const label = action ? historyActionLabel(action) : 'No change available'
      const description = `${direction}: ${label}. ${direction === 'Undo' ? 'Restore progress before this action' : 'Restore this undone change'}, including its spoiler setting.`
      return <div key={direction}><button aria-label={direction} aria-describedby={`${id}-${direction}`} title={description} disabled={busy || !action} onClick={direction === 'Undo' ? onUndo : onRedo}>{direction}<small aria-hidden="true">{label}</small></button><span className="sr-only" id={`${id}-${direction}`}>{description}</span></div>
    })}
  </div>
}
