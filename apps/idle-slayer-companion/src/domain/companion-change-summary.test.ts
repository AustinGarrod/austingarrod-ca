import { describe, expect, it } from 'vitest'
import type { CompanionEntity, CompanionProgress } from './companion-types'
import { emptyCompanionProgress } from './companion-progress'
import { summarizeCompanionChanges } from './companion-change-summary'

const entity = (system: CompanionEntity['system'], id: string, extra: Partial<CompanionEntity> = {}): CompanionEntity => ({ system, id, title: id, description: '', category: '', reveal: { kind: 'always' }, provenance: [], ...extra })
const visible = [entity('achievement', 'a1'), entity('achievement', 'a2'), entity('achievement', 'a3'), entity('divinity', 'd1'), entity('enemy', 'e1'), entity('craft', 'c1'), entity('material', 'm1')]
function progress(edit: (value: CompanionProgress) => void) { const value = emptyCompanionProgress('test'); edit(value); return value }

describe('summarizeCompanionChanges', () => {
  it('counts recorded and complete entries per section before and after, in section order', () => {
    const before = progress((value) => { value.modules.achievement.records.a1 = { completed: true } })
    const after = progress((value) => { value.modules.achievement.records = { a1: { completed: true }, a2: { completed: true }, a3: { completed: false } }; value.modules.enemy.records.e1 = { discovered: true, count: '12' } })
    const summary = summarizeCompanionChanges(visible, before, after)
    expect(summary.map((section) => section.id)).toEqual(['achievements', 'crafting', 'quests', 'bestiary', 'divinities'])
    expect(summary[0]).toMatchObject({ title: 'Achievements', completeLabel: 'earned', before: { recorded: 1, complete: 1 }, after: { recorded: 3, complete: 2 } })
    expect(summary[3]).toMatchObject({ completeLabel: 'discovered', before: { recorded: 0, complete: 0 }, after: { recorded: 1, complete: 1 } })
    expect(summary[3].changes.map((change) => change.entity.id)).toEqual(['e1'])
  })

  it('leaves out rows whose only change is a first "no", while still counting them as recorded', () => {
    const after = progress((value) => { value.modules.achievement.records = { a2: { completed: true }, a3: { completed: false } }; value.modules.divinity.records.d1 = { selected: false } })
    const [achievements, , , , divinities] = summarizeCompanionChanges(visible, emptyCompanionProgress('test'), after)
    expect(achievements.changes.map((change) => change.entity.id)).toEqual(['a2'])
    expect(achievements.quietlyRecorded).toBe(1)
    expect(achievements.after.recorded).toBe(2)
    expect(divinities.changes).toEqual([])
    expect(divinities.quietlyRecorded).toBe(1)
  })

  it('lists a change from yes to no and every counter change', () => {
    const before = progress((value) => { value.modules.achievement.records.a1 = { completed: true }; value.modules.material.records.m1 = { count: '5' } })
    const after = progress((value) => { value.modules.achievement.records.a1 = { completed: false }; value.modules.material.records.m1 = { count: '5', discovered: false } })
    const [achievements, crafting] = summarizeCompanionChanges(visible, before, after)
    expect(achievements.changes).toEqual([{ entity: visible[0], before: { completed: true }, after: { completed: false } }])
    expect(crafting.changes.map((change) => change.entity.id)).toEqual(['m1'])
  })

  it('reads shared craft ownership from Ascension milestones like the trackers do', () => {
    const after = progress((value) => { value.ascension.milestones.c1 = true })
    const crafting = summarizeCompanionChanges(visible, emptyCompanionProgress('test'), after)[1]
    expect(crafting).toMatchObject({ completeLabel: 'owned', before: { recorded: 0, complete: 0 }, after: { recorded: 1, complete: 1 } })
  })

  it('never counts or lists entries outside the visible projection it is given', () => {
    const after = progress((value) => { value.modules.achievement.records.hidden = { completed: true } })
    const [achievements] = summarizeCompanionChanges(visible, emptyCompanionProgress('test'), after)
    expect(achievements).toMatchObject({ after: { recorded: 0, complete: 0 }, changes: [], quietlyRecorded: 0 })
  })
})
