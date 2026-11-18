import { describe, expect, it } from 'vitest'
import { LEGACY_DEPLOYMENT, LEGACY_MAP_DEPLOYMENT, resolveDeployment, WEBSITE_DEPLOYMENT } from '../deployment'

describe('historical transfer-only deployment selection', () => {
  it('keeps the maintained website the default and retains both historical worker prefixes', () => {
    expect(resolveDeployment()).toEqual(WEBSITE_DEPLOYMENT)
    expect(resolveDeployment('legacy-migration')).toEqual(LEGACY_DEPLOYMENT)
    expect(resolveDeployment('legacy-migration', '/idle-slayer-companion/')).toEqual(LEGACY_DEPLOYMENT)
    expect(resolveDeployment('legacy-migration', '/idle-slayer-ascension-map/')).toEqual(LEGACY_MAP_DEPLOYMENT)
    expect(LEGACY_MAP_DEPLOYMENT.identity).toBe(LEGACY_DEPLOYMENT.identity)
    expect(LEGACY_MAP_DEPLOYMENT.cachePrefix).not.toBe(LEGACY_DEPLOYMENT.cachePrefix)
    expect(LEGACY_MAP_DEPLOYMENT.telemetryEnabled).toBe(false)
  })
  it.each(['/unreviewed/', '//other.test/', '../private', ''])('rejects an unreviewed historical base %j', (base) => {
    expect(() => resolveDeployment('legacy-migration', base)).toThrow('Unsupported historical')
  })
  it('cannot change the website base through the legacy override', () => {
    expect(() => resolveDeployment('website', LEGACY_MAP_DEPLOYMENT.base)).toThrow('requires the legacy-migration target')
    expect(() => resolveDeployment(undefined, LEGACY_MAP_DEPLOYMENT.base)).toThrow('requires the legacy-migration target')
  })
})
