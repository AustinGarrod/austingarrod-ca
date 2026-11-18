import { describe, expect, it } from 'vitest'
import { visibleProgress } from './progress-summary'
import { emptyProfile, type Catalog, type Upgrade } from './types'

// Synthetic reveal gates exercise disclosure independently of real player progress.
const upgrade = (id: string, extra: Partial<Upgrade> = {}): Upgrade => ({
  id, title: id, description: '', cost: '1', icon: '', position: { x: 0, y: 0 },
  purchase: { kind: 'always' }, reveal: { kind: 'always' }, retention: 'repeat', activation: 'immediate', sources: [], ...extra,
})
const gate = { kind: 'owned', id: 'gate' } as const
const catalog: Catalog = {
  revision: 'fixture', gameVersion: 'test', steamBuild: 'test', startId: 'start',
  upgrades: [upgrade('start'), upgrade('gate'), upgrade('hidden', { reveal: gate }),
    upgrade('active-lock', { activation: 'after-ultra-ascension' }),
    upgrade('pending-lock', { activation: 'after-ultra-ascension' }),
    upgrade('hidden-lock', { reveal: gate, activation: 'after-ultra-ascension' })],
  milestones: [{ id: 'visible-item', title: 'Visible item', description: '', reveal: { kind: 'always' }, sources: [] },
    { id: 'hidden-item', title: 'Hidden item', description: '', reveal: gate, sources: [] }],
  connections: [], grants: [], ultraAscension: { kind: 'always' },
  verification: { coverage: false, purchaseRules: false, revealRules: false, resetRules: false, assets: false, evidence: [] },
}

describe('visible replacement summaries', () => {
  for (const backupSpoilerPolicy of [false, true]) {
    for (const currentSpoilerPolicy of [false, true]) {
      it(`uses current spoilers ${currentSpoilerPolicy} rather than backup spoilers ${backupSpoilerPolicy}, retaining every record`, () => {
        const incoming = emptyProfile(catalog.revision)
        incoming.showSpoilers = backupSpoilerPolicy
        incoming.purchases = {
          start: { epoch: 0, active: true }, hidden: { epoch: 0, active: true },
          'active-lock': { epoch: 0, active: true }, 'pending-lock': { epoch: 0, active: false },
          'hidden-lock': { epoch: 0, active: false }, 'future-upgrade': { epoch: 0, active: true },
        }
        incoming.milestones = { 'visible-item': true, 'hidden-item': true, 'future-item': true }
        const original = structuredClone(incoming)
        expect(visibleProgress(catalog, incoming, currentSpoilerPolicy)).toEqual({
          owned: currentSpoilerPolicy ? 5 : 3,
          activeLocks: 1,
          pendingLocks: currentSpoilerPolicy ? 2 : 1,
          milestones: currentSpoilerPolicy ? 2 : 1,
        })
        expect(incoming).toEqual(original)
      })
    }
  }

  it('evaluates reveal rules from the summarized incoming progress', () => {
    const incoming = emptyProfile(catalog.revision)
    incoming.purchases = { gate: { epoch: 0, active: true }, hidden: { epoch: 0, active: true } }
    incoming.milestones = { 'hidden-item': true }
    expect(visibleProgress(catalog, incoming, false)).toEqual({ owned: 2, activeLocks: 0, pendingLocks: 0, milestones: 1 })
  })
})
