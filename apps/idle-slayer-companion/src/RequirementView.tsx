import { Fragment } from 'react'
import { visibleRequirement } from './domain/requirement-view'
import type { RequirementRoute, VisibleRequirement } from './domain/requirement-view'
import type { visibility } from './domain/rules'
import type { Profile, Requirement } from './domain/types'

function Expression({ view, onReview }: { view: VisibleRequirement; onReview?: (route: RequirementRoute) => void }) {
  if (view.kind === 'leaf') return <span className="requirement-leaf">
    {view.route && onReview ? <button type="button" title={view.identity} aria-label={`Review ${view.identity ?? view.label}`} onClick={() => onReview(view.route!)}>{view.label}</button> : <span>{view.label}{view.route?.kind === 'upgrade' && <small>{view.identity} · ID: {view.route.id}</small>}</span>}
    <small className={`requirement-status ${view.satisfied ? 'requirement-satisfied' : 'requirement-missing'}`}>{view.satisfied ? '✓ Satisfied' : '◇ Missing'}</small>
  </span>
  return <>{view.requirements.map((child, index) => {
    const grouped = child.kind !== 'leaf' && child.kind !== view.kind
    return <Fragment key={index}>{index > 0 && <span className="requirement-operator">{view.kind === 'all' ? ' AND ' : ' OR '}</span>}{grouped && '('}<Expression view={child} onReview={onReview} />{grouped && ')'}</Fragment>
  })}</>
}

export function ReadOnlyRequirement({ requirement, profile, visible }: {
  requirement: Requirement; profile: Profile; visible: ReturnType<typeof visibility>
}) {
  const view = visibleRequirement(requirement, profile, visible)
  return <div className="requirement-expression">{view ? <Expression view={view} /> : 'Requirements are unrevealed.'}</div>
}

export function RequirementView({ requirement, profile, visible, onReview }: {
  requirement: Requirement; profile: Profile; visible: ReturnType<typeof visibility>; onReview: (route: RequirementRoute) => void
}) {
  const view = visibleRequirement(requirement, profile, visible)
  return <div className="requirement-view">
    <div className="requirement-expression">{view ? <Expression view={view} onReview={onReview} /> : 'Requirements are unrevealed.'}</div>
    <small className="requirement-guidance">Only visible requirements are shown. Native gates still apply. Reviewing a requirement does not record progress or choose an OR path.</small>
  </div>
}
