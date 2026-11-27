import { createContext, useContext, useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

export const DialogFeedbackContext = createContext<{ title: string | null; announcement: string; sequence: number; content: ReactNode; clear: () => void }>({ title: null, announcement: '', sequence: 0, content: null, clear: () => {} })

/**
 * Modal dialog. `initialFocus` runs after showModal(), which otherwise moves focus to the first
 * control and resets the scroll position; children cannot focus themselves while mounting.
 * `closeOnBackdrop` is opt-in for dialogs that hold no unsaved input: a press and release that
 * both land outside the dialog box closes it, while a text selection dragged outside does not.
 */
export function Dialog({ title, children, close, dismissDisabled = false, returnFocus, initialFocus, closeOnBackdrop = false, className }: { title: string; children: ReactNode; close: () => void; dismissDisabled?: boolean; returnFocus?: () => HTMLElement | null; initialFocus?: () => HTMLElement | null | undefined; closeOnBackdrop?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)
  const pressedOutside = useRef(false)
  // Unique per dialog: a dialog opened from another (Account & sync inside Data & backup) keeps its own name.
  const titleId = useId()
  const feedback = useContext(DialogFeedbackContext)
  const activeFeedback = feedback.title === title
  const dismiss = () => { if (!dismissDisabled) { feedback.clear(); close() } }
  const outside = (event: { target: EventTarget | null; clientX: number; clientY: number }) => {
    const dialog = ref.current
    if (!dialog || event.target !== dialog) return false
    const box = dialog.getBoundingClientRect()
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom
  }
  useEffect(() => {
    const previousFocus = document.activeElement
    const dialog = ref.current
    dialog?.showModal()
    const target = initialFocus?.()
    if (target && dialog?.contains(target)) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'start' }) }
    return () => {
      dialog?.close()
      const target = returnFocus?.() ?? (previousFocus instanceof HTMLElement && previousFocus.isConnected ? previousFocus : null)
      target?.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    if (activeFeedback && feedback.announcement) feedbackRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeFeedback, feedback.announcement, feedback.sequence])
  return <dialog ref={ref} className={className} onCancel={(event) => { event.preventDefault(); dismiss() }} aria-labelledby={titleId}
    onPointerDown={closeOnBackdrop ? (event) => { pressedOutside.current = outside(event) } : undefined}
    onClick={closeOnBackdrop ? (event) => { if (pressedOutside.current && outside(event)) dismiss(); pressedOutside.current = false } : undefined}>
    <div className="dialog-heading"><h2 id={titleId}>{title}</h2><button className="dialog-close" aria-label="Close dialog" disabled={dismissDisabled} onClick={dismiss}><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="18" height="18"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button></div>
    {activeFeedback && <div id="dialog-feedback" ref={feedbackRef} className="dialog-feedback telemetry-private rr-block" role="status" aria-label="Map action feedback" aria-live="polite" aria-atomic="true">{feedback.announcement && <div id="dialog-feedback-content">{feedback.content}</div>}</div>}
    {children}
  </dialog>
}
