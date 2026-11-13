import { Fragment, useRef, useState } from 'react'
import { presentCost } from './domain/cost-presentation'
import './SPCost.css'

function GroupedValue({ value }: { value: string }) {
  const { groups } = presentCost(value)
  return groups.map((group, index) => <Fragment key={index}>{index > 0 && <wbr />}<span className="cost-digits">{group}{index < groups.length - 1 ? ',' : ''}</span></Fragment>)
}

export function SPCost({ value, full = false }: { value: string; full?: boolean }) {
  const { exact, scientific } = presentCost(value)
  const [first, fraction] = scientific?.coefficient.split('.') ?? []
  return <span className="sp-cost" role="math" aria-label={`${exact} Slayer Points`} title={`${exact} SP`} data-exact-cost={value}>
    <span aria-hidden="true">{scientific && !full ? <><span className="cost-digits">{first}{fraction ? '.' : ''}</span>{fraction?.match(/.{1,3}/g)?.map((part, index) => <Fragment key={index}>{index > 0 && <wbr />}<span className="cost-digits">{part}</span></Fragment>)}{' × '}<span className="cost-power">10<sup>{scientific.exponent}</sup></span></> : <GroupedValue value={value} />}<span className="cost-unit"> SP</span></span>
  </span>
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
