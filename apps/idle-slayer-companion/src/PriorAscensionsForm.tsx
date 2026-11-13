import { useId, useState } from 'react'
import { MAX_PRIOR_ASCENSIONS } from './domain/prior-ascensions'

export function PriorAscensionsForm({ epoch, disabled, onReview, onEdit }: {
  epoch: number; disabled: boolean; onReview: (value: string) => string | undefined; onEdit: () => void
}) {
  const [value, setValue] = useState(String(epoch))
  const [invalid, setInvalid] = useState(false)
  const helpId = useId()
  return <form className="prior-ascensions telemetry-private rr-block" noValidate onSubmit={(event) => {
    event.preventDefault()
    setInvalid(Boolean(onReview(value)))
  }}>
    <label>Previous Ultra Ascensions<input disabled={disabled} type="number" min="0" max={MAX_PRIOR_ASCENSIONS} step="1" value={value}
      aria-invalid={invalid || undefined} aria-describedby={`${helpId}${invalid ? ' dialog-feedback-content' : ''}`}
      onChange={(event) => { setValue(event.target.value); setInvalid(false); onEdit() }} /></label>
    <small id={helpId}>Enter existing history, then review and confirm to record it. Current purchases stay current; earlier ownership history stays intact. Purchases and Astral activation stay unchanged. This count can only increase, up to 1,000,000. Correct an entry mistake with Undo in this session or an earlier JSON backup.</small>
    <button type="submit" disabled={disabled}>Review history…</button>
  </form>
}
