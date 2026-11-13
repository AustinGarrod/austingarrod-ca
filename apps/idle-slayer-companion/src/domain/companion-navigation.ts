import { runtimeDeployment } from '../runtime-deployment'

export const COMPANION_BASE = runtimeDeployment.base
export const LEGACY_BASE = '/idle-slayer-ascension-map/'
export const COMPANION_SECTIONS = ['overview', 'ascension', 'achievements', 'crafting', 'quests', 'bestiary', 'divinities'] as const
export type Section = typeof COMPANION_SECTIONS[number]
export function sectionPath(section: Section, base = COMPANION_BASE) { return section === 'overview' ? base : `${base}${section}/` }
export function sectionAtPath(path: string, base = COMPANION_BASE): Section | null {
  if (path === base || path === `${base}index.html`) return 'overview'
  return COMPANION_SECTIONS.find((section) => section !== 'overview' && [sectionPath(section, base), `${sectionPath(section, base)}index.html`].includes(path)) ?? null
}
