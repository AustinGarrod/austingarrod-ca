import type { Catalog, Profile, Upgrade } from './types'
import { satisfies, visibility } from './rules'

export const GOALS_STORAGE_KEY = 'idle-slayer-ascension-map.goals.v1'
export const MAX_GOALS = 20
export type GoalMode = 'acquire' | 'activate' | 'rebuild'
export type Goal = { id: string; mode: GoalMode }
export type Goals = { version: 1; targets: Goal[] }
export const emptyGoals = (): Goals => ({ version: 1, targets: [] })
export const goalModeLabels: Record<GoalMode, string> = { acquire: 'Acquire upgrade', activate: 'Own and activate', rebuild: 'Recurring rebuild' }

/** Separate intentions schema; unknown stable IDs survive later catalog revisions. */
export function parseGoals(text: string): Goals {
  if (text.length > 32_768) throw new Error('Invalid goals')
  const input: unknown = JSON.parse(text)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid goals')
  const value = input as Record<string, unknown>
  if (value.version !== 1 || Object.keys(value).some((key) => key !== 'version' && key !== 'targets') || !Array.isArray(value.targets) || value.targets.length > MAX_GOALS) throw new Error('Invalid goals')
  const ids = new Set<string>()
  const targets = value.targets.map((entry: unknown): Goal => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid goals')
    const goal = entry as Record<string, unknown>
    if (Object.keys(goal).length !== 2 || typeof goal.id !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(goal.id) || ids.has(goal.id) || typeof goal.mode !== 'string' || !['acquire', 'activate', 'rebuild'].includes(goal.mode)) throw new Error('Invalid goals')
    ids.add(goal.id)
    return { id: goal.id, mode: goal.mode as GoalMode }
  })
  return { version: 1, targets }
}

export function setGoal(goals: Goals, goal: Goal): Goals {
  const existing = goals.targets.findIndex((target) => target.id === goal.id)
  if (existing < 0 && goals.targets.length >= MAX_GOALS) throw new Error('Saved target capacity reached')
  return { version: 1, targets: existing < 0 ? [...goals.targets, goal] : goals.targets.map((target, index) => index === existing ? goal : target) }
}

export function moveGoal(goals: Goals, id: string, direction: -1 | 1, visibleIds: ReadonlySet<string>): Goals {
  // Move only among displayed intentions; never reveal the positions of hidden ones.
  const indices = goals.targets.flatMap((goal, index) => visibleIds.has(goal.id) ? [index] : [])
  const position = indices.findIndex((index) => goals.targets[index].id === id)
  const other = indices[position + direction]
  if (position < 0 || other === undefined) return goals
  const targets = [...goals.targets], current = indices[position]
  ;[targets[current], targets[other]] = [targets[other], targets[current]]
  return { version: 1, targets }
}

export function visibleGoals(catalog: Catalog, profile: Profile, goals: Goals) {
  const visible = visibility(catalog, profile), upgrades = new Map(visible.upgrades.map((node) => [node.id, node]))
  return goals.targets.flatMap((goal) => {
    const upgrade = upgrades.get(goal.id)
    if (!upgrade) return []
    return [{ ...goal, upgrade, ...goalStatus(upgrade, profile, goal.mode) }]
  })
}
export function goalStatus(upgrade: Upgrade, profile: Profile, mode: GoalMode) {
  const owned = satisfies({ kind: 'owned', id: upgrade.id }, profile), active = satisfies({ kind: 'active', id: upgrade.id }, profile)
  const achieved = owned && (mode === 'acquire' || active)
  const state = owned ? active ? 'achieved' : 'pending' : satisfies(upgrade.reveal, profile) && satisfies(upgrade.purchase, profile) ? 'eligible' : 'blocked'
  return { achieved, state: state as 'achieved' | 'pending' | 'eligible' | 'blocked' }
}
