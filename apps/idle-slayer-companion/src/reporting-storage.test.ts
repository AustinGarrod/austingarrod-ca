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
  it('waits for an asynchronous write and rethrows the original rejection without recording stored text', async () => {
    const cause = new DOMException('Synthetic IDB abort', 'AbortError')
    let reject!: (error: unknown) => void
    const native = { getItem: () => 'old private data', setItem: () => new Promise<void>((_resolve, fail) => { reject = fail }) }
    const storage = diagnosticStorage('progress', () => native)()
    vi.mocked(reportFailure).mockClear()
    let settled = false
    const write = Promise.resolve(storage.setItem('key', 'private snapshot')).finally(() => { settled = true })
    const assertion = expect(write).rejects.toBe(cause)
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(reportFailure).not.toHaveBeenCalled()
    reject(cause)
    await assertion
    expect(settled).toBe(true)
    expect(reportFailure).toHaveBeenCalledExactlyOnceWith(cause, 'storage.write', { document: 'progress', bytes: 16 })
  })
  it('keeps a successful asynchronous write pending until its durable promise resolves', async () => {
    let commit!: () => void
    const native = { getItem: () => null, setItem: () => new Promise<void>(resolve => { commit = resolve }) }
    const storage = diagnosticStorage('comparison', () => native)()
    vi.mocked(reportFailure).mockClear()
    let settled = false
    const write = Promise.resolve(storage.setItem('key', 'private reference')).then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    commit(); await write
    expect(settled).toBe(true)
    expect(reportFailure).not.toHaveBeenCalled()
  })
})
