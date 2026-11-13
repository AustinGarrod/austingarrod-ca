import { describe, expect, it } from 'vitest'
import { parseUpgradeReference, upgradeReferenceURL } from './upgrade-reference'

describe('public upgrade references', () => {
  it('round-trips the exact native ID and catalog context without sender state', () => {
    const url = new URL(upgradeReferenceURL('https://example.invalid/map/?private=discard#old', 'native-key-2', 'steam-25551532-v1'))
    expect(url.search).toBe('')
    expect(parseUpgradeReference(url.hash)).toEqual({ kind: 'reference', id: 'native-key-2', revision: 'steam-25551532-v1' })
    expect([...new URLSearchParams(url.hash.slice(1)).keys()]).toEqual(['upgrade', 'catalog'])
  })
  it('does not reinterpret unrelated or opt-out fragments as references', () => {
    for (const hash of ['', '#analytics=off', '#private=fixture', '#unrelated']) expect(parseUpgradeReference(hash)).toBeNull()
  })
  it('refuses malformed, duplicate, extra and unbounded reference fields', () => {
    for (const hash of ['#upgrade=one', '#upgrade=one&catalog=', '#upgrade=one&catalog=rev&profile=private', '#upgrade=one&upgrade=two&catalog=rev', '#upgrade=%3Cscript%3E&catalog=rev', '#upgrade=one&catalog=%2Fprivate', `#upgrade=${'x'.repeat(129)}&catalog=rev`, `#upgrade=one&catalog=${'x'.repeat(513)}`]) expect(parseUpgradeReference(hash)).toEqual({ kind: 'invalid' })
  })
  it('distinguishes two native identities with the same display title', () => {
    expect(upgradeReferenceURL('https://example.invalid/map/', 'astral-key-one', 'rev')).not.toBe(upgradeReferenceURL('https://example.invalid/map/', 'astral-key-two', 'rev'))
    expect(() => upgradeReferenceURL('https://example.invalid/', 'private space', 'rev')).toThrow()
  })
})
