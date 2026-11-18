export type UpgradeReference = { kind: 'reference'; id: string; revision: string } | { kind: 'invalid' }
const token = /^[a-zA-Z0-9._-]{1,128}$/

/** Public identity only. Unknown URL data never becomes a profile or display label. */
export function parseUpgradeReference(hash: string): UpgradeReference | null {
  if (!hash.startsWith('#upgrade=') && !hash.includes('&upgrade=')) return null
  if (hash.length > 512) return { kind: 'invalid' }
  const fields = new URLSearchParams(hash.slice(1))
  if (fields.size !== 2 || fields.getAll('upgrade').length !== 1 || fields.getAll('catalog').length !== 1) return { kind: 'invalid' }
  const id = fields.get('upgrade')!, revision = fields.get('catalog')!
  return token.test(id) && token.test(revision) ? { kind: 'reference', id, revision } : { kind: 'invalid' }
}

export function upgradeReferenceURL(base: string, id: string, revision: string): string {
  if (!token.test(id) || !token.test(revision)) throw new Error('Invalid public reference identity')
  const url = new URL(base)
  url.search = ''
  url.hash = new URLSearchParams({ upgrade: id, catalog: revision }).toString()
  return url.toString()
}
