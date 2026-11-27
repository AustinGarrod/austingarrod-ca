import { Fragment, useRef, useState } from 'react'
import { presentCost } from './domain/cost-presentation'
import './SPCost.css'

function GroupedValue({ value }: { value: string }) {
  const { groups } = presentCost(value)
  return groups.map((group, index) => <Fragment key={index}>{index > 0 && <wbr />}<span className="cost-digits">{group}{index < groups.length - 1 ? ',' : ''}</span></Fragment>)
}

/**
 * Exact large-number presentation: coefficient and power of ten from 13 digits, grouped digits below.
 * Slayer Points are the default unit; companion counts pass their own unit (or none).
 */
export function SPCost({ value, full = false, unit = 'SP', unitName = 'Slayer Points' }: { value: string; full?: boolean; unit?: string; unitName?: string }) {
  const { exact, scientific } = presentCost(value)
  const [first, fraction] = scientific?.coefficient.split('.') ?? []
  return <span className="sp-cost" role="math" aria-label={unitName ? `${exact} ${unitName}` : exact} title={unit ? `${exact} ${unit}` : exact} data-exact-cost={value}>
    <span aria-hidden="true">{scientific && !full ? <><span className="cost-digits">{first}{fraction ? '.' : ''}</span>{fraction?.match(/.{1,3}/g)?.map((part, index) => <Fragment key={index}>{index > 0 && <wbr />}<span className="cost-digits">{part}</span></Fragment>)}{' × '}<span className="cost-power">10<sup>{scientific.exponent}</sup></span></> : <GroupedValue value={value} />}{unit && <span className="cost-unit"> {unit}</span>}</span>
  </span>
}

/** A recorded or catalog count. Long values use the Ascension notation with the exact digits one tap away. */
export function CompactCount({ value, unit = '' }: { value: string; unit?: string }) {
  if (!/^\d+$/.test(value)) return <>{value}{unit && ` ${unit}`}</>
  const canonical = BigInt(value).toString()
  const { exact, scientific } = presentCost(canonical)
  if (!scientific) return <>{exact}{unit && ` ${unit}`}</>
  return <details className="compact-count"><summary><SPCost value={canonical} unit={unit} unitName={unit} /></summary><span className="compact-count-exact">Exact: <span className="cost-digits">{exact}</span>{unit && ` ${unit}`}</span></details>
}

export function ExactCostDetails({ value, upgradeId }: { value: string; upgradeId: string }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle')
  const manual = useRef<HTMLTextAreaElement>(null)
  async function copyCost() {
    try {
      await navigator.clipboard.writeText(value)
      setCopy('copied')
    } catch { setCopy('manual') }
  }
  return <section className="exact-cost" aria-label="Exact Slayer Point cost">
    <h3>Exact Slayer Point cost</h3><p><SPCost value={value} full /></p>
    {presentCost(value).scientific && <p>Compact costs use powers of ten. Every displayed digit is exact; no rounding is used.</p>}
    <small>Upgrade ID: {upgradeId}</small>
    <button onClick={() => void copyCost()}>Copy exact cost</button><small>Copies digits without separators.</small>
    <p role="status" aria-label="Exact cost copy feedback">{copy === 'copied' ? 'Exact cost copied.' : copy === 'manual' ? 'Copy unavailable. Select the exact digits below and copy them manually.' : ''}</p>
    {copy === 'manual' && <textarea ref={manual} aria-label="Exact cost digits" readOnly value={value} onFocus={() => manual.current?.select()} />}
  </section>
}
