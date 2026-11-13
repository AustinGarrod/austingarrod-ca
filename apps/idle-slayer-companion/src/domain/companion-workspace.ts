import { GOALS_STORAGE_KEY, parseGoals, type GoalMode } from './goals'
import { COMPANION_SYSTEMS, type CompanionEntityRef } from './companion-types'
import type { ProfileLocks } from './profile-session'

export const COMPANION_WORKSPACE_KEY = 'idle-slayer-companion.workspace.v1'
export const COMPANION_WORKSPACE_WRITE_LOCK = `${COMPANION_WORKSPACE_KEY}.write`
export interface CompanionGoal { ref: CompanionEntityRef; mode: GoalMode | 'complete' | 'select' | 'mastery' }
export interface CompanionWorkspace { format: 'idle-slayer-companion-workspace'; version: 1; goals: CompanionGoal[]; recipePlans: Record<string, string> }
export const emptyCompanionWorkspace = (): CompanionWorkspace => ({ format: 'idle-slayer-companion-workspace', version: 1, goals: [], recipePlans: {} })
const identity = (ref: CompanionEntityRef) => `${ref.system}:${ref.id}`
const safeId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(id) && !['constructor', 'prototype', '__proto__'].includes(id)
const bytes = (text: string) => new TextEncoder().encode(text).byteLength
const MAX_WORKSPACE_BYTES = 65_536
const MAX_LEGACY_BYTES = 65_536
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function exact(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)) }
export function parseCompanionWorkspace(text: string): CompanionWorkspace {
  if (bytes(text) > MAX_WORKSPACE_BYTES) throw new Error('Invalid intentions')
  const value: unknown = JSON.parse(text)
  if (!object(value) || !exact(value, ['format', 'version', 'goals', 'recipePlans']) || value.format !== 'idle-slayer-companion-workspace' || value.version !== 1 || !Array.isArray(value.goals) || value.goals.length > 20 || !object(value.recipePlans)) throw new Error('Invalid intentions')
  const seen = new Set<string>(), goals: CompanionGoal[] = []
  for (const goal of value.goals) {
    if (!object(goal) || !exact(goal, ['mode', 'ref']) || !object(goal.ref) || !exact(goal.ref, ['id', 'system']) || !['ascension', ...COMPANION_SYSTEMS].includes(goal.ref.system as CompanionEntityRef['system']) || !safeId(goal.ref.id)) throw new Error('Invalid intentions')
    const ref = { system: goal.ref.system as CompanionEntityRef['system'], id: goal.ref.id }
    const modes = ref.system === 'ascension' ? ['acquire', 'activate', 'rebuild'] : ref.system === 'enemy' ? ['mastery'] : ref.system === 'divinity' ? ['select'] : ['complete']
    if (!modes.includes(String(goal.mode)) || seen.has(identity(ref))) throw new Error('Invalid intentions')
    seen.add(identity(ref)); goals.push({ ref, mode: goal.mode as CompanionGoal['mode'] })
  }
  const plans = Object.entries(value.recipePlans)
  if (plans.length > 100 || plans.some(([id, count]) => !safeId(id) || typeof count !== 'string' || !/^[1-9]\d{0,29}$/.test(count))) throw new Error('Invalid plans')
  return { format: 'idle-slayer-companion-workspace', version: 1, goals, recipePlans: Object.fromEntries(plans) as Record<string, string> }
}
type Pair = { raw: string | null; legacy: string | null }
export type CompanionWorkspaceSnapshot = (Pair & { kind: 'valid'; workspace: CompanionWorkspace; legacyChanged: boolean }) | (Pair & { kind: 'invalid'; error: string }) | { kind: 'unavailable'; error: string }
export interface CompanionWorkspaceReview { version: number; snapshot: CompanionWorkspaceSnapshot }
export interface CompanionWorkspaceState extends Pair { workspace: CompanionWorkspace; version: number; loaded: boolean; pending: boolean; dirty: boolean; readable: boolean; conflict: boolean; error: string }
const same = (first: Pair, second: Pair) => first.raw === second.raw && first.legacy === second.legacy
function stored(workspace: CompanionWorkspace, legacyBaseline: string | null) {
  parseCompanionWorkspace(JSON.stringify(workspace))
  if (legacyBaseline !== null && bytes(legacyBaseline) > MAX_LEGACY_BYTES) throw new Error('Invalid legacy baseline')
  return JSON.stringify({ format: 'idle-slayer-companion-workspace-storage', version: 1, legacyBaseline, workspace })
}

/** Separate intentions document, with exact saved baselines and explicit recovery drafts. */
export function createCompanionWorkspaceSession(options: { storage: () => Pick<Storage, 'getItem' | 'setItem'>; locks: () => ProfileLocks | undefined }) {
  let adopted = false, operation = 0, baseline: Pair | undefined, persisted: CompanionWorkspace | undefined
  let state: CompanionWorkspaceState = { workspace: emptyCompanionWorkspace(), raw: null, legacy: null, loaded: false, pending: false, dirty: false, readable: false, conflict: false, error: '', version: 0 }
  const listeners = new Set<(state: CompanionWorkspaceState) => void>(), reviews = new WeakSet<CompanionWorkspaceReview>()
  function publish(patch: Partial<CompanionWorkspaceState>) {
    state = { ...state, ...patch }
    state = { ...state, dirty: state.workspace !== persisted || state.conflict || state.pending }
    listeners.forEach((listener) => listener(state))
  }
  function read(): CompanionWorkspaceSnapshot {
    let pair: Pair
    try { const storage = options.storage(); pair = { raw: storage.getItem(COMPANION_WORKSPACE_KEY), legacy: storage.getItem(GOALS_STORAGE_KEY) } } catch { return { kind: 'unavailable', error: 'Saved intentions could not be read. They were kept; export this visit or retry recovery.' } }
    try {
      if (pair.raw !== null) {
        adopted = true
        if (bytes(pair.raw) > MAX_WORKSPACE_BYTES + MAX_LEGACY_BYTES * 2 + 1024) throw new Error()
        const value: unknown = JSON.parse(pair.raw)
        if (object(value) && value.format === 'idle-slayer-companion-workspace-storage') {
          if (!exact(value, ['format', 'version', 'legacyBaseline', 'workspace']) || value.version !== 1 || (value.legacyBaseline !== null && (typeof value.legacyBaseline !== 'string' || bytes(value.legacyBaseline) > MAX_LEGACY_BYTES))) throw new Error()
          return { ...pair, kind: 'valid', workspace: parseCompanionWorkspace(JSON.stringify(value.workspace)), legacyChanged: value.legacyBaseline !== pair.legacy }
        }
        return { ...pair, kind: 'valid', workspace: parseCompanionWorkspace(pair.raw), legacyChanged: false }
      }
      const workspace = emptyCompanionWorkspace()
      if (!adopted && pair.legacy !== null) workspace.goals = parseGoals(pair.legacy).targets.map((goal) => ({ ref: { system: 'ascension', id: goal.id }, mode: goal.mode }))
      return { ...pair, kind: 'valid', workspace, legacyChanged: false }
    } catch { return { ...pair, kind: 'invalid', error: 'Saved intentions are invalid. They were kept; export this visit and review recovery before replacing them.' } }
  }
  function observe(snapshot: CompanionWorkspaceSnapshot): boolean {
    if (snapshot.kind !== 'unavailable' && baseline && same(snapshot, baseline) && !state.conflict) return false
    operation++
    const oldWriter = snapshot.kind !== 'unavailable' && baseline?.raw !== null && baseline?.raw !== undefined && snapshot.legacy !== baseline.legacy
    if (!state.dirty && !state.pending && !state.conflict && snapshot.kind === 'valid' && !snapshot.legacyChanged && !oldWriter) {
      baseline = snapshot; persisted = snapshot.workspace
      publish({ workspace: snapshot.workspace, raw: snapshot.raw, legacy: snapshot.legacy, readable: true, conflict: false, pending: false, error: '', version: state.version + 1 })
    } else publish({ pending: false, conflict: true, error: snapshot.kind === 'valid' ? 'Saved intentions changed in another tab. This visit was kept. Export it and review saved intentions before replacing either copy.' : snapshot.error, version: state.version + 1 })
    return true
  }
  function initialize() {
    if (state.loaded) return
    const snapshot = read()
    baseline = snapshot.kind === 'unavailable' ? undefined : snapshot
    if (snapshot.kind === 'valid') {
      persisted = snapshot.workspace
      publish({ workspace: snapshot.workspace, raw: snapshot.raw, legacy: snapshot.legacy, loaded: true, readable: true, conflict: snapshot.legacyChanged, error: snapshot.legacyChanged ? 'An older map tab changed saved goals. Companion intentions were kept. Review recovery before saving.' : '', version: state.version + 1 })
    } else publish({ loaded: true, readable: false, conflict: true, error: snapshot.error, raw: snapshot.kind === 'invalid' ? snapshot.raw : null, legacy: snapshot.kind === 'invalid' ? snapshot.legacy : null, version: state.version + 1 })
  }
  function review(): CompanionWorkspaceReview { const draft = { version: state.version, snapshot: read() }; reviews.add(draft); return draft }
  function verifiedReview(draft: CompanionWorkspaceReview): boolean {
    if (!reviews.has(draft) || draft.version !== state.version || state.pending) { publish({ error: 'Intentions changed while reviewing recovery. Review the current saved copy again.' }); return false }
    if (draft.snapshot.kind === 'unavailable') { publish({ error: draft.snapshot.error }); return false }
    return true
  }
  async function save(draft?: CompanionWorkspaceReview): Promise<boolean> {
    if (!state.loaded || state.pending) return false
    if (draft && !verifiedReview(draft)) return false
    const expected = draft && draft.snapshot.kind !== 'unavailable' ? draft.snapshot : baseline
    if (!expected || (!draft && (!state.readable || state.conflict))) { publish({ error: 'Review saved intentions before replacing them. This visit remains available to export.' }); return false }
    const workspace = state.workspace, version = state.version, ticket = ++operation
    let raw: string
    try { raw = stored(workspace, expected.legacy) } catch { publish({ error: 'The intentions document exceeds its supported size or format. This visit remains available to export.' }); return false }
    publish({ pending: true })
    try {
      const locks = options.locks()
      if (!locks) throw new Error()
      return await locks.request(COMPANION_WORKSPACE_WRITE_LOCK, { mode: 'exclusive', ifAvailable: true }, (lock) => {
        if (ticket !== operation || state.version !== version) return false
        if (!lock) throw new Error()
        const current = read()
        if (current.kind === 'unavailable' || !same(current, expected)) { observe(current); return false }
        options.storage().setItem(COMPANION_WORKSPACE_KEY, raw)
        adopted = true; baseline = { raw, legacy: expected.legacy }; persisted = workspace
        publish({ raw, legacy: expected.legacy, readable: true, conflict: false, error: '' }); return true
      })
    } catch { if (ticket === operation) publish({ error: 'Intentions could not be saved. Export this visit or retry saving before closing the page.' }); return false }
    finally { if (ticket === operation) publish({ pending: false }) }
  }
  function edit(workspace: CompanionWorkspace, expected = state.workspace) {
    if (!state.loaded || state.pending || state.workspace !== expected) { publish({ error: 'Intentions changed before this edit. Review the updated list and retry.' }); return false }
    try { parseCompanionWorkspace(JSON.stringify(workspace)) } catch { publish({ error: 'The intention list is full or contains an unsupported value.' }); return false }
    publish({ workspace, version: state.version + 1 }); void save(); return true
  }
  function useSaved(draft?: CompanionWorkspaceReview) {
    if (!draft || !verifiedReview(draft) || draft.snapshot.kind !== 'valid') { publish({ error: 'Review a valid saved intentions copy before using it.' }); return false }
    const current = read()
    if (current.kind !== 'valid' || !same(current, draft.snapshot)) { observe(current); return false }
    operation++; baseline = current; persisted = current.legacyChanged ? undefined : current.workspace
    publish({ workspace: current.workspace, raw: current.raw, legacy: current.legacy, readable: true, conflict: false, error: '', version: state.version + 1 })
    if (current.legacyChanged) void save()
    return true
  }
  function subscribe(listener: (state: CompanionWorkspaceState) => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
  function cancelPending() { operation++; if (state.pending) publish({ pending: false, error: 'Saving intentions was cancelled. Export this visit to keep it.', version: state.version + 1 }) }
  return { initialize, getState: () => state, subscribe, edit, save: () => save(), review, useSaved, replaceSaved: (draft: CompanionWorkspaceReview) => save(draft), refreshExternal: () => observe(read()), cancelPending }
}
