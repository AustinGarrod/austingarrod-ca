import { describe, expect, it } from 'vitest'
import { createProgressTransferInbox } from './progress-transfer-inbox'

function browser(hash = '') {
  const target = new EventTarget()
  let address = new URL(`https://example.test/map/${hash}`)
  const win = Object.assign(target, {
    get location() { return address },
    history: { state: null, replaceState: (_state: unknown, _title: string, path: string) => { address = new URL(path, address) } },
  }) as unknown as Window
  // Object.assign invokes getters, so keep location live across cleanup.
  Object.defineProperty(win, 'location', { get: () => address })
  const event = (type: 'hashchange' | 'popstate', newURL = address.href) => {
    const event = new Event(type)
    Object.defineProperty(event, 'newURL', { value: newURL })
    win.dispatchEvent(event)
  }
  return { win, event, navigate: (hash: string) => { address = new URL(hash, address); return address.href } }
}

describe('bootstrap transfer inbox', () => {
  it('keeps only the latest valid or malformed arrival until loading finishes', () => {
    const { win, event, navigate } = browser('#transfer=v1.START')
    const inbox = createProgressTransferInbox(win)
    expect(win.location.hash).toBe('')
    navigate('#transfer=v1.LATEST'); event('hashchange')
    expect(win.location.hash).toBe('')
    expect(inbox.take()).toEqual({ capture: { cleaned: true, token: 'v1.LATEST' } })
    expect(inbox.take()).toBeNull()
    navigate('#transfer=v1.invalid'); event('hashchange')
    expect(inbox.take()).toEqual({ capture: { cleaned: true, token: 'v1.invalid' } })
    inbox.dispose()
  })
  it('cancels a queued startup transfer on hash or history navigation away', () => {
    for (const type of ['hashchange', 'popstate'] as const) {
      const { win, event, navigate } = browser('#transfer=v1.START')
      const inbox = createProgressTransferInbox(win)
      navigate('#elsewhere'); event(type)
      expect(inbox.take()).toEqual({ capture: null })
      inbox.dispose()
    }
  })
  it('captures the current arrival before a later sanitizer even with queued older hash events', () => {
    const { win, event, navigate } = browser()
    const inbox = createProgressTransferInbox(win)
    win.addEventListener('hashchange', () => { win.history.replaceState(null, '', '/map/') })
    const older = navigate('#transfer=v1.OLDER')
    const latest = navigate('#transfer=v1.LATEST')
    event('hashchange', older)
    event('hashchange', latest)
    expect(inbox.take()).toEqual({ capture: { cleaned: true, token: 'v1.LATEST' } })
    inbox.dispose()
  })
  it('notifies the loaded consumer and drops payloads when consumed or disposed', () => {
    const { win, event, navigate } = browser()
    const inbox = createProgressTransferInbox(win)
    const delivered: unknown[] = []
    const unsubscribe = inbox.subscribe(() => { delivered.push(inbox.take()) })
    navigate('#transfer=v1.A'); event('hashchange')
    navigate('#elsewhere'); event('hashchange')
    expect(delivered).toEqual([{ capture: { cleaned: true, token: 'v1.A' } }, { capture: null }])
    unsubscribe()
    navigate('#transfer=v1.B'); event('hashchange')
    inbox.dispose()
    expect(inbox.take()).toBeNull()
    navigate('#transfer=v1.C'); event('hashchange')
    expect(win.location.hash).toBe('#transfer=v1.C')
  })
  it('fails closed before analytics and queues only fixed recovery text if cleanup fails', () => {
    const { win } = browser('#transfer=v1.PRIVATE')
    win.history.replaceState = () => { throw new Error('PRIVATE') }
    const inbox = createProgressTransferInbox(win)
    expect(inbox.trackingSafe).toBe(false)
    const arrival = inbox.take()
    expect(arrival).toMatchObject({ capture: { cleaned: false, error: expect.stringContaining('Tracking was kept off') } })
    expect(JSON.stringify(arrival)).not.toContain('PRIVATE')
    inbox.dispose()
  })
})
