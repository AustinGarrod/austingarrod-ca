import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCompanionSession } from './domain/companion-session'
import { cleanDiagnosticEvent, cleanReportingURL } from './reporting'

afterEach(() => vi.unstubAllGlobals())
describe('persistence diagnostic boundary', () => {
  it('retains the original error and operation while preserving recoverable progress', () => {
    const cause = new DOMException('Quota denied by browser policy', 'SecurityError')
    const onFailure = vi.fn()
    const session = createCompanionSession({ revision: 'test', locks: () => undefined,
      storage: () => { throw cause }, onFailure })
    session.initialize()
    expect(onFailure).toHaveBeenCalledWith(cause, 'storage.read')
    expect(session.getState().errorKind).toBe('storage-read')
    expect(session.getState().progress.ascension).toBeDefined()
  })
  it('keeps storage recovery working when the diagnostics observer throws', () => {
    const session = createCompanionSession({ revision: 'test', locks: () => undefined,
      storage: () => { throw new Error('Storage unavailable') }, onFailure: () => { throw new Error('Observer unavailable') } })
    expect(() => session.initialize()).not.toThrow()
    expect(session.getState().errorKind).toBe('storage-read')
  })
})

it('keeps portable backup contents out of errors, breadcrumbs and trace URLs', () => {
  const url = 'https://example.test/idle-slayer-companion/?payload=private#transfer=private'
  const event = cleanDiagnosticEvent({ request: { url }, breadcrumbs: [{ data: { from: url, to: url } }],
    contexts: { trace: { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16), data: { 'url.full': url, 'url.fragment': 'transfer=private' } } },
    spans: [{ trace_id: 'a'.repeat(32), span_id: 'c'.repeat(16), start_timestamp: 1, timestamp: 2, status: 'ok', data: { 'http.url': url, 'url.query': 'payload=private' } }] })
  expect(JSON.stringify(event)).not.toContain('private')
  expect(event.spans![0].data?.['http.url']).toBe('https://example.test/idle-slayer-companion/')
  expect(cleanReportingURL('data:text/plain,private')).toBe('[data: resource]')
})
