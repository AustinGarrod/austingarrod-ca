import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Catalog } from './types'
import { emptyProfile } from './types'
import { createReferenceSheet } from './reference-sheet'
import { visibility } from './rules'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
describe('portable public reference sheets', () => {
  it('filters before all output, retains no private profile facts, and bounds explicit unique selections', () => {
    const viewer = { ...emptyProfile(catalog.revision), epoch: 7, purchases: { 'private-sheet-record': { epoch: 4, active: true } } }
    const hidden = catalog.upgrades.find((upgrade) => !visibility(catalog, viewer).ids.has(upgrade.id))!
    const sheet = createReferenceSheet(catalog, viewer, [hidden.id, 'unknown-private-id', catalog.startId, catalog.startId])
    expect(sheet.ids).toEqual([catalog.startId])
    for (const privateText of [hidden.id, hidden.title, 'unknown-private-id', 'private-sheet-record', '"epoch"', '"purchases"']) expect(sheet.html).not.toContain(privateText)
    expect(createReferenceSheet(catalog, { ...viewer, showSpoilers: true }, catalog.upgrades.map((upgrade) => upgrade.id)).ids).toHaveLength(4)
    expect(sheet.html).not.toContain('<script')
  })
  it('preserves exact duplicate-title identities, mixed AND/OR, native activation and provenance', () => {
    const keys = catalog.upgrades.filter((upgrade) => upgrade.title === 'Astral Key')
    const belt = catalog.upgrades.find((upgrade) => upgrade.title === 'Legendary Belt')!
    const lock = catalog.upgrades.find((upgrade) => upgrade.activation === 'after-ultra-ascension')!
    const sheet = createReferenceSheet(catalog, { ...emptyProfile(catalog.revision), showSpoilers: true }, [keys[0].id, keys.at(-1)!.id, belt.id, lock.id])
    expect(sheet.html).toContain(keys[0].id); expect(sheet.html).toContain(keys.at(-1)!.id)
    expect(sheet.html).toContain(BigInt(keys.at(-1)!.cost).toLocaleString('en'))
    expect(sheet.html).toContain(' OR ')
    expect(sheet.html).toContain('leaves it pending until a full native Ultra Ascension transition')
    expect(sheet.html).toContain(catalog.revision); expect(sheet.html).toContain(catalog.gameVersion)
    expect(sheet.html).toContain('Pablo Leban'); expect(sheet.html).toContain('not complete routes')
  })
  it('groups mixed operators exactly while omitting hidden leaves and their grouping', () => {
    const source = structuredClone(catalog)
    const ids = source.upgrades.slice(0, 3).map((node) => node.id)
    source.upgrades[0].purchase = { kind: 'all', requirements: [{ kind: 'active', id: ids[0] }, { kind: 'any', requirements: [{ kind: 'active', id: ids[1] }, { kind: 'active', id: ids[2] }] }] }
    const html = createReferenceSheet(source, { ...emptyProfile(source.revision), showSpoilers: true }, [ids[0]]).html
    expect(html).toContain(' AND ('); expect(html).toContain(' OR ')
  })
  it('escapes native text and source attributes without exporting graph layout or executing content', () => {
    const source = structuredClone(catalog)
    const upgrade = source.upgrades.find((node) => node.id === source.startId)!
    upgrade.title = '<script>private-title</script>'
    upgrade.description = '"native" & <effect>'
    upgrade.sources = [{ label: '<source>', url: 'https://example.test/?x="&y=<value>' }]
    const html = createReferenceSheet(source, emptyProfile(source.revision), [upgrade.id]).html
    expect(html).toContain('&lt;script&gt;private-title&lt;/script&gt;')
    expect(html).toContain('&quot;native&quot; &amp; &lt;effect&gt;')
    expect(html).toContain('x=&quot;&amp;y=&lt;value&gt;')
    expect(html).not.toContain('<script>'); expect(html).not.toContain('"connections"'); expect(html).not.toContain('"position"')
  })
})
