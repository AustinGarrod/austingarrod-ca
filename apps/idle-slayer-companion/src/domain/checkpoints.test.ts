import { describe, expect, it } from 'vitest'
import catalogData from '../../public/catalog.json'
import type { Catalog } from './types'
import { emptyProfile } from './types'
import { checkpointName, emptyCheckpoints, exportCheckpoints, MAX_CHECKPOINT_BYTES, parseCheckpoints } from './checkpoints'

const catalog = catalogData as Catalog
const revision = catalog.revision
const profile = { ...emptyProfile('older-catalog'), purchases: { 'future-upgrade': { epoch: 0, active: false } }, milestones: { 'future-milestone': true as const } }
const vault = () => ({ ...emptyCheckpoints(), entries: [{ id: 'checkpoint-one', name: ' Before reset ', capturedRevision: 'older-catalog', profile }] })
describe('normalized checkpoint facts and portable collection', () => {
  it('migrates snapshot revision, preserving original context and all unknown records', () => {
    const result = parseCheckpoints(JSON.stringify(vault()), revision)!
    expect(result.entries[0]).toMatchObject({ name: 'Before reset', capturedRevision: 'older-catalog', profile: { catalogRevision: revision, purchases: profile.purchases, milestones: profile.milestones } })
    expect(parseCheckpoints(exportCheckpoints(result, revision)!, revision)).toEqual(result)
    expect(profile.catalogRevision).toBe('older-catalog')
  })
  it('accepts only deliberate bounded names and normalizes whitespace and Unicode', () => {
    expect(checkpointName('  Before   reset  ')).toBe('Before reset')
    expect(checkpointName('e\u0301')).toBe('é')
    for (const name of ['', '  ', 'x'.repeat(65), 'line\nnext', '\u0000secret']) expect(checkpointName(name)).toBeNull()
  })
  it('rejects active-profile backups, unsupported versions, duplicate identities and operation metadata', () => {
    const source = vault()
    for (const value of [null, [], profile, { ...source, version: 2 }, { ...source, history: ['ultra_ascension'] }, { ...source, entries: [...source.entries, source.entries[0]] },
      { ...source, entries: Array.from({ length: 5 }, (_, i) => ({ ...source.entries[0], id: `slot-${i}` })) },
      { ...source, entries: [{ ...source.entries[0], date: 'gameplay date' }] }, { ...source, entries: [{ ...source.entries[0], id: '__proto__' }] },
      { ...source, entries: [{ ...source.entries[0], profile: { ...profile, purchases: { malformed: { epoch: 2, active: true } } } }] }]) expect(parseCheckpoints(JSON.stringify(value), revision)).toBeNull()
    expect(parseCheckpoints('{', revision)).toBeNull()
  })
  it('applies the aggregate UTF-8 and canonical-size bound without dropping unknown IDs', () => {
    expect(parseCheckpoints(' '.repeat(MAX_CHECKPOINT_BYTES + 1), revision)).toBeNull()
    const bigProfile = emptyProfile(revision)
    for (let i = 0; i < 16000; i++) bigProfile.purchases[`future-${i}-${'x'.repeat(90)}`] = { epoch: 0, active: true }
    const source = { ...emptyCheckpoints(), entries: [{ id: 'large', name: 'Large', capturedRevision: revision, profile: bigProfile }, { id: 'large-two', name: 'Large two', capturedRevision: revision, profile: bigProfile }] }
    expect(exportCheckpoints(source, revision)).toBeNull()
    expect(Object.keys(bigProfile.purchases)).toHaveLength(16000)
  })
})
