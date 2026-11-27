import type { CompanionEntity, CompanionProgress, CompanionRecord, CompanionSystem } from './companion-types'
import { getCompanionRecord } from './companion-progress'
import { companionRecordedStatus, companionStatusLabels } from '../companion-view-model'

export type CompanionChangeSection = 'achievements' | 'crafting' | 'quests' | 'bestiary' | 'divinities'
export const changeSections: readonly { id: CompanionChangeSection; title: string; systems: readonly CompanionSystem[] }[] = [
  { id: 'achievements', title: 'Achievements', systems: ['achievement'] },
  { id: 'crafting', title: 'Crafting & materials', systems: ['craft', 'material'] },
  { id: 'quests', title: 'Quests & Village', systems: ['quest', 'village'] },
  { id: 'bestiary', title: 'Bestiary', systems: ['enemy'] },
  { id: 'divinities', title: 'Divinities', systems: ['divinity'] },
]

export interface CompanionEntryChange { entity: CompanionEntity; before: CompanionRecord; after: CompanionRecord }
export interface CompanionSectionSummary {
  id: CompanionChangeSection
  title: string
  /** The word for a complete entry in this section, for example "earned". */
  completeLabel: string
  before: { recorded: number; complete: number }
  after: { recorded: number; complete: number }
  /** Entries worth reading, in catalog order. */
  changes: CompanionEntryChange[]
  /** Entries whose only change is a first record of "no"/"not yet": counted above, not listed. */
  quietlyRecorded: number
}

const sameRecord = (left: CompanionRecord, right: CompanionRecord) => JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort())
/** A blank entry that becomes only "no" answers carries no news worth a row of its own. */
function onlyFirstNegatives(before: CompanionRecord, after: CompanionRecord) {
  return Object.keys(before).length === 0 && Object.values(after).length > 0 && Object.values(after).every((value) => value === false)
}

/**
 * Per-section before/after counts for a whole-progress replacement, over the entries the caller
 * passes in (the current visible projection only). Hidden entries never contribute rows or counts.
 */
export function summarizeCompanionChanges(entities: readonly CompanionEntity[], before: CompanionProgress, after: CompanionProgress): CompanionSectionSummary[] {
  return changeSections.map((section) => {
    const sectionEntities = entities.filter((entity) => section.systems.includes(entity.system))
    const summary: CompanionSectionSummary = {
      id: section.id, title: section.title,
      completeLabel: section.id === 'crafting' ? 'owned' : companionStatusLabels({ system: section.systems[0], category: '' })[0].toLowerCase(),
      before: { recorded: 0, complete: 0 }, after: { recorded: 0, complete: 0 }, changes: [], quietlyRecorded: 0,
    }
    for (const entity of sectionEntities) {
      const was = getCompanionRecord(before, entity.system, entity.id), now = getCompanionRecord(after, entity.system, entity.id)
      for (const [side, record] of [['before', was], ['after', now]] as const) {
        const status = companionRecordedStatus(entity, record)
        if (status !== 'unknown') summary[side].recorded++
        if (status === 'complete') summary[side].complete++
      }
      if (sameRecord(was, now)) continue
      if (onlyFirstNegatives(was, now)) summary.quietlyRecorded++
      else summary.changes.push({ entity, before: was, after: now })
    }
    return summary
  })
}
