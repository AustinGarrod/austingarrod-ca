import { describe, expect, it } from 'vitest'
import { createComparisonSession } from './comparison-session'
import { emptyComparison, exportComparison } from './saved-comparison'
import type { ProfileLocks } from './profile-session'

const list = (ids: string[]) => ({ ...emptyComparison(), ids })
const locks: ProfileLocks = { request: async (_name, _options, callback) => callback({}) }
function fixture(options: { text?: string | null; readFails?: boolean; writeFails?: boolean; locks?: ProfileLocks } = {}) {
  let text = options.text ?? null, writes = 0, readFails = !!options.readFails, writeFails = !!options.writeFails
  const session = createComparisonSession({ storage: () => ({ getItem: () => { if (readFails) throw new Error('read'); return text }, setItem: (_key, value) => { if (writeFails) throw new Error('write'); text = value; writes++ } }), locks: () => options.locks ?? locks })
  session.initialize()
  return { session, text: () => text, writes: () => writes, external: (value: string | null) => { text = value }, readable: () => { readFails = false }, writable: () => { writeFails = false } }
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('independent comparison session', () => {
  it('does not write at startup; persists only reference edits', async () => {
    const f = fixture()
    expect(f.writes()).toBe(0)
    expect(f.session.edit(list(['one']))).toBe(true)
    await settle()
    expect(f.text()).toBe(exportComparison(list(['one'])))
    expect(f.session.getState()).toMatchObject({ saved: true, dirty: false, pending: false })
  })
  it('adopts clean external updates and clear without writing back', () => {
    const f = fixture({ text: exportComparison(list(['one'])) })
    f.external(exportComparison(list(['two']))); f.session.refreshExternal()
    expect(f.session.getState().list.ids).toEqual(['two'])
    f.external(null); f.session.refreshExternal()
    expect(f.session.getState().list.ids).toEqual([])
    expect(f.writes()).toBe(0)
  })
  it('keeps memory after write failure and retries the accepted baseline', async () => {
    const f = fixture({ writeFails: true })
    f.session.edit(list(['one'])); await settle()
    expect(f.session.getState()).toMatchObject({ dirty: true, saved: false, list: list(['one']) })
    expect(f.text()).toBeNull()
    f.writable(); expect(await f.session.save()).toBe(true)
  })
  it('never overwrites corrupt or unavailable storage without deliberate recovery', async () => {
    const f = fixture({ text: 'private malformed bytes' })
    f.session.edit(list(['one'])); await settle()
    expect(f.text()).toBe('private malformed bytes')
    expect(f.session.getState().error).not.toContain('private')
    expect(await f.session.save(true, f.session.getState().version)).toBe(true)
    const unreadable = fixture({ readFails: true })
    unreadable.session.edit(list(['two'])); await settle()
    expect(await unreadable.session.save(true)).toBe(false)
    unreadable.readable(); unreadable.session.refreshExternal()
    expect(unreadable.session.getState().list.ids).toEqual(['two'])
    expect(await unreadable.session.save(true)).toBe(true)
  })
  it('rechecking unchanged corrupt storage keeps explicit recovery available', async () => {
    const f = fixture({ text: 'still corrupt' })
    f.session.refreshExternal()
    expect(f.session.getState()).toMatchObject({ conflict: true, canUseSaved: false, savedList: null })
    expect(f.writes()).toBe(0)
    f.session.edit(list(['local'])); await settle()
    expect(await f.session.save(true)).toBe(true)
    expect(f.text()).toBe(exportComparison(list(['local'])))
  })
  it('checks exact stored baseline inside the lock before any write', async () => {
    const f = fixture()
    f.external(exportComparison(list(['external'])))
    f.session.edit(list(['local'])); await settle()
    expect(f.session.getState()).toMatchObject({ conflict: true, list: list(['local']), pending: false })
    expect(f.writes()).toBe(0)
    expect(f.session.useSaved(f.session.getState().version)).toBe(true)
    expect(f.session.getState().list.ids).toEqual(['external'])
  })
  it('rejects stale conflict confirmations and newly changed saved text', async () => {
    const f = fixture({ writeFails: true })
    f.session.edit(list(['local'])); await settle()
    f.external(exportComparison(list(['external']))); f.session.refreshExternal()
    const version = f.session.getState().version
    f.external(exportComparison(list(['newer'])))
    expect(f.session.useSaved(version)).toBe(false)
    f.writable()
    expect(await f.session.save(true, version)).toBe(false)
    const fresh = f.session.getState().version
    expect(await f.session.save(true, fresh)).toBe(true)
    expect(f.text()).toBe(exportComparison(list(['local'])))
  })
  it('refuses held or missing locks, keeping an exportable memory comparison', async () => {
    for (const coordination of [{ request: async (_name, _options, callback) => callback(null) } as ProfileLocks, undefined]) {
      let writes = 0
      const session = createComparisonSession({ storage: () => ({ getItem: () => null, setItem: () => { writes++ } }), locks: () => coordination })
      session.initialize(); session.edit(list(['one'])); await settle()
      expect(session.getState()).toMatchObject({ list: list(['one']), saved: false, pending: false })
      expect(writes).toBe(0)
      expect(exportComparison(session.getState().list)).toContain('one')
    }
  })
  it('invalidates delayed writes on external change or disposal and blocks competing edits', async () => {
    let callback: ((lock: unknown) => unknown) | undefined
    const delayed: ProfileLocks = { request: (_name, _options, fn) => new Promise((resolve) => { callback = (lock) => resolve(fn(lock)) }) }
    const f = fixture({ locks: delayed })
    f.session.edit(list(['local']))
    expect(f.session.edit(list(['competing']))).toBe(false)
    f.external(exportComparison(list(['external']))); f.session.refreshExternal(); callback!({}); await settle()
    expect(f.writes()).toBe(0)
    expect(f.session.getState().list.ids).toEqual(['local'])
    const g = fixture({ locks: delayed })
    g.session.edit(list(['cancelled'])); g.session.cancelPending(); callback!({}); await settle()
    expect(g.writes()).toBe(0)
  })
})
