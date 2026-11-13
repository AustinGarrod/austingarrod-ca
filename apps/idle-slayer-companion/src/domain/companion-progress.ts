import { COMPANION_SYSTEMS, type CompanionProgress, type CompanionRecord, type CompanionSystem } from './companion-types'
import { emptyProfile, type Profile } from './types'
export type { CompanionProgress, CompanionModuleProgress } from './companion-types'

export function emptyCompanionProgress(revision: string): CompanionProgress {
  return {
    format: 'idle-slayer-companion-progress', version: 1, catalogRevision: revision,
    ascension: emptyProfile(revision),
    modules: Object.fromEntries(COMPANION_SYSTEMS.map((system) => [system, { tracked: false, records: {} }])) as CompanionProgress['modules'],
  }
}

/** Shared permanent-item receipt is canonical in milestones, including items absent from the map catalog. */
export function getCompanionRecord(progress: CompanionProgress, system: CompanionSystem, id: string): CompanionRecord {
  const record = progress.modules[system].records[id] ?? {}
  if (system !== 'craft' && system !== 'village') return record
  if (progress.ascension.milestones[id]) return { ...record, completed: true }
  return Object.hasOwn(record, 'completed') ? { ...record, completed: false } : record
}

/** A manual observation records state; it never spends resources or awards unrelated rewards. */
export function recordCompanionEntity(progress: CompanionProgress, system: CompanionSystem, id: string, patch: CompanionRecord, observedAt = new Date().toISOString()): CompanionProgress {
  const module = progress.modules[system]
  const record = { ...module.records[id], ...patch }
  let ascension = progress.ascension
  if ((system === 'craft' || system === 'village') && patch.completed !== undefined) {
    const milestones = { ...ascension.milestones }
    if (patch.completed) milestones[id] = true
    else delete milestones[id]
    // The stored false flag says this item has been observed. True ownership is never duplicated.
    record.completed = false
    ascension = { ...ascension, milestones }
  }
  return { ...progress, ascension, modules: { ...progress.modules, [system]: { ...module, tracked: true, source: 'manual', observedAt, records: { ...module.records, [id]: record } } } }
}

/** Map-only restores replace only the supplied map universe; unrelated companion item facts survive. */
export function replaceAscensionProfile(progress: CompanionProgress, profile: Profile, mapMilestoneIds?: readonly string[]): CompanionProgress {
  const milestones = mapMilestoneIds
    ? { ...Object.fromEntries(Object.entries(progress.ascension.milestones).filter(([id]) => !mapMilestoneIds.includes(id))), ...profile.milestones }
    : { ...progress.ascension.milestones, ...profile.milestones }
  return { ...progress, ascension: { ...profile, milestones } }
}

/** Catalog updates preserve unknown IDs and never claim another observation happened. */
export function migrateCompanionProgress(progress: CompanionProgress, revision: string): CompanionProgress {
  return { ...structuredClone(progress), catalogRevision: revision, ascension: { ...structuredClone(progress.ascension), catalogRevision: revision } }
}

/** Canonicalize accepted runtime snapshots without changing references for already normalized map commands. */
export function normalizeSharedCompanionItems(progress: CompanionProgress): CompanionProgress {
  let next = progress
  for (const system of ['craft', 'village'] as const) {
    for (const [id, record] of Object.entries(progress.modules[system].records)) {
      if (record.completed !== true) continue
      if (next === progress) next = { ...progress, ascension: { ...progress.ascension, milestones: { ...progress.ascension.milestones } }, modules: { ...progress.modules } }
      if (next.modules[system] === progress.modules[system]) next.modules[system] = { ...progress.modules[system], records: { ...progress.modules[system].records } }
      next.ascension.milestones[id] = true
      next.modules[system].records[id] = { ...record, completed: false }
    }
  }
  return next
}
