/** Only these reviewed deployments may change public paths or installation identity. */
export interface CompanionDeployment {
  target: 'website' | 'legacy-migration'
  base: string
  identity: string
  origin: string
  hostname: string
  telemetryEnabled: boolean
  canonical: string
  cachePrefix: string
}

export const WEBSITE_DEPLOYMENT: CompanionDeployment = {
  target: 'website',
  base: '/utilities/idle-slayer-companion/',
  identity: '/utilities/idle-slayer-companion/',
  origin: 'https://austingarrod.ca',
  hostname: 'austingarrod.ca',
  telemetryEnabled: true,
  canonical: 'https://austingarrod.ca/utilities/idle-slayer-companion/',
  cachePrefix: 'austingarrod-idle-slayer-companion-public-',
}
export const LEGACY_DEPLOYMENT: CompanionDeployment = {
  target: 'legacy-migration',
  base: '/idle-slayer-companion/',
  identity: '/idle-slayer-ascension-map/',
  origin: 'https://austingarrod.github.io',
  hostname: 'austingarrod.github.io',
  telemetryEnabled: false,
  canonical: WEBSITE_DEPLOYMENT.canonical,
  cachePrefix: 'idle-slayer-companion-public-',
}
export function resolveDeployment(target?: string): CompanionDeployment {
  if (target === undefined || target === '' || target === 'website') return WEBSITE_DEPLOYMENT
  if (target === 'legacy-migration') return LEGACY_DEPLOYMENT
  throw new Error('Unsupported Companion deployment target: ' + target)
}
