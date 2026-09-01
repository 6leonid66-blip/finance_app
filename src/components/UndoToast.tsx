type UndoToastProps = {
  message: string | null
  onUndo?: () => void
  onDismiss: () => void
}

export function UndoToast({ message, onUndo, onDismiss }: UndoToastProps) {
  if (!message) return null
  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <span>{message}</span>
      {onUndo ? (
        <button type="button" className="link-inline" onClick={onUndo}>
          ביטול
        </button>
      ) : (
        <button type="button" className="link-inline" onClick={onDismiss}>
          סגור
        </button>
      )}
    </div>
  )
}
