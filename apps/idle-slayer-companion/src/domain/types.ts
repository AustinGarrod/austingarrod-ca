export type Requirement =
  | { kind: 'always' }
  | { kind: 'ultra-ascended' }
  | { kind: 'all' | 'any'; requirements: Requirement[] }
  | { kind: 'owned' | 'active'; id: string }
  | { kind: 'milestone'; id: string }

export interface SourceReference {
  label: string
  url?: string
  evidence?: string
}

export interface Upgrade {
  id: string
  title: string
  description: string
  cost: string
  icon: string
  position: { x: number; y: number }
  purchase: Requirement
  reveal: Requirement
  retention: 'repeat' | 'permanent' | 'astral'
  activation: 'immediate' | 'after-ultra-ascension'
  sources: SourceReference[]
}

export interface Milestone {
  id: string
  title: string
  description: string
  reveal: Requirement
  sources: SourceReference[]
}

export interface Catalog {
  revision: string
  gameVersion: string
  steamBuild: string
  startId: string
  upgrades: Upgrade[]
  milestones: Milestone[]
  connections: { from: string; to: string }[]
  /** Legacy catalog field name: conditional retention of existing purchases, never awarded ownership. */
  grants: { when: Requirement; ids: string[] }[]
  ultraAscension: Requirement
  verification: {
    coverage: boolean
    purchaseRules: boolean
    revealRules: boolean
    resetRules: boolean
    assets: boolean
    evidence: string[]
  }
}

export const MAX_PROFILE_EPOCH = Number.MAX_SAFE_INTEGER

export interface Profile {
  version: 1
  catalogRevision: string
  epoch: number
  purchases: Record<string, { epoch: number; active: boolean }>
  milestones: Record<string, true>
  showSpoilers: boolean
}

export function emptyProfile(revision: string): Profile {
  return {
    version: 1,
    catalogRevision: revision,
    epoch: 0,
    purchases: {},
    milestones: {},
    showSpoilers: false,
  }
}
