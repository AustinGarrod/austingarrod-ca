import { decodeProgressTransfer, MAX_TRANSFER_TOKEN_CHARS } from './domain/progress-transfer'
import { parseUpgradeReference } from './domain/upgrade-reference'

export const WEBSITE_COMPANION_URL = 'https://austingarrod.ca/utilities/idle-slayer-companion/'
export interface MigrationLink { href: string; kind: 'plain' | 'reference' | 'transfer' }
const plain: MigrationLink = { href: WEBSITE_COMPANION_URL + '?migration=1#analytics=off', kind: 'plain' }
let current = plain
const listeners = new Set<() => void>()

/** No arbitrary URL fields, saved browser documents or unvalidated transfer bytes cross origins. */
export async function reviewMigrationFragment(fragment: string): Promise<MigrationLink> {
  const reference = parseUpgradeReference(fragment)
  if (reference?.kind === 'reference') {
    const target = new URL(WEBSITE_COMPANION_URL)
    target.searchParams.set('migration', '1')
    target.hash = new URLSearchParams({ upgrade: reference.id, catalog: reference.revision }).toString()
    return { href: target.href, kind: 'reference' }
  }
  if (fragment.startsWith('#transfer=') && fragment.length <= MAX_TRANSFER_TOKEN_CHARS + 10) {
    const token = fragment.slice('#transfer='.length)
    const checked = await decodeProgressTransfer(token, 'migration-link-validation')
    if (checked.ok) {
      const target = new URL(WEBSITE_COMPANION_URL)
      target.searchParams.set('migration', '1')
      target.hash = 'transfer=' + token
      return { href: target.href, kind: 'transfer' }
    }
  }
  return plain
}

/** Called before the existing inbox/reference receivers remove startup fragments. */
export function captureMigrationLink(win: Pick<Window, 'location'>): void {
  const fragment = win.location.hash
  current = plain
  void reviewMigrationFragment(fragment).then((reviewed) => { current = reviewed; listeners.forEach((listener) => listener()) })
}
export const getMigrationLink = () => current
export const subscribeMigrationLink = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
