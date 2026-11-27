import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

export interface MenuItem {
  label: string
  /** A short second line, for example why an action is not available yet. */
  note?: string
  onSelect: () => void
  disabled?: boolean
  /** Keeps exact accessible names stable when the visible label carries extra words. */
  ariaLabel?: string
}

const focusable = (root: HTMLElement | null) => [...(root?.querySelectorAll<HTMLElement>('button:not(:disabled):not([aria-disabled="true"]), input:not(:disabled), select:not(:disabled), textarea, a[href]') ?? [])]

function usePopup() {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<'first' | 'last' | null>(null)
  useEffect(() => {
    if (!open) return
    if (pendingFocus.current) { const items = focusable(popup.current); (pendingFocus.current === 'first' ? items[0] : items.at(-1))?.focus(); pendingFocus.current = null }
    // A press outside closes the popup without moving focus back, so the press keeps its own target.
    const outside = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])
  function show(focus: 'first' | 'last') { pendingFocus.current = focus; setOpen(true) }
  function close(returnFocus = true) { setOpen(false); if (returnFocus) button.current?.focus({ preventScroll: true }) }
  return { open, setOpen, button, popup, wrapper, show, close }
}

/**
 * A small action disclosure (a button that shows a short list of ordinary buttons, the disclosure
 * pattern rather than an ARIA menu, so each action keeps its button role). Enter, Space or Arrow Down
 * opens it on the first action, Arrow Up on the last; arrows, Home and End move between actions as
 * well as Tab; Escape closes it and returns focus to the button, and a press outside closes it.
 * Choosing an action closes the list, returns focus to the button (so a dialog it opens returns
 * there too), then runs the action.
 */
export function MenuButton({ label, buttonLabel, items, className, icon }: { label: string; buttonLabel?: string; items: (MenuItem | null | false)[]; className?: string; icon?: ReactNode }) {
  const id = useId()
  const menu = usePopup()
  const available = items.filter((item): item is MenuItem => Boolean(item))
  function onButtonKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); menu.show('first') }
    else if (event.key === 'ArrowUp') { event.preventDefault(); menu.show('last') }
  }
  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const entries = focusable(menu.popup.current), index = entries.indexOf(document.activeElement as HTMLElement)
    const move = (next: number) => { event.preventDefault(); entries[(next + entries.length) % entries.length]?.focus() }
    if (event.key === 'ArrowDown') move(index + 1)
    else if (event.key === 'ArrowUp') move(index - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(entries.length - 1)
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.close() }
  }
  return <div className={`menu-button${className ? ' ' + className : ''}`} ref={menu.wrapper} onBlur={(event) => { if (menu.open && event.relatedTarget && !menu.wrapper.current?.contains(event.relatedTarget as Node)) menu.setOpen(false) }}>
    <button type="button" ref={menu.button} aria-label={buttonLabel} aria-expanded={menu.open} aria-controls={menu.open ? id : undefined} onClick={() => { if (menu.open) menu.setOpen(false); else menu.show('first') }} onKeyDown={onButtonKey}>{icon}{label}<span className="menu-button-caret" aria-hidden="true">▾</span></button>
    {menu.open && <div className="menu-popup" role="group" id={id} aria-label={buttonLabel ?? label} ref={menu.popup} onKeyDown={onMenuKey}>
      {available.map((item, index) => <button type="button" key={item.label} aria-label={item.ariaLabel} aria-describedby={item.note ? `${id}-note-${index}` : undefined} disabled={item.disabled} onClick={() => { if (item.disabled) return; menu.close(); item.onSelect() }}>
        <span>{item.label}</span>{item.note && <small id={`${id}-note-${index}`}>{item.note}</small>}
      </button>)}
    </div>}
  </div>
}

/**
 * A popover of ordinary controls (checkboxes, toggles, buttons). Same open, close and focus-return
 * behaviour as MenuButton, but its children keep their native roles.
 */
export function PopoverButton({ label, buttonLabel, children, className }: { label: string; buttonLabel?: string; children: (close: () => void) => ReactNode; className?: string }) {
  const id = useId()
  const popover = usePopup()
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); popover.close() }
  }
  return <div className={`menu-button${className ? ' ' + className : ''}`} ref={popover.wrapper} onBlur={(event) => { if (popover.open && !popover.wrapper.current?.contains(event.relatedTarget as Node | null) && event.relatedTarget) popover.setOpen(false) }}>
    <button type="button" ref={popover.button} aria-label={buttonLabel} aria-expanded={popover.open} aria-controls={popover.open ? id : undefined} onClick={() => { if (popover.open) popover.setOpen(false); else popover.show('first') }} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); popover.show('first') } }}>{label}<span className="menu-button-caret" aria-hidden="true">▾</span></button>
    {popover.open && <div className="menu-popup menu-popover" role="group" aria-label={buttonLabel ?? label} id={id} ref={popover.popup} onKeyDown={onKey}>{children(() => popover.close())}</div>}
  </div>
}
