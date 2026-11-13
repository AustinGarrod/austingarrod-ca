import { describe, expect, it, vi } from 'vitest'
import { diagnosticStorage } from './reporting-storage'
import { reportFailure } from './reporting'
vi.mock('./reporting', () => ({ reportFailure: vi.fn() }))

describe('diagnostic browser storage adapter', () => {
  it('rethrows the same write exception and reports metadata without stored text', () => {
    const cause = new DOMException('Storage quota exceeded', 'QuotaExceededError')
    const native = { getItem: () => 'private snapshot', setItem: () => { throw cause } } as unknown as Storage
    const storage = diagnosticStorage('checkpoints', () => native)()
    expect(storage.getItem('key')).toBe('private snapshot')
    expect(() => storage.setItem('key', 'private snapshot')).toThrow(cause)
    expect(reportFailure).toHaveBeenLastCalledWith(cause, 'storage.write', { document: 'checkpoints', bytes: 16 })
  })
  it('reports original failures obtaining storage and reading it', () => {
    const cause = new DOMException('Storage disabled', 'SecurityError')
    expect(() => diagnosticStorage('intentions', () => { throw cause })()).toThrow(cause)
    expect(reportFailure).toHaveBeenLastCalledWith(cause, 'storage.access', { document: 'intentions' })
    const storage = diagnosticStorage('intentions', () => ({ getItem: () => { throw cause } }) as unknown as Storage)()
    expect(() => storage.getItem('key')).toThrow(cause)
    expect(reportFailure).toHaveBeenLastCalledWith(cause, 'storage.read', { document: 'intentions' })
  })
})
