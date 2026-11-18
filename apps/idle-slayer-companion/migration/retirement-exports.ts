import { CHECKPOINT_STORAGE_KEY, exportCheckpoints, parseCheckpoints } from '../src/domain/checkpoints'
import { COMPANION_STORAGE_KEY, exportCompanionBackup, parseCompanionStored } from '../src/domain/companion-storage'
import { COMPANION_WORKSPACE_KEY, emptyCompanionWorkspace, parseCompanionWorkspace, parseCompanionWorkspaceStored } from '../src/domain/companion-workspace'
import { GOALS_STORAGE_KEY, parseGoals } from '../src/domain/goals'
import { visibility } from '../src/domain/rules'
import { COMPARISON_STORAGE_KEY, exportComparison, parseComparison, presentedComparison } from '../src/domain/saved-comparison'
import { exportProfileBackup, parseProfileBackup, PROFILE_STORAGE_KEY } from '../src/domain/storage'
import { emptyProfile, type Catalog, type Profile } from '../src/domain/types'

export type RetirementExportKind = 'progress' | 'intentions' | 'checkpoints' | 'comparison' | 'legacy-map' | 'legacy-intentions'
export type RetirementExportFormat = 'companion' | 'map' | 'intentions' | 'checkpoints' | 'comparison'
export interface RetirementExportState {
  status: 'ready' | 'missing' | 'invalid' | 'unavailable'
  message: string
  format?: RetirementExportFormat
}
export interface RetirementExportSnapshot { exports: Record<RetirementExportKind, RetirementExportState>; warnings: string[] }
export type RetirementExportResult = { ok: true; text: string; filename: string; format: RetirementExportFormat } | { ok: false; message: string }
type File = Omit<Extract<RetirementExportResult, { ok: true }>, 'ok'>
type Row = RetirementExportState & { file?: File }
type SavedValue = { ok: true; text: string | null } | { ok: false }
const keys = {
  progress: COMPANION_STORAGE_KEY, map: PROFILE_STORAGE_KEY, intentions: COMPANION_WORKSPACE_KEY,
  goals: GOALS_STORAGE_KEY, checkpoints: CHECKPOINT_STORAGE_KEY, comparison: COMPARISON_STORAGE_KEY,
} as const
type SavedKey = keyof typeof keys
type Saved = Record<SavedKey, SavedValue>
const dependencies: Record<RetirementExportKind, SavedKey[]> = {
  progress: ['progress', 'map'], intentions: ['intentions', 'goals'], checkpoints: ['checkpoints'],
  comparison: ['progress', 'map', 'comparison'], 'legacy-map': ['progress', 'map'], 'legacy-intentions': ['intentions', 'goals'],
}
const missing = (message = 'No saved data found.'): Row => ({ status: 'missing', message })
const invalid = (message: string): Row => ({ status: 'invalid', message })
const unavailable = (): Row => ({ status: 'unavailable', message: 'Browser storage could not be read. Saved data has not been changed. Allow access and retry.' })
const ready = (text: string, filename: string, format: RetirementExportFormat, message = 'Ready to export saved data.'): Row => ({ status: 'ready', message, format, file: { text, filename, format } })

function legacyIntentions(text: string): string {
  const workspace = emptyCompanionWorkspace()
  workspace.goals = parseGoals(text).targets.map((goal) => ({ ref: { system: 'ascension', id: goal.id }, mode: goal.mode }))
  return JSON.stringify(parseCompanionWorkspace(JSON.stringify(workspace)), null, 2)
}

/** The retirement screen can read/export documents, never create an editable session. */
export function createRetirementExports(options: { storage: () => Pick<Storage, 'getItem'>; catalog: Catalog }) {
  let sawCompanion = false, sawWorkspace = false
  function capture(): Saved {
    const result = {} as Saved
    for (const name of Object.keys(keys) as SavedKey[]) {
      try { result[name] = { ok: true, text: options.storage().getItem(keys[name]) } }
      catch { result[name] = { ok: false } }
    }
    if (result.progress.ok && result.progress.text !== null) sawCompanion = true
    if (result.intentions.ok && result.intentions.text !== null) sawWorkspace = true
    return result
  }
  function build(saved: Saved): { rows: Record<RetirementExportKind, Row>; warnings: string[] } {
    const rows: Record<RetirementExportKind, Row> = {
      progress: missing(), intentions: missing(), checkpoints: missing(), comparison: missing(),
      'legacy-map': missing(), 'legacy-intentions': missing(),
    }
    const warnings: string[] = []
    let profile: Profile | undefined
    if (!saved.progress.ok || !saved.map.ok) rows.progress = unavailable()
    else if (saved.progress.text !== null) {
      const parsed = parseCompanionStored(saved.progress.text, options.catalog.revision)
      if (parsed.ok) {
        const exported = exportCompanionBackup(parsed.value.progress)
        rows.progress = exported.ok ? ready(exported.value, 'idle-slayer-companion-progress.json', 'companion') : invalid('Saved Companion progress cannot be exported safely. Its saved bytes have been kept.')
        if (exported.ok) profile = parsed.value.progress.ascension
        if (parsed.value.legacyBaseline !== saved.map.text) warnings.push('An older Ascension map copy changed separately. The Companion backup does not merge that copy. Keep both exports before choosing what to restore.')
        if (parsed.value.legacyBaseline === saved.map.text) rows['legacy-map'] = missing()
        else rows['legacy-map'] = legacyMap(saved.map.text, true)
      } else {
        rows.progress = invalid('Saved Companion progress is invalid or exceeds its supported limit. It has not been replaced with an older map copy.')
        rows['legacy-map'] = legacyMap(saved.map.text, true)
      }
    } else if (sawCompanion) {
      rows.progress = invalid('The saved Companion document was removed during this visit. An older map copy has not been substituted.')
      rows['legacy-map'] = legacyMap(saved.map.text, true)
    } else if (saved.map.text !== null) {
      rows.progress = legacyMap(saved.map.text)
      const parsed = parseProfileBackup(saved.map.text, options.catalog.revision)
      if (parsed.ok) profile = parsed.profile
    } else profile = emptyProfile(options.catalog.revision)

    if (!saved.intentions.ok || !saved.goals.ok) rows.intentions = unavailable()
    else if (saved.intentions.text !== null) {
      try {
        const parsed = parseCompanionWorkspaceStored(saved.intentions.text)
        rows.intentions = ready(JSON.stringify(parsed.workspace, null, 2), 'companion-intentions.json', 'intentions')
        if (parsed.legacyBaseline !== undefined && parsed.legacyBaseline !== saved.goals.text) warnings.push('Older Ascension goals changed separately. The intentions backup does not merge those goals. Restoring an alternate intentions file replaces goals and crafting plans.')
        if (parsed.legacyBaseline === undefined || parsed.legacyBaseline !== saved.goals.text) rows['legacy-intentions'] = legacyGoals(saved.goals.text)
      } catch {
        rows.intentions = invalid('Saved intentions are invalid or exceed their supported limit. They have not been replaced with older goals.')
        rows['legacy-intentions'] = legacyGoals(saved.goals.text)
      }
    } else if (sawWorkspace) {
      rows.intentions = invalid('The saved intentions document was removed during this visit. Older goals have not been substituted.')
      rows['legacy-intentions'] = legacyGoals(saved.goals.text)
    } else if (saved.goals.text !== null) rows.intentions = legacyGoals(saved.goals.text, false)

    if (!saved.checkpoints.ok) rows.checkpoints = unavailable()
    else if (saved.checkpoints.text !== null) {
      const parsed = parseCheckpoints(saved.checkpoints.text, options.catalog.revision)
      const exported = parsed && exportCheckpoints(parsed, options.catalog.revision)
      rows.checkpoints = exported ? ready(exported, 'idle-slayer-progress-checkpoints.json', 'checkpoints') : invalid('Saved checkpoints are invalid or exceed their supported limit. Their saved bytes have been kept.')
    }
    if (!saved.comparison.ok) rows.comparison = unavailable()
    else if (saved.comparison.text !== null) {
      const parsed = parseComparison(saved.comparison.text)
      if (!parsed) rows.comparison = invalid('Saved comparison is invalid or exceeds its supported limit. Its saved bytes have been kept.')
      else if (!profile) rows.comparison = invalid('Saved progress must be readable before the comparison can be exported with the correct spoiler visibility.')
      else {
        const projected = presentedComparison(parsed, options.catalog, visibility(options.catalog, profile).ids)
        rows.comparison = ready(exportComparison(projected), 'idle-slayer-upgrade-comparison.json', 'comparison', 'Ready to export currently visible and unavailable entries.')
      }
    }
    return { rows, warnings }
  }
  function legacyMap(text: string | null, recovery = false): Row {
    if (text === null) return missing()
    const parsed = parseProfileBackup(text, options.catalog.revision)
    if (!parsed.ok) return invalid('The saved legacy map copy cannot be read safely. Its saved bytes have been kept.')
    const exported = exportProfileBackup(parsed.profile)
    return exported.ok ? ready(exported.text, recovery ? 'idle-slayer-changed-legacy-map.json' : 'idle-slayer-ascension-progress.json', 'map', 'Map-only backup. Restore through Ascension on the new site.') : invalid('The saved legacy map copy cannot be exported safely. Its saved bytes have been kept.')
  }
  function legacyGoals(text: string | null, recovery = true): Row {
    if (text === null) return missing()
    try { return ready(legacyIntentions(text), recovery ? 'companion-legacy-intentions.json' : 'companion-intentions.json', 'intentions', 'Ascension goals only. Restoring this file replaces destination goals and crafting plans.') }
    catch { return invalid('The saved legacy goals cannot be read safely. Their saved bytes have been kept.') }
  }
  return {
    read(): RetirementExportSnapshot {
      const { rows, warnings } = build(capture())
      return { exports: Object.fromEntries(Object.entries(rows).map(([kind, { file: _file, ...state }]) => [kind, state])) as RetirementExportSnapshot['exports'], warnings }
    },
    export(kind: RetirementExportKind): RetirementExportResult {
      const saved = capture(), row = build(saved).rows[kind]
      if (!row.file) return { ok: false, message: row.message }
      const latest = capture()
      if (dependencies[kind].some((key) => {
        const before = saved[key], after = latest[key]
        return !before.ok || !after.ok || before.text !== after.text
      })) return { ok: false, message: 'Saved data changed while preparing this export. Nothing was downloaded. Check the updated status and export again.' }
      return { ok: true, ...row.file }
    },
  }
}
