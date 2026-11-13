import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Profile, Upgrade } from './domain/types'
import { discoverUpgrades } from './domain/discovery'
import type { DiscoveryFilter, UpgradeState } from './domain/discovery'
import { Icon } from './UpgradeCard'
import { trackEvent } from './analytics'
import './SearchPanel.css'
import { SPCost } from './SPCost'

const stateLabels: Record<UpgradeState, string> = {
  available: '+ Available', locked: '◇ Locked', purchased: '✓ Owned and active', pending: '◷ Owned · awaiting activation',
}

export function SearchPanel({ upgrades, profile, inputRef, open, onOpenChange, onSelect }: {
  upgrades: Upgrade[]
  profile: Profile
  inputRef: RefObject<HTMLInputElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: string, keyboard: boolean) => void
}) {
  const resultsId = useId(), statusId = useId(), hintId = useId()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [queryRevision, setQueryRevision] = useState(0)
  const [filter, setFilter] = useState<DiscoveryFilter>('all')
  const panel = useRef<HTMLDivElement>(null)
  const focusFrame = useRef(0)
  const candidateFrame = useRef(0)
  const candidateGeneration = useRef(0)
  const results = useMemo(() => discoverUpgrades(upgrades, profile, query, filter), [upgrades, profile, query, filter])
  const latestSearch = useRef<{ query_length: '1-3' | '4-10' | '11-30' | '31+'; results: '0' | '1-5' | '6-20' | '21+' } | null>(null)
  latestSearch.current = query.trim() ? {
    query_length: query.length <= 3 ? '1-3' : query.length <= 10 ? '4-10' : query.length <= 30 ? '11-30' : '31+',
    results: results.length === 0 ? '0' : results.length <= 5 ? '1-5' : results.length <= 20 ? '6-20' : '21+',
  } : null
  useEffect(() => {
    if (!queryRevision || !latestSearch.current) return
    const timer = window.setTimeout(() => {
      if (latestSearch.current) trackEvent('search_performed', latestSearch.current)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [queryRevision])
  useEffect(() => { if (panel.current) panel.current.scrollTop = 0 }, [query, filter])
  useEffect(() => { if (!open) cancelCandidateFocus() }, [open])
  useEffect(() => {
    if (activeId && !results.some(({ node }) => node.id === activeId)) {
      cancelCandidateFocus()
      setActiveId(null)
      if (open && document.activeElement === document.body) inputRef.current?.focus({ preventScroll: true })
    }
  }, [activeId, results, open, inputRef])
  useEffect(() => () => { window.cancelAnimationFrame(focusFrame.current); window.cancelAnimationFrame(candidateFrame.current) }, [])
  useEffect(() => {
    const container = panel.current
    const heading = container?.querySelector('.results-heading')
    if (!open || !container || !heading) return
    const observer = new ResizeObserver(() => {
      const focused = document.activeElement
      if (focused instanceof HTMLButtonElement && focused.matches('.search-result') && container.contains(focused)) revealFocusedTitle(focused)
    })
    observer.observe(container); observer.observe(heading)
    return () => observer.disconnect()
  }, [open])
  function revealFocusedTitle(button: HTMLButtonElement) {
    if (!button.matches(':focus-visible')) return
    function align() {
      const container = panel.current
      const title = button.querySelector('.discovery-title')
      const heading = container?.querySelector('.results-heading')
      if (document.activeElement !== button || !button.matches(':focus-visible') || !container || !title || !heading) return
      // Enlarged browser text can make the companion taller than the viewport.
      // Bring the result panel into that viewport before scrolling its own rows;
      // a row cannot become readable by scrolling underneath an offscreen panel.
      if (document.documentElement.scrollHeight > window.innerHeight + 1) {
        const bounds = container.getBoundingClientRect()
        const targetTop = Math.max(8, window.innerHeight - Math.min(bounds.height, window.innerHeight - 16) - 8)
        if (bounds.top > targetTop) window.scrollBy({ top: bounds.top - targetTop, behavior: 'instant' })
        else if (bounds.top < 0) window.scrollBy({ top: bounds.top - 8, behavior: 'instant' })
      }
      const bounds = container.getBoundingClientRect(), text = title.getBoundingClientRect()
      const top = Math.max(bounds.top, heading.getBoundingClientRect().bottom, 0) + 8
      const bottom = Math.min(bounds.bottom, window.innerHeight) - 8
      if (text.top < top) container.scrollTop += text.top - top
      else if (text.bottom > bottom) container.scrollTop += Math.min(text.bottom - bottom, text.top - top)
    }
    // Native keyboard focus can center a tall row with its title behind the sticky
    // header. Recheck after that scrolling, using actual header and title geometry.
    align()
    window.cancelAnimationFrame(focusFrame.current)
    focusFrame.current = window.requestAnimationFrame(align)
  }
  function cancelCandidateFocus() {
    candidateGeneration.current++
    window.cancelAnimationFrame(candidateFrame.current)
  }
  function focusResult(index: number) {
    cancelCandidateFocus()
    const generation = candidateGeneration.current, origin = document.activeElement
    const result = results[index]
    if (!result) return
    const button = [...(panel.current?.querySelectorAll<HTMLButtonElement>('.search-result') ?? [])].find((element) => element.dataset.upgradeId === result.node.id)
    if (button) { button.focus({ preventScroll: true }); revealFocusedTitle(button) }
    else {
      candidateFrame.current = window.requestAnimationFrame(() => {
        if (generation !== candidateGeneration.current || document.activeElement !== origin) return
        const mounted = [...(panel.current?.querySelectorAll<HTMLButtonElement>('.search-result') ?? [])].find((element) => element.dataset.upgradeId === result.node.id)
        if (mounted) { mounted.focus({ preventScroll: true }); revealFocusedTitle(mounted) }
      })
    }
  }
  function close() { cancelCandidateFocus(); setActiveId(null); inputRef.current?.focus({ preventScroll: true }); onOpenChange(false) }
  return <div className="search-box" onKeyDown={(event) => { if (event.key === 'Escape' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close() } }}>
    <label className="sr-only" htmlFor="search">Search visible upgrade titles and effects</label>
    <button type="button" className="search-toggle" aria-label="Toggle search results" aria-expanded={open} aria-controls={open ? resultsId : undefined} onClick={() => { if (open) close(); else { onOpenChange(true); inputRef.current?.focus({ preventScroll: true }) } }}><span aria-hidden="true">⌕</span></button>
    <p id={statusId} role="status" aria-label="Search result state" aria-live="polite" aria-atomic="true" className="sr-only telemetry-private rr-block"><span id={`${statusId}-content`}>{open ? `Search results open. ${results.length} visible results${results.length ? '.' : '; no matching visible upgrades.'}` : 'Search results closed.'}</span></p>
    <p id={hintId} className="sr-only">Arrow Down or Arrow Up moves into results. In results, Arrow keys, Home and End choose a candidate; Enter or Space opens it. Escape closes results. Tab visits the controls and every result.</p>
    <input className="telemetry-private rr-block" id="search" ref={inputRef} type="search" aria-controls={open ? resultsId : undefined} aria-describedby={`${statusId}-content ${hintId}`} autoComplete="off" placeholder="Find an upgrade…" value={query}
      onFocus={() => onOpenChange(true)}
      onBlur={cancelCandidateFocus}
      onChange={(event) => { cancelCandidateFocus(); setActiveId(null); setQuery(event.target.value); setQueryRevision((revision) => revision + 1); onOpenChange(true) }}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); onOpenChange(true); focusResult(event.key === 'ArrowDown' ? 0 : results.length - 1) }
        else if (event.key === 'Enter' && results.length) { event.preventDefault(); onSelect((results.find(({ node }) => node.id === activeId) ?? results[0]).node.id, true) }
      }} />
    {open && <div ref={panel} id={resultsId} className="search-results upgrade-discovery telemetry-private rr-block" role="region" aria-label="Visible upgrade results">
      <div className="results-heading"><span>{results.length} visible results</span><button onClick={close} aria-label="Close search results">×</button></div>
      <div className="discovery-controls"><label htmlFor="discovery-state">Progress state</label><select id="discovery-state" value={filter} onChange={(event) => { cancelCandidateFocus(); setActiveId(null); setFilter(event.target.value as DiscoveryFilter) }}>
        <option value="all">All visible</option><option value="available">Available</option><option value="locked">Locked</option><option value="owned">Owned</option><option value="pending">Awaiting activation</option>
      </select><small>Available: native requirements recorded. SP balance is not checked.</small></div>
      <div className="discovery-list">
        {results.map(({ node, state, duplicateTitle }, index) => <button className="search-result" key={node.id} data-upgrade-id={node.id} aria-current={activeId === node.id ? 'true' : undefined} aria-describedby={`${hintId} ${resultsId}-${index}`} onFocus={(event) => { setActiveId(node.id); revealFocusedTitle(event.currentTarget) }} onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation()
            focusResult(event.key === 'Home' ? 0 : event.key === 'End' ? results.length - 1 : Math.max(0, Math.min(results.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
          }
        }} onClick={(event) => onSelect(node.id, event.detail === 0)}>
          <span id={`${resultsId}-${index}`} aria-hidden="true" className="sr-only">Candidate {index + 1} of {results.length} visible results.</span>
          <Icon node={node} /><span><span className="discovery-title">{node.title}</span><small className={`discovery-state ${state}`}>{stateLabels[state]}</small><small><SPCost value={node.cost} /></small>
            {duplicateTitle && <small className="discovery-identity">ID: {node.id}</small>}<small className="discovery-effect">{node.description}</small></span>
        </button>)}
        {results.length === 0 && <p>No visible upgrades match{filter === 'all' ? '.' : ' this progress state.'}</p>}
      </div>
    </div>}
  </div>
}
