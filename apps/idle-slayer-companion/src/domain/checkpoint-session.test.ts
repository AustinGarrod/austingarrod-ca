import { describe, expect, it } from 'vitest'
import { createCheckpointSession } from './checkpoint-session'
import { emptyCheckpoints, exportCheckpoints } from './checkpoints'
import { emptyProfile } from './types'
import type { ProfileLocks } from './profile-session'

const revision = 'catalog'
const locks: ProfileLocks = { request: async (_name, _options, callback) => callback({}) }
const doc = (id: string) => ({ ...emptyCheckpoints(), entries: [{ id, name: id, capturedRevision: revision, profile: emptyProfile(revision) }] })
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
function fixture(options: { text?: string; failRead?: boolean; failWrite?: boolean; locks?: ProfileLocks } = {}) {
  let text = options.text ?? null, readFails = !!options.failRead, writeFails = !!options.failWrite, count = 0, ids = 0
  const session = createCheckpointSession({ revision, id: () => `created-${++ids}`, locks: () => options.locks ?? locks, storage: () => ({ getItem: () => { if (readFails) throw new Error('private read'); return text }, setItem: (_key, value) => { if (writeFails) throw new Error('private write'); text = value; count++ } }) })
  session.initialize()
  return { session, text: () => text, writes: () => count, external: (value: string | null) => { text = value }, recoverRead: () => { readFails = false }, recoverWrite: () => { writeFails = false } }
}
describe('checkpoint collection coordination', () => {
  it('writes only deliberate references, snapshots the live getter, and keeps profile independent', async () => {
    const f = fixture(), profile = emptyProfile(revision)
    expect(f.writes()).toBe(0)
    f.session.capture('Named', () => profile, f.session.getState().version); profile.showSpoilers = true
    await settle()
    expect(f.session.getState().vault.entries[0].profile.showSpoilers).toBe(false)
    expect(f.session.getState()).toMatchObject({ saved: true, dirty: false })
    const entry = f.session.getState().vault.entries[0]
    expect(f.session.rename(entry.id, 'Renamed', f.session.getState().version)).toBe(true); await settle()
    expect(f.session.getState().vault.entries[0].name).toBe('Renamed')
    expect(f.session.remove(entry.id, f.session.getState().version)).toBe(true); await settle()
    expect(f.session.getState().vault.entries).toHaveLength(0)
  })
  it('refuses stale render commands after a clean adoption without overwriting the new collection', async () => {
    const f = fixture(), version = f.session.getState().version
    const newer = exportCheckpoints(doc('newer'), revision)!
    f.external(newer); f.session.refreshExternal()
    expect(f.session.capture('Stale', () => emptyProfile(revision), version)).toBe(false)
    expect(f.session.rename('newer', 'Stale', version)).toBe(false)
    expect(f.session.remove('newer', version)).toBe(false)
    expect(f.session.restore(emptyCheckpoints(), version)).toBe(false)
    await settle(); expect(f.text()).toBe(newer); expect(f.writes()).toBe(0)
    f.session.capture('Fresh', () => emptyProfile(revision), f.session.getState().version); await settle()
    expect(f.session.getState().vault.entries.map((entry) => entry.name)).toEqual(['newer', 'Fresh'])
  })
  it('checks the exact baseline inside the lock and retains dirty local references for explicit recovery', async () => {
    const f = fixture()
    f.external(exportCheckpoints(doc('external'), revision)!)
    f.session.capture('Local', () => emptyProfile(revision), f.session.getState().version); await settle()
    expect(f.session.getState()).toMatchObject({ conflict: true, saved: false })
    expect(f.writes()).toBe(0)
    const stale = f.session.getState().version
    f.external(exportCheckpoints(doc('newest'), revision)!)
    expect(f.session.useSaved(stale)).toBe(false)
    expect(await f.session.save(true, stale)).toBe(false)
    expect(f.session.useSaved(f.session.getState().version)).toBe(true)
    expect(f.session.getState().vault.entries[0].name).toBe('newest')
  })
  it('keeps write failures exportable, and retries without claiming a durable save', async () => {
    const f = fixture({ failWrite: true })
    f.session.capture('Local', () => emptyProfile(revision), f.session.getState().version); await settle()
    expect(f.session.getState()).toMatchObject({ dirty: true, saved: false, pending: false })
    expect(f.session.getState().error).not.toContain('private')
    expect(exportCheckpoints(f.session.getState().vault, revision)).not.toBeNull()
    f.recoverWrite(); expect(await f.session.save()).toBe(true)
  })
  it('does not overwrite corrupt/unreadable storage, including repeated recovery reads', async () => {
    const f = fixture({ text: 'private corrupt bytes' })
    f.session.refreshExternal(); expect(f.session.getState().conflict).toBe(true)
    f.session.capture('Local', () => emptyProfile(revision), f.session.getState().version); await settle()
    expect(f.text()).toBe('private corrupt bytes')
    expect(await f.session.save(true)).toBe(true)
    const g = fixture({ failRead: true })
    g.session.capture('Memory', () => emptyProfile(revision), g.session.getState().version); await settle()
    expect(await g.session.save(true)).toBe(false)
    g.recoverRead(); g.session.refreshExternal(); expect(await g.session.save(true)).toBe(true)
  })
  it('bounds count and invalid capture without changing the existing references', async () => {
    const f = fixture()
    for (let i = 0; i < 4; i++) { expect(f.session.capture(`Name ${i}`, () => emptyProfile(revision), f.session.getState().version)).toBe(true); await settle() }
    expect(f.session.capture('Fifth', () => emptyProfile(revision), f.session.getState().version)).toBe(false)
    expect(f.session.getState().vault.entries).toHaveLength(4)
    expect(f.session.rename('created-1', '', f.session.getState().version)).toBe(false)
    expect(f.session.getState().vault.entries[0].name).toBe('Name 0')
  })
  it('cancels pending writes on external change or disposal and refuses competing mutations', async () => {
    let callback!: (lock: unknown) => void
    const delayed: ProfileLocks = { request: (_name, _options, next) => new Promise((resolve) => { callback = (lock) => resolve(next(lock)) }) }
    const f = fixture({ locks: delayed })
    f.session.capture('Local', () => emptyProfile(revision), f.session.getState().version)
    expect(f.session.remove('created-1', f.session.getState().version)).toBe(false)
    f.external(exportCheckpoints(doc('external'), revision)!); f.session.refreshExternal(); callback({}); await settle()
    expect(f.writes()).toBe(0)
    const g = fixture({ locks: delayed })
    g.session.capture('Local', () => emptyProfile(revision), g.session.getState().version); g.session.cancelPending(); callback({}); await settle()
    expect(g.writes()).toBe(0)
  })
  it('fails closed when coordination is missing or held', async () => {
    for (const coordination of [undefined, { request: async (_name, _options, next) => next(null) } as ProfileLocks]) {
      let writes = 0
      const session = createCheckpointSession({ revision, id: () => 'one', storage: () => ({ getItem: () => null, setItem: () => { writes++ } }), locks: () => coordination })
      session.initialize(); session.capture('Memory', () => emptyProfile(revision), session.getState().version); await settle()
      expect(writes).toBe(0); expect(session.getState()).toMatchObject({ saved: false, pending: false, dirty: true })
    }
  })
})
