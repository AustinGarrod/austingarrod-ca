import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './CompanionShell.css'
import { usePwaStatus } from './pwa'
import { loadRailCollapsed, saveRailCollapsed } from './domain/rail-preference'
import { runtimeDeployment } from './runtime-deployment'

export const companionSections = [
  { id: 'overview', title: 'Overview', short: 'Home', symbol: '◈', description: 'Progress summary' },
  { id: 'ascension', title: 'Ascension', short: 'Map', symbol: '✧', description: 'Upgrade map and planning' },
  { id: 'achievements', title: 'Achievements', short: 'Achievements', symbol: '♜', description: 'Earned achievements' },
  { id: 'crafting', title: 'Crafting & materials', short: 'Crafting', symbol: '⚒', description: 'Items, materials, and recipes' },
  { id: 'quests', title: 'Quests & Village', short: 'Quests', symbol: '⚑', description: 'Quests and Village tasks' },
  { id: 'bestiary', title: 'Bestiary', short: 'Bestiary', symbol: '♞', description: 'Enemies, kills, and mastery' },
  { id: 'divinities', title: 'Divinities', short: 'Divinities', symbol: '☼', description: 'Selected Divinities and goals' },
] as const

export type CompanionSection = typeof companionSections[number]['id']

export interface CompanionShellProps {
  section: CompanionSection
  onNavigate: (section: CompanionSection) => void
  children: ReactNode
  ascension: ReactNode
  /** Opens Data & backup: import, backup, restore, transfer, account and clearing. */
  onData: () => void
  onSettings?: () => void
  onHelp?: () => void
  onInstall?: () => void
  status?: ReactNode
  /** Short save state for the header note; the full sentence is its title and stays in the status row. */
  saveNote?: { short: string; full: string; tone: 'saved' | 'pending' | 'warning' }
  notice?: ReactNode
}

/** The website build links within the portfolio; the frozen legacy copy on another origin needs absolute links. */
const siteLinks = runtimeDeployment.target === 'legacy-migration'
  ? { home: 'https://austingarrod.ca/', utilities: 'https://austingarrod.ca/utilities/' }
  : { home: '/', utilities: '/utilities/' }

/** Navigation owns no player data. Keeping the map mounted preserves its visit-only state. */
export function CompanionShell({ section, onNavigate, children, ascension, onData, onSettings, onHelp, onInstall, status, saveNote, notice }: CompanionShellProps) {
  const [collapsed, setCollapsedState] = useState(() => loadRailCollapsed(() => window.localStorage))
  function setCollapsed(next: boolean) { setCollapsedState(next); saveRailCollapsed(next, () => window.localStorage) }
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 900px)').matches)
  const [largeText, setLargeText] = useState(() => parseFloat(getComputedStyle(document.documentElement).fontSize) > 20)
  const pwaStatus = usePwaStatus()
  const menuButton = useRef<HTMLButtonElement>(null)
  const topbar = useRef<HTMLElement>(null)
  const navigation = useRef<HTMLElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const content = useRef<HTMLElement>(null)
  const current = companionSections.find((item) => item.id === section) ?? companionSections[0]
  const navigationModal = mobile && mobileOpen

  useLayoutEffect(() => {
    if (content.current) { content.current.scrollTop = 0; content.current.scrollLeft = 0 }
  }, [section])

  useEffect(() => {
    const observer = new ResizeObserver(() => setLargeText(parseFloat(getComputedStyle(document.documentElement).fontSize) > 20))
    if (topbar.current) observer.observe(topbar.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const query = matchMedia('(max-width: 900px)')
    const changed = () => { setMobile(query.matches); if (!query.matches) setMobileOpen(false) }
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  }, [])
  useEffect(() => {
    if (!navigationModal) return
    navigation.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMobileOpen(false); return }
      if (event.key !== 'Tab') return
      const controls = [...(sidebar.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? [])].filter((element) => element.getClientRects().length > 0)
      const first = controls[0], last = controls.at(-1)
      if (!first || !last) return
      if (!sidebar.current?.contains(document.activeElement)) { event.preventDefault(); first.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', trap, true)
    return () => { document.removeEventListener('keydown', trap, true); requestAnimationFrame(() => menuButton.current?.focus()) }
  }, [navigationModal])

  function navigate(next: CompanionSection) {
    onNavigate(next)
    setMobileOpen(false)
  }
  function openFromNavigation(action: () => void) {
    if (!navigationModal) { action(); return }
    setMobileOpen(false)
    requestAnimationFrame(() => { menuButton.current?.focus(); action() })
  }

  return <div className={`companion-shell${collapsed ? ' companion-rail-collapsed' : ''}${largeText ? ' companion-large-text' : ''}${section === 'ascension' ? ' companion-map-section' : ''}`}>
    <a className="companion-skip" href="#companion-content" inert={navigationModal}>Skip to content</a>
    {/* The site's slim utility header, reproduced for this separate build. No tracker attributes: the portfolio's tracker never loads here. */}
    <header className="companion-topbar" inert={navigationModal} ref={topbar}>
      <div className="companion-header-start">
        <button className="companion-mobile-toggle" type="button" ref={menuButton} onClick={() => setMobileOpen(!mobileOpen)} aria-expanded={mobileOpen} aria-controls="companion-navigation" aria-label="Menu"><span aria-hidden="true">☰</span><span className="companion-mobile-toggle-label" aria-hidden="true">Menu</span></button>
        <a className="companion-brand" href={siteLinks.home} aria-label="Austin Garrod home">Austin Garrod</a>
      </div>
      <nav className="companion-crumbs" aria-label="Utility breadcrumb">
        <a href={siteLinks.utilities}><span className="companion-crumb-back" aria-hidden="true">‹</span>Utilities</a>
        <span className="companion-crumb-separator" aria-hidden="true">/</span>
        <button type="button" className="companion-crumb-current" onClick={() => navigate('overview')} title="Companion overview"><span className="companion-emblem" aria-hidden="true">✦</span>Idle Slayer Companion</button>
      </nav>
      <div className="companion-header-note">
        {saveNote && <span className={`companion-save-note companion-save-${saveNote.tone}`} title={saveNote.full}><span className="companion-save-dot" aria-hidden="true" /><span className="companion-save-text">{saveNote.short}</span></span>}
        <span className="companion-unofficial">Unofficial</span>
        <button type="button" className="companion-data-button" onClick={onData}>Data</button>
      </div>
    </header>
    {navigationModal && <div className="companion-nav-scrim" aria-hidden="true" onClick={() => setMobileOpen(false)} />}
    <aside ref={sidebar} className={`companion-sidebar${navigationModal ? ' companion-sidebar-open' : ''}`} role={navigationModal ? 'dialog' : undefined} aria-modal={navigationModal ? true : undefined} aria-labelledby={navigationModal ? 'companion-navigation-title' : undefined}>
      <div className="companion-nav-caption"><span id="companion-navigation-title">Your companion</span><button className="companion-rail-toggle" type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!collapsed}><span aria-hidden="true">{collapsed ? '›' : '‹'}</span></button><button className="companion-nav-dismiss" type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation">×</button></div>
      <nav id="companion-navigation" className="companion-navigation" aria-label="Companion sections" ref={navigation}>
        {companionSections.map((item) => <button key={item.id} type="button" className={`companion-nav-item${section === item.id ? ' companion-nav-active' : ''}`} onClick={() => navigate(item.id)} aria-current={section === item.id ? 'page' : undefined} title={collapsed ? item.title : undefined}>
          <span className="companion-nav-symbol" aria-hidden="true">{item.symbol}</span><span className="companion-nav-label">{item.title}</span>
        </button>)}
      </nav>
      <div className="companion-sidebar-bottom">
        <div className="companion-local-note"><span aria-hidden="true">◉</span><span>Stored in this browser<small>Export a backup.</small></span></div>
        {onSettings && <button type="button" onClick={() => openFromNavigation(onSettings)} title={collapsed ? 'Privacy & tracking' : undefined}><span aria-hidden="true">⚙</span><span className="companion-nav-label">Privacy & tracking</span></button>}
        {onHelp && <button type="button" onClick={() => openFromNavigation(onHelp)} title={collapsed ? 'About & sources' : undefined}><span aria-hidden="true">?</span><span className="companion-nav-label">About & sources</span></button>}
        {onInstall && <button type="button" aria-label="Install & offline" onClick={() => openFromNavigation(onInstall)} title={collapsed ? pwaStatus.update ? 'Install & offline · Update ready' : 'Install & offline' : undefined}><span aria-hidden="true">↓</span><span className="companion-nav-label">Install & offline{pwaStatus.update && <small>Update ready</small>}</span></button>}
      </div>
    </aside>
    <main ref={content} id="companion-content" className="companion-content" tabIndex={-1} aria-label={current.title} inert={navigationModal}>
      {notice && <div className="companion-notice">{notice}</div>}
      {status && <div className="companion-session-status telemetry-private rr-block">{status}</div>}
      <div className="companion-map-container" hidden={section !== 'ascension'}>{ascension}</div>
      {section !== 'ascension' && children}
    </main>
  </div>
}
