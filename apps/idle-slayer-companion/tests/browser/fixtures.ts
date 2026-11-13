import { test as base, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { COMPANION_STORAGE_KEY } from '../../src/domain/companion-storage'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { GOALS_STORAGE_KEY } from '../../src/domain/goals'
import { COMPANION_WORKSPACE_KEY } from '../../src/domain/companion-workspace'

declare global {
  interface Window {
    __readMapProfileText: (key: string) => string | null
    __writeExternalMapProfileText: (key: string, text: string) => void
    __removeMapProfileStorage: (key: string) => void
  }
}
const mapMilestones = (JSON.parse(readFileSync('public/catalog.json', 'utf8')) as { milestones: { id: string }[] }).milestones.map((item) => item.id)
const companionItems = (JSON.parse(readFileSync('public/companion-catalog.json', 'utf8')) as { entities: { system: string; id: string }[] }).entities.filter((item) => item.system === 'craft' || item.system === 'village').map((item) => item.id)

export async function installProfileTestHelpers(context: import('@playwright/test').BrowserContext) {
// Assertion and deliberate external-update helpers only. Application storage
// APIs are untouched; fresh addInitScript profile seeds still test migration.
await context.addInitScript(({ companionKey, legacyKey, goalsKey, workspaceKey, mapMilestones, companionItems }) => {
  const mapItems = new Set(mapMilestones), otherItems = new Set(companionItems)
  let adopted = false
  const project = (profile: { milestones: Record<string, true> }) => ({ ...profile, milestones: Object.fromEntries(Object.entries(profile.milestones).filter(([id]) => !otherItems.has(id) || mapItems.has(id))) })
  window.__readMapProfileText = (key) => {
    if (key === goalsKey) {
      const raw = localStorage.getItem(workspaceKey)
      if (raw === null) return localStorage.getItem(goalsKey)
      try { const document = JSON.parse(raw), workspace = document.workspace ?? document; return workspace.goals ? JSON.stringify({ version: 1, targets: workspace.goals.filter((goal: { ref: { system: string } }) => goal.ref.system === 'ascension').map((goal: { ref: { id: string }; mode: string }) => ({ id: goal.ref.id, mode: goal.mode })) }) : raw } catch { return raw }
    }
    if (key !== legacyKey) return localStorage.getItem(key)
    const raw = localStorage.getItem(companionKey)
    if (raw !== null) {
      adopted = true
      try { const document = JSON.parse(raw); return document.progress?.ascension ? JSON.stringify(project(document.progress.ascension)) : raw } catch { return raw }
    }
    return adopted ? null : localStorage.getItem(legacyKey)
  }
  window.__writeExternalMapProfileText = (key, text) => {
    if (key === goalsKey) {
      let incoming: { targets: { id: string; mode: string }[] }
      try { incoming = JSON.parse(text); if (!Array.isArray(incoming.targets)) throw new Error() } catch { localStorage.setItem(workspaceKey, text); return }
      let workspace: { goals: { ref: { system: string; id: string }; mode: string }[]; recipePlans: Record<string, string> } & Record<string, unknown> = { format: 'idle-slayer-companion-workspace', version: 1, goals: [], recipePlans: {} }
      try { const document = JSON.parse(localStorage.getItem(workspaceKey) ?? 'null'); if (document) workspace = document.workspace ?? document } catch { /* Deliberate external recovery fixture. */ }
      const goals = [...workspace.goals.filter((goal) => goal.ref.system !== 'ascension'), ...incoming.targets.map((goal) => ({ ref: { system: 'ascension', id: goal.id }, mode: goal.mode }))]
      localStorage.setItem(workspaceKey, JSON.stringify({ format: 'idle-slayer-companion-workspace-storage', version: 1, legacyBaseline: localStorage.getItem(goalsKey), workspace: { ...workspace, goals } })); return
    }
    if (key !== legacyKey) { localStorage.setItem(key, text); return }
    adopted = true
    let profile: Record<string, unknown>
    try { profile = JSON.parse(text); if (!profile || profile.version !== 1 || !profile.purchases || !profile.milestones) throw new Error() } catch { localStorage.setItem(companionKey, text); return }
    let current: { progress?: { ascension: { milestones: Record<string, true> }; [key: string]: unknown } } | undefined
    try { current = JSON.parse(localStorage.getItem(companionKey) ?? 'null') ?? undefined } catch { /* Deliberately replace corrupt external input. */ }
    const shared = Object.fromEntries(Object.entries(current?.progress?.ascension.milestones ?? {}).filter(([id]) => otherItems.has(id) && !mapItems.has(id)))
    const progress = current?.progress ?? { format: 'idle-slayer-companion-progress', version: 1, catalogRevision: profile.catalogRevision, modules: Object.fromEntries(['achievement', 'craft', 'material', 'quest', 'village', 'enemy', 'divinity'].map((system) => [system, { tracked: false, records: {} }])) }
    localStorage.setItem(companionKey, JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, legacyBaseline: localStorage.getItem(legacyKey), progress: { ...progress, ascension: { ...profile, milestones: { ...shared, ...profile.milestones as object } } } }))
  }
  window.__removeMapProfileStorage = (key) => { if (key === legacyKey) { adopted = true; localStorage.removeItem(companionKey) } else localStorage.removeItem(key === goalsKey ? workspaceKey : key) }
}, { companionKey: COMPANION_STORAGE_KEY, legacyKey: PROFILE_STORAGE_KEY, goalsKey: GOALS_STORAGE_KEY, workspaceKey: COMPANION_WORKSPACE_KEY, mapMilestones, companionItems })
}

// Every test has its own error list, including tabs it opens during the scenario.
export const test = base.extend<{ browserErrors: void; appServiceWorkers: boolean }>({
  appServiceWorkers: [false, { option: true }],
  context: async ({ context, appServiceWorkers }, use) => {
    await installProfileTestHelpers(context)
    if (!appServiceWorkers) await context.addInitScript(() => {
      // Playwright's global worker blocker probes sandboxed iframes too. Keep
      // those frames opaque, and block only the app's top-level registration.
      if (window.self !== window.top || !['http:', 'https:'].includes(location.protocol) || !isSecureContext || !('serviceWorker' in navigator)) return
      navigator.serviceWorker.register = async () => { throw new DOMException('App workers are disabled in this isolated test.', 'SecurityError') }
    })
    await use(context)
  },
  browserErrors: [async ({ context }, use) => {
    const errors: string[] = []
    const watched = new Set<Page>()
    const record = (error: Error) => errors.push(error.message)
    const watch = (page: Page) => {
      if (watched.has(page)) return
      watched.add(page)
      page.on('pageerror', record)
    }
    context.pages().forEach(watch)
    context.on('page', watch)
    try { await use() } finally {
      context.off('page', watch)
      watched.forEach((page) => page.off('pageerror', record))
      expect(errors, 'Unhandled browser errors during this scenario').toEqual([])
    }
  }, { auto: true }],
})

export { expect } from '@playwright/test'
