import { createContext, useContext, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export const DialogFeedbackContext = createContext<{ title: string | null; announcement: string; sequence: number; content: ReactNode; clear: () => void }>({ title: null, announcement: '', sequence: 0, content: null, clear: () => {} })

export function Dialog({ title, children, close, dismissDisabled = false, returnFocus }: { title: string; children: ReactNode; close: () => void; dismissDisabled?: boolean; returnFocus?: () => HTMLElement | null }) {
  const ref = useRef<HTMLDialogElement>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)
  const feedback = useContext(DialogFeedbackContext)
  const activeFeedback = feedback.title === title
  const dismiss = () => { if (!dismissDisabled) { feedback.clear(); close() } }
  useEffect(() => {
    const previousFocus = document.activeElement
    const dialog = ref.current
    dialog?.showModal()
    return () => {
      dialog?.close()
      const target = returnFocus?.() ?? (previousFocus instanceof HTMLElement && previousFocus.isConnected ? previousFocus : null)
      target?.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    if (activeFeedback && feedback.announcement) feedbackRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeFeedback, feedback.announcement, feedback.sequence])
  return <dialog ref={ref} onCancel={(event) => { event.preventDefault(); dismiss() }} aria-labelledby="dialog-title">
    <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button className="dialog-close" aria-label="Close dialog" disabled={dismissDisabled} onClick={dismiss}><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="18" height="18"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button></div>
    {activeFeedback && <div id="dialog-feedback" ref={feedbackRef} className="dialog-feedback telemetry-private rr-block" role="status" aria-label="Map action feedback" aria-live="polite" aria-atomic="true">{feedback.announcement && <div id="dialog-feedback-content">{feedback.content}</div>}</div>}
    {children}
  </dialog>
}
