import type { Profile, Requirement, SourceReference } from './types'

export const COMPANION_SYSTEMS = ['achievement', 'craft', 'material', 'quest', 'village', 'enemy', 'divinity'] as const
export type CompanionSystem = typeof COMPANION_SYSTEMS[number]
export type CompanionEntityRef = { system: CompanionSystem | 'ascension'; id: string }
export type CompanionRecordField = 'completed' | 'active' | 'discovered' | 'count' | 'claimed' | 'stage' | 'selected' | 'built'
/** Absent fields are unobserved, never implicit false or zero. */
export interface CompanionRecord {
  completed?: boolean
  active?: boolean
  discovered?: boolean
  count?: string
  claimed?: boolean
  stage?: string
  selected?: boolean
  built?: boolean
}

export interface CompanionModuleProgress {
  tracked: boolean
  records: Record<string, CompanionRecord>
  observedAt?: string
  source?: 'manual' | 'save' | 'legacy' | 'reset'
}

/** Actual observed progress only. Plans, goals and reference documents live separately. */
export interface CompanionProgress {
  format: 'idle-slayer-companion-progress'
  version: 1
  catalogRevision: string
  ascension: Profile
  modules: Record<CompanionSystem, CompanionModuleProgress>
}
export type CompanionRequirement =
  | { kind: 'always' }
  | { kind: 'all' | 'any'; requirements: CompanionRequirement[] }
  | { kind: 'ascension'; requirement: Requirement }
  | { kind: 'entity'; ref: CompanionEntityRef; field: CompanionRecordField; value?: string | boolean }
  | { kind: 'unknown' }

export interface CompanionEntity {
  system: CompanionSystem
  id: string
  title: string
  description: string
  category: string
  icon?: string
  target?: string
  /** Numeric targets alone do not establish which native counter measures progress. */
  counterSupported?: boolean
  permanent?: boolean
  secret?: boolean
  steam?: boolean
  platforms?: string[]
  cost?: string
  costUnit?: string
  otherCosts?: { unit: string; quantity: string }[]
  recipe?: { materialId: string; quantity: string }[]
  sources?: CompanionEntityRef[]
  related?: CompanionEntityRef[]
  tiers?: string[]
  /** Reviewed native kill aggregation order, including related evolutions. */
  masteryCountIds?: string[]
  familyId?: string
  purchase?: CompanionRequirement
  reveal: CompanionRequirement
  provenance: SourceReference[]
}

export interface CompanionCatalog {
  schemaVersion: 1
  revision: string
  gameVersion: string
  steamBuild: string
  entities: CompanionEntity[]
  verification: { coverage: boolean; rules: boolean; assets: boolean; evidence: string[] }
}
