import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { encodeProgressTransfer, MAX_TRANSFER_TOKEN_CHARS } from './domain/progress-transfer'
import { emptyProfile, type Catalog } from './domain/types'
import { reviewMigrationFragment, WEBSITE_COMPANION_URL } from './migration-link'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
describe('explicit website migration links', () => {
  it('drops arbitrary URL contents and starts ordinary migration with tracking off', async () => {
    for (const fragment of ['', '#private=synthetic-secret', '#transfer=v1.invalid', '#upgrade=x&catalog=y&private=secret', '#analytics=off']) {
      expect(await reviewMigrationFragment(fragment)).toEqual({ href: WEBSITE_COMPANION_URL + '?migration=1#analytics=off', kind: 'plain' })
    }
  })
  it('forwards only a bounded public upgrade reference and fixed migration marker', async () => {
    const reviewed = await reviewMigrationFragment('#upgrade=' + catalog.startId + '&catalog=' + catalog.revision)
    const target = new URL(reviewed.href)
    expect(reviewed.kind).toBe('reference')
    expect(target.origin + target.pathname).toBe(WEBSITE_COMPANION_URL)
    expect(target.search).toBe('?migration=1')
    expect(new URLSearchParams(target.hash.slice(1)).get('upgrade')).toBe(catalog.startId)
    expect(new URLSearchParams(target.hash.slice(1)).get('catalog')).toBe(catalog.revision)
  })
  it('fully validates a map-only transfer before making it a destination link', async () => {
    const encoded = await encodeProgressTransfer(catalog, emptyProfile(catalog.revision), 'native')
    if (!encoded.ok) throw new Error(encoded.error)
    const reviewed = await reviewMigrationFragment('#transfer=' + encoded.token)
    expect(reviewed.kind).toBe('transfer')
    expect(new URL(reviewed.href).hash).toBe('#transfer=' + encoded.token)
    expect(new URL(reviewed.href).search).toBe('?migration=1')
    expect(await reviewMigrationFragment('#transfer=v1.' + 'a'.repeat(MAX_TRANSFER_TOKEN_CHARS))).toEqual({ href: WEBSITE_COMPANION_URL + '?migration=1#analytics=off', kind: 'plain' })
  })
})
