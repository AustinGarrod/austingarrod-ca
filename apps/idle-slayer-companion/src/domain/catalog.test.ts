import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { catalogErrors } from './catalog'
import type { Catalog } from './types'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const receipt = JSON.parse(readFileSync('data/catalog-receipt.json', 'utf8')) as {
  catalogSha256: string; nativeNodeCount: number; nativeEdgeCount: number; nativeMethodsReceiptSha256: string;
  nodes: { id: string; position: { x: number; y: number }; cost: string; requirements: string[];
    icon: { sha256: string }; normalized: { purchase: unknown; reveal: unknown; retention: string; activation: string } }[];
  connections: { from: string; to: string }[]; visualReview: { complete: boolean };
}
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('installed-game catalog', () => {
  it('has complete referenced, reachable, typed records and local assets', () => {
    expect(catalogErrors(catalog)).toEqual([])
    expect(catalog.upgrades).toHaveLength(288)
    expect(new Set(catalog.upgrades.map((node) => node.id)).size).toBe(288)
    expect(catalog.connections).toHaveLength(318)
    for (const node of catalog.upgrades) expect(existsSync(`public/${node.icon}`), node.id).toBe(true)
  })
  it('rejects missing references, imprecise costs and invented paths', () => {
    const invalid = structuredClone(catalog)
    invalid.upgrades[0].purchase = { kind: 'owned', id: 'missing' }
    invalid.upgrades[1].cost = '1e30'
    invalid.upgrades[2].icon = '../../.local-game/raw.png'
    expect(catalogErrors(invalid)).toEqual(expect.arrayContaining([
      expect.stringContaining('Unresolved upgrade'), expect.stringContaining('Invalid decimal'), expect.stringContaining('Invalid local icon'),
    ]))
  })
  it('keeps duplicate titles as separate native identities', () => {
    const keys = catalog.upgrades.filter((node) => node.title === 'Astral Key')
    expect(keys.length).toBeGreaterThan(1)
    expect(new Set(keys.map((node) => node.id)).size).toBe(keys.length)
  })
  it.each([null, [], 'source', { label: '' }, { label: 3 }, { label: 'Source', url: {} }, { label: 'Source', url: '' }, { label: 'Source', url: '/relative' }, { label: 'Source', url: 'javascript:alert(1)' }, { label: 'Source', url: 'https://user:example@example.test' }, { label: 'Source', evidence: false }].map((source) => [source]))('rejects malformed upgrade and milestone provenance: %j', (source) => {
    for (const collection of ['upgrades', 'milestones'] as const) {
      const invalid = structuredClone(catalog)
      Object.assign(invalid[collection][0], { sources: [source] })
      expect(catalogErrors(invalid)).toEqual(expect.arrayContaining([expect.stringContaining('source')]))
    }
  })
  it('accepts native evidence-only and safe linked source records', () => {
    const valid = structuredClone(catalog)
    valid.upgrades[0].sources = [{ label: 'Reviewed native evidence', evidence: 'Native registry receipt' }, { label: 'Public source', url: 'https://example.test/source' }]
    expect(catalogErrors(valid)).toEqual([])
  })
  it('matches the reviewed native registry, coordinates, rules and sprite bytes', () => {
    expect(sha('public/catalog.json')).toBe(receipt.catalogSha256)
    expect(sha('scripts/logic/native-method-receipt.json')).toBe(receipt.nativeMethodsReceiptSha256)
    expect(receipt.nativeNodeCount).toBe(catalog.upgrades.length)
    expect(receipt.nativeEdgeCount).toBe(catalog.connections.length)
    expect(receipt.visualReview.complete).toBe(true)
    expect(new Set(receipt.nodes.map((node) => node.id))).toEqual(new Set(catalog.upgrades.map((node) => node.id)))
    expect(new Set(receipt.connections.map((edge) => `${edge.from}:${edge.to}`))).toEqual(new Set(catalog.connections.map((edge) => `${edge.from}:${edge.to}`)))
    for (const node of catalog.upgrades) {
      const native = receipt.nodes.find((entry) => entry.id === node.id)!
      expect(node.position, node.id).toEqual(native.position)
      expect(node.cost, node.id).toBe(native.cost)
      expect(node.purchase, node.id).toEqual(native.normalized.purchase)
      expect(node.reveal, node.id).toEqual(native.normalized.reveal)
      expect(node.retention, node.id).toBe(native.normalized.retention)
      expect(node.activation, node.id).toBe(native.normalized.activation)
      expect(sha(`public/${node.icon}`), node.id).toBe(native.icon.sha256)
    }
  })
  it('binds the independent native predicate audit to this exact catalog and interpreter', () => {
    const audit = JSON.parse(readFileSync('data/native-rule-validation.json', 'utf8'))
    expect(audit.catalogSha256).toBe(sha('public/catalog.json'))
    expect(audit.validatorSha256).toBe(sha('scripts/logic/validate_catalog_rules.py'))
    expect(audit.nativeMethodReceiptSha256).toBe(sha('scripts/logic/native-method-receipt.json'))
    expect(audit.checks.purchaseTruthTableCases + audit.checks.revealTruthTableCases).toBe(10574)
    for (const [key, result] of Object.entries(audit.checks)) if (key.endsWith('Matches') || key.endsWith('Match')) expect(result, key).toBe(true)
  })
})
