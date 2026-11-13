import { describe, expect, it } from 'vitest'
import { compareProgress, progressBackupFilename } from './progress-comparison'
import { emptyProfile, type Catalog, type Upgrade } from './types'

const node = (id: string, extra: Partial<Upgrade> = {}): Upgrade => ({ id, title: 'Same title', description: '', cost: '1000000000000000000001', icon: '', position: { x: 0, y: 0 }, purchase: { kind: 'always' }, reveal: { kind: 'always' }, retention: 'repeat', activation: 'immediate', sources: [], ...extra })
const catalog: Catalog = { revision: 'fixture', gameVersion: 'test', steamBuild: 'test', startId: 'start', upgrades: [node('start'), node('other'), node('lock', { activation: 'after-ultra-ascension' }), node('secret', { reveal: { kind: 'owned', id: 'other' } })], milestones: [{ id: 'item', title: 'Item', description: '', reveal: { kind: 'always' }, sources: [] }, { id: 'secret-item', title: 'Secret item', description: '', reveal: { kind: 'owned', id: 'other' }, sources: [] }], connections: [], grants: [], ultraAscension: { kind: 'always' }, verification: { coverage: false, purchaseRules: false, revealRules: false, resetRules: false, assets: false, evidence: [] } }
const fresh = () => emptyProfile(catalog.revision)
describe('visible replacement differences', () => {
  it('identifies a same-count purchase exchange by stable ID without mutating profiles', () => {
    const current = fresh(), incoming = fresh()
    current.purchases.start = { epoch: 0, active: true }; incoming.purchases.other = { epoch: 0, active: true }
    const before = structuredClone({ current, incoming })
    const changes = compareProgress(catalog, current, incoming)
    expect(changes.upgrades.map((row) => [row.upgrade.id, !!row.before, !!row.after])).toEqual([['start', true, false], ['other', false, true]])
    expect({ current, incoming }).toEqual(before)
  })
  it('reports activation and retained ownership baseline changes without conflating ownership', () => {
    const current = fresh(), incoming = fresh(); current.epoch = incoming.epoch = 2
    current.purchases.lock = { epoch: 1, active: false }; incoming.purchases.lock = { epoch: 0, active: true }
    expect(compareProgress(catalog, current, incoming).upgrades[0]).toMatchObject({ upgrade: { id: 'lock' }, before: { epoch: 1, active: false }, after: { epoch: 0, active: true } })
  })
  it('withholds incoming-revealed identities and every unknown ID from the current hidden-spoiler view', () => {
    const current = fresh(), incoming = fresh(); incoming.showSpoilers = true
    incoming.purchases = { other: { epoch: 0, active: true }, secret: { epoch: 0, active: true }, 'future-private': { epoch: 0, active: true } }; incoming.milestones = { item: true, 'secret-item': true, 'future-milestone': true }
    const changes = compareProgress(catalog, current, incoming)
    expect(changes.upgrades.map((row) => row.upgrade.id)).toEqual(['other'])
    expect(changes.milestones.map((row) => row.milestone.id)).toEqual(['item'])
    expect(JSON.stringify(changes)).not.toContain('secret')
    expect(JSON.stringify(changes)).not.toContain('future-')
  })
  it('uses an explicit viewer when reviewing replacement of an external saved profile', () => {
    const current = fresh(), local = fresh(); current.showSpoilers = true; current.purchases.secret = { epoch: 0, active: true }
    expect(compareProgress(catalog, current, local, local).upgrades).toEqual([])
    local.showSpoilers = true
    expect(compareProgress(catalog, current, local, local).upgrades.map((row) => row.upgrade.id)).toEqual(['secret'])
  })
  it('omits unchanged records and reports milestone removal', () => {
    const current = fresh(), incoming = fresh(); current.purchases.start = incoming.purchases.start = { epoch: 0, active: true }; current.milestones.item = true
    expect(compareProgress(catalog, current, incoming)).toMatchObject({ upgrades: [], milestones: [{ before: true, after: false }] })
  })
  it('adds UTC snapshot context to the filename without changing backup contents', () => {
    const current = fresh(); current.epoch = 12
    expect(progressBackupFilename(current, new Date('2026-10-07T08:23:45.123Z'))).toBe('idle-slayer-progress-20261007T082345Z-ua12.json')
  })
})
