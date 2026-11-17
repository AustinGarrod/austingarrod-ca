import { describe, expect, it } from 'vitest'
import type { DocumentStorage } from '../account-repository'
import { createProfileSession, type ProfileLocks } from './profile-session'
import { PROFILE_STORAGE_KEY } from './storage'
import { emptyProfile } from './types'
import { createCompanionSession } from './companion-session'
import { emptyCompanionProgress } from './companion-progress'
import { COMPANION_STORAGE_KEY, exportCompanionStored } from './companion-storage'
import { createCompanionWorkspaceSession, emptyCompanionWorkspace, COMPANION_WORKSPACE_KEY } from './companion-workspace'
import { createCheckpointSession } from './checkpoint-session'
import { CHECKPOINT_STORAGE_KEY, emptyCheckpoints } from './checkpoints'
import { createComparisonSession } from './comparison-session'
import { COMPARISON_STORAGE_KEY, emptyComparison } from './saved-comparison'

const revision = 'async-fixture'
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0))
const locks: ProfileLocks = { request: async (_name, _options, callback) => callback({}) }

function deferredStorage(key: string, initial: string) {
  const values = new Map([[key, initial]])
  const pending: Array<{ commit(): void; reject(error: Error): void }> = []
  const storage: DocumentStorage = {
    getItem: name => values.get(name) ?? null,
    setItem: (name, value) => new Promise<void>((resolve, reject) => {
      pending.push({ commit: () => { values.set(name, value); resolve() }, reject })
    }),
  }
  return { storage, pending, text: () => values.get(key) }
}

interface Subject {
  edit(): boolean
  save(): Promise<boolean>
  cancel(): void
  state(): { pending: boolean; dirty: boolean; saved: boolean }
}
interface Port { name: string; key: string; initial(): string; subject(storage: DocumentStorage): Subject }
const ports: Port[] = [
  {
    name: 'map profile', key: PROFILE_STORAGE_KEY, initial: () => JSON.stringify(emptyProfile(revision)),
    subject(storage) {
      const session = createProfileSession({ revision, storage: () => storage, locks: () => locks }); session.initialize()
      return {
        edit: () => session.apply({ ...session.getState().profile, epoch: 1 }), save: () => session.save(), cancel: () => session.cancelPending(),
        state: () => { const state = session.getState(); return { pending: state.pending, dirty: state.dirty, saved: state.persistence === 'saved' } },
      }
    },
  },
  {
    name: 'Companion progress', key: COMPANION_STORAGE_KEY,
    initial: () => { const result = exportCompanionStored({ progress: emptyCompanionProgress(revision), legacyBaseline: null }); if (!result.ok) throw new Error('Invalid fixture'); return result.value },
    subject(storage) {
      const session = createCompanionSession({ revision, storage: () => storage, locks: () => locks }); session.initialize()
      return {
        edit: () => session.applyCompanion({ ...session.getState().progress, ascension: { ...session.getState().progress.ascension, epoch: 1 } }),
        save: () => session.save(), cancel: () => session.cancelPending(),
        state: () => { const state = session.getState(); return { pending: state.pending, dirty: state.dirty, saved: state.persistence === 'saved' } },
      }
    },
  },
  {
    name: 'intentions', key: COMPANION_WORKSPACE_KEY, initial: () => JSON.stringify(emptyCompanionWorkspace()),
    subject(storage) {
      const session = createCompanionWorkspaceSession({ storage: () => storage, locks: () => locks }); session.initialize()
      return {
        edit: () => session.edit({ ...session.getState().workspace, recipePlans: { fixture: '2' } }), save: () => session.save(), cancel: () => session.cancelPending(),
        state: () => { const state = session.getState(); return { pending: state.pending, dirty: state.dirty, saved: !state.pending && !state.dirty && state.error === '' } },
      }
    },
  },
  {
    name: 'checkpoint vault', key: CHECKPOINT_STORAGE_KEY, initial: () => JSON.stringify(emptyCheckpoints()),
    subject(storage) {
      const session = createCheckpointSession({ revision, storage: () => storage, locks: () => locks, id: () => 'async-checkpoint' }); session.initialize()
      return {
        edit: () => session.capture('Deferred snapshot', () => emptyProfile(revision), session.getState().version), save: () => session.save(), cancel: () => session.cancelPending(),
        state: () => { const state = session.getState(); return { pending: state.pending, dirty: state.dirty, saved: state.saved } },
      }
    },
  },
  {
    name: 'saved comparison', key: COMPARISON_STORAGE_KEY, initial: () => JSON.stringify(emptyComparison()),
    subject(storage) {
      const session = createComparisonSession({ storage: () => storage, locks: () => locks }); session.initialize()
      return {
        edit: () => session.edit({ kind: 'upgrade-comparison', version: 1, ids: ['deferred'] }), save: () => session.save(), cancel: () => session.cancelPending(),
        state: () => { const state = session.getState(); return { pending: state.pending, dirty: state.dirty, saved: state.saved } },
      }
    },
  },
]

for (const port of ports) {
  describe(`${port.name} asynchronous durability`, () => {
    it('reports pending until durable success, then acknowledges the saved state', async () => {
      const initial = port.initial(), fixture = deferredStorage(port.key, initial), subject = port.subject(fixture.storage)
      expect(subject.edit()).toBe(true)
      await settle()
      expect(fixture.pending).toHaveLength(1)
      expect(subject.state()).toEqual({ pending: true, dirty: true, saved: false })
      expect(fixture.text()).toBe(initial)
      fixture.pending.shift()!.commit()
      await settle()
      expect(subject.state()).toEqual({ pending: false, dirty: false, saved: true })
      expect(fixture.text()).not.toBe(initial)
    })

    it('retains the old durable baseline after rejection and can retry the same in-memory edit', async () => {
      const initial = port.initial(), fixture = deferredStorage(port.key, initial), subject = port.subject(fixture.storage)
      expect(subject.edit()).toBe(true)
      await settle()
      fixture.pending.shift()!.reject(new Error('Synthetic delayed transaction abort'))
      await settle()
      expect(subject.state()).toEqual({ pending: false, dirty: true, saved: false })
      expect(fixture.text()).toBe(initial)
      const retry = subject.save()
      await settle()
      expect(fixture.pending).toHaveLength(1)
      expect(subject.state()).toEqual({ pending: true, dirty: true, saved: false })
      fixture.pending.shift()!.commit()
      expect(await retry).toBe(true)
      expect(subject.state()).toEqual({ pending: false, dirty: false, saved: true })
    })

    it('does not publish Saved from a canceled generation even if its transaction later commits', async () => {
      const initial = port.initial(), fixture = deferredStorage(port.key, initial), subject = port.subject(fixture.storage)
      expect(subject.edit()).toBe(true)
      await settle()
      subject.cancel()
      expect(subject.state()).toEqual({ pending: false, dirty: true, saved: false })
      fixture.pending.shift()!.commit()
      await settle()
      expect(subject.state()).toEqual({ pending: false, dirty: true, saved: false })
      expect(fixture.text()).not.toBe(initial)
    })
  })
}
