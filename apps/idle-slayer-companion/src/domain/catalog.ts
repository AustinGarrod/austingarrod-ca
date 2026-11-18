import type { Catalog, Requirement } from './types'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9:_-]+$/.test(value) && !['constructor', '__proto__', 'prototype'].includes(value)
function validSources(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((source) => {
    if (!record(source) || typeof source.label !== 'string' || !source.label.trim()) return false
    if (source.evidence !== undefined && typeof source.evidence !== 'string') return false
    if (source.url !== undefined) {
      if (typeof source.url !== 'string' || !source.url.trim()) return false
      try {
        const url = new URL(source.url)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
      } catch { return false }
    }
    return true
  })
}

/** Validate every browser-facing record before using it, including dependency references. */
export function catalogErrors(value: unknown): string[] {
  const errors: string[] = []
  if (!record(value) || !Array.isArray(value.upgrades) || !Array.isArray(value.milestones) || !Array.isArray(value.connections) || !Array.isArray(value.grants)) return ['Invalid catalog structure.']
  for (const field of ['revision', 'gameVersion', 'steamBuild', 'startId']) if (typeof value[field] !== 'string' || !value[field]) errors.push(`Missing ${field}.`)
  const upgradeIds = new Set<string>(), milestoneIds = new Set<string>()
  for (const node of value.upgrades) {
    if (!record(node) || !safeId(node.id)) { errors.push('Invalid upgrade identity.'); continue }
    if (upgradeIds.has(node.id)) errors.push(`Duplicate upgrade ${node.id}.`)
    upgradeIds.add(node.id)
    if (typeof node.title !== 'string' || !node.title.trim() || typeof node.description !== 'string' || !node.description.trim()) errors.push(`Missing text for ${node.id}.`)
    if (typeof node.cost !== 'string' || !/^(0|[1-9][0-9]*)$/.test(node.cost)) errors.push(`Invalid decimal cost ${node.id}.`)
    if (typeof node.icon !== 'string' || !/^(?:icons|assets\/upgrades)\/[a-zA-Z0-9_-]+\.png$/.test(node.icon)) errors.push(`Invalid local icon ${node.id}.`)
    if (!record(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) errors.push(`Invalid coordinates ${node.id}.`)
    if (!['repeat', 'permanent', 'astral'].includes(String(node.retention)) || !['immediate', 'after-ultra-ascension'].includes(String(node.activation))) errors.push(`Invalid reset policy ${node.id}.`)
    if (node.activation === 'after-ultra-ascension' && node.retention === 'repeat') errors.push(`Repeat upgrade cannot have an Astral lock ${node.id}.`)
    if (!validSources(node.sources)) errors.push(`Invalid source ${node.id}.`)
  }
  for (const item of value.milestones) {
    if (!record(item) || !safeId(item.id)) { errors.push('Invalid milestone identity.'); continue }
    if (milestoneIds.has(item.id)) errors.push(`Duplicate milestone ${item.id}.`)
    milestoneIds.add(item.id)
    if (typeof item.title !== 'string' || !item.title.trim() || typeof item.description !== 'string' || !item.description.trim()) errors.push(`Missing milestone text ${item.id}.`)
    if (!validSources(item.sources)) errors.push(`Invalid milestone source ${item.id}.`)
  }
  function requirement(item: unknown, path: string, depth = 0) {
    if (depth > 100 || !record(item)) { errors.push(`Invalid requirement ${path}.`); return }
    if (item.kind === 'always' || item.kind === 'ultra-ascended') return
    if (item.kind === 'all' || item.kind === 'any') {
      if (!Array.isArray(item.requirements) || (item.kind === 'any' && item.requirements.length === 0)) { errors.push(`Invalid expression ${path}.`); return }
      item.requirements.forEach((child, index) => requirement(child, `${path}/${index}`, depth + 1)); return
    }
    if (item.kind === 'owned' || item.kind === 'active') {
      if (!upgradeIds.has(String(item.id))) errors.push(`Unresolved upgrade reference ${path}.`); return
    }
    if (item.kind === 'milestone') {
      if (!milestoneIds.has(String(item.id))) errors.push(`Unresolved milestone reference ${path}.`); return
    }
    errors.push(`Unknown requirement ${path}.`)
  }
  for (const node of value.upgrades) if (record(node)) { requirement(node.purchase, `${node.id}/purchase`); requirement(node.reveal, `${node.id}/reveal`) }
  for (const item of value.milestones) if (record(item)) requirement(item.reveal, `${item.id}/reveal`)
  const connectionIds = new Set<string>()
  for (const edge of value.connections) {
    if (!record(edge) || !upgradeIds.has(String(edge.from)) || !upgradeIds.has(String(edge.to)) || edge.from === edge.to) { errors.push('Invalid connection.'); continue }
    const key = `${edge.from}:${edge.to}`
    if (connectionIds.has(key)) errors.push(`Duplicate connection ${key}.`)
    connectionIds.add(key)
  }
  for (const retention of value.grants) {
    if (!record(retention) || !Array.isArray(retention.ids) || !retention.ids.every((id) => upgradeIds.has(String(id)))) { errors.push('Invalid conditional retention rule.'); continue }
    requirement(retention.when, 'conditional retention rule')
  }
  requirement(value.ultraAscension, 'Ultra Ascension')
  if (!upgradeIds.has(String(value.startId))) errors.push('Start upgrade is missing.')
  if (!record(value.verification) || !Array.isArray(value.verification.evidence)) errors.push('Missing verification evidence.')
  else for (const field of ['coverage', 'purchaseRules', 'revealRules', 'resetRules', 'assets']) if (typeof value.verification[field] !== 'boolean') errors.push(`Missing verification field ${field}.`)
  if (errors.length) return errors
  // External milestones and an Ultra Ascension may be entered explicitly. Active
  // prerequisites can become active after a reset, so reachability is monotonic.
  const catalog = value as unknown as Catalog
  const reachable = new Set<string>()
  function reachableRequirement(item: Requirement): boolean {
    if (item.kind === 'always' || item.kind === 'ultra-ascended' || item.kind === 'milestone') return true
    if (item.kind === 'owned' || item.kind === 'active') return reachable.has(item.id)
    if (item.kind === 'all') return item.requirements.every(reachableRequirement)
    if (item.kind === 'any') return item.requirements.some(reachableRequirement)
    return false
  }
  let count = -1
  while (count !== reachable.size) {
    count = reachable.size
    for (const node of catalog.upgrades) if (reachableRequirement(node.purchase) && reachableRequirement(node.reveal)) reachable.add(node.id)
  }
  for (const id of upgradeIds) if (!reachable.has(id)) errors.push(`No reachable dependency/reveal path for ${id}.`)
  return errors
}
