import type { ReactNode } from 'react'
import type { Catalog, Profile } from './domain/types'
import type { CompanionEntity, CompanionProgress, CompanionRecord } from './domain/companion-types'
import { summarizeCompanionChanges } from './domain/companion-change-summary'
import { compareProgress } from './domain/progress-comparison'
import { visibility } from './domain/rules'
import { companionPlural } from './companion-view-model'
import { ProgressComparison } from './ProgressComparison'

const fieldLabels: Record<string, string> = { count: 'Count', completed: 'Complete', discovered: 'Discovered', claimed: 'Claimed', selected: 'Selected', built: 'Built', stage: 'Stage', active: 'Active' }
export function observationText(record: CompanionRecord) {
  const values = Object.entries(record).map(([key, value]) => `${fieldLabels[key] ?? key}: ${typeof value === 'boolean' ? value ? 'yes' : 'no' : value}`)
  return values.length ? values.join(' · ') : 'Not recorded'
}

/**
 * The decision in a whole-progress replacement: one row per section with before and after counts,
 * the entry-level details collapsed per section, and Apply/Cancel in a footer that stays in view.
 * Everything listed or counted comes from the current visible projection.
 */
export function CompanionPreview({ heading, intro, before, after, entities, map, viewer, currentLabel, undoAvailable, showEpochHeadline, extra, notes, actions }: {
  heading: string; intro: ReactNode; before: CompanionProgress; after: CompanionProgress; entities: readonly CompanionEntity[]
  map: Catalog | null; viewer: Profile; currentLabel: string; undoAvailable: boolean; showEpochHeadline: boolean; extra?: ReactNode; notes?: ReactNode; actions: ReactNode
}) {
  const sections = summarizeCompanionChanges(entities, before, after)
  // Ascension counts use the viewer's current visible upgrades for both sides, never the incoming reveal set.
  const visibleIds = map ? visibility(map, viewer).ids : new Set<string>()
  const owned = (profile: Profile) => [...visibleIds].filter((id) => Object.hasOwn(profile.purchases, id)).length
  const comparison = map ? compareProgress(map, before.ascension, after.ascension, viewer) : null
  const ascensionChanges = comparison ? comparison.upgrades.length + comparison.milestones.length : 0
  return <section className="companion-preview" aria-label="Review progress replacement">
    <h3>{heading}</h3>
    {intro}
    {showEpochHeadline && <p className="companion-preview-headline">Recorded Ultra Ascensions: {before.ascension.epoch} → {after.ascension.epoch}</p>}
    <div className="companion-change-table"><table>
      <caption>What changes</caption>
      <thead><tr><th scope="col">Section</th><th scope="col">Now</th><th scope="col">After</th></tr></thead>
      <tbody>
        {map && <tr><th scope="row">Ascension</th><td>{owned(before.ascension).toLocaleString('en')} owned</td><td>{owned(after.ascension).toLocaleString('en')} owned</td></tr>}
        {!showEpochHeadline && <tr><th scope="row">Ultra Ascensions</th><td>{before.ascension.epoch.toLocaleString('en')}</td><td>{after.ascension.epoch.toLocaleString('en')}</td></tr>}
        {sections.map((section) => <tr key={section.id}><th scope="row">{section.title}</th>
          <td>{section.before.complete.toLocaleString('en')} {section.completeLabel}<small>{companionPlural(section.before.recorded, 'recorded entry', 'recorded entries')}</small></td>
          <td>{section.after.complete.toLocaleString('en')} {section.completeLabel}<small>{companionPlural(section.after.recorded, 'recorded entry', 'recorded entries')}</small></td></tr>)}
      </tbody>
    </table></div>
    {extra}
    <div className="companion-change-groups">
      {notes}
      {map && <details className="companion-change-group"><summary>Ascension: {companionPlural(ascensionChanges, 'visible change')}</summary>
        <ProgressComparison catalog={map} current={before.ascension} incoming={after.ascension} viewer={viewer} undoAvailable={undoAvailable} currentLabel={currentLabel} context="Ascension changes within this Companion operation." />
      </details>}
      {sections.filter((section) => section.changes.length || section.quietlyRecorded).map((section) => <details key={section.id} className="companion-change-group">
        <summary>{section.title}: {companionPlural(section.changes.length + section.quietlyRecorded, 'change')}</summary>
        <ul>{section.changes.map(({ entity, before: was, after: now }) => <li key={`${entity.system}:${entity.id}`}><b>{entity.title}</b><small>{observationText(was)} → {observationText(now)}</small></li>)}</ul>
        {section.quietlyRecorded > 0 && <small>{companionPlural(section.quietlyRecorded, 'more entry is', 'more entries are')} recorded as not yet done; they are counted above but not listed.</small>}
      </details>)}
    </div>
    <div className="companion-preview-actions">{actions}</div>
  </section>
}
