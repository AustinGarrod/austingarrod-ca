import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { runtimeNoticesPlugin } from './scripts/runtime-notices.ts'
import { pwaPlugin } from './scripts/pwa.ts'
import { reportingBuildPlugin, reportingRelease, reportingCommit } from './scripts/reporting-build.ts'
import { resolveDeployment } from './deployment.ts'
import { retirementBuildPlugin } from './scripts/retirement-build.ts'

const release = reportingRelease(process.cwd())
const deployment = resolveDeployment(process.env.COMPANION_DEPLOY_TARGET, process.env.COMPANION_LEGACY_BASE)
const retired = deployment.target === 'legacy-migration'

export default defineConfig({
  base: deployment.base,
  define: { 'import.meta.env.VITE_COMPANION_TARGET': JSON.stringify(deployment.target), 'import.meta.env.VITE_REPORTING_RELEASE': JSON.stringify(release), 'import.meta.env.VITE_REPORTING_COMMIT': JSON.stringify(reportingCommit(process.cwd())) },
  build: { sourcemap: retired ? false : 'hidden', copyPublicDir: !retired },
  plugins: [react(), ...(retired ? [retirementBuildPlugin(process.cwd())] : []), runtimeNoticesPlugin(process.cwd(), retired), ...(!retired ? [reportingBuildPlugin(process.cwd(), release)] : []), pwaPlugin(process.cwd(), deployment), {
    name: 'companion-document-metadata',
    transformIndexHtml(html) {
      return html.replace('<!-- COMPANION_METADATA -->', [
        `<link rel="canonical" href="${deployment.canonical}">`,
        '<meta property="og:type" content="website">',
        `<meta property="og:title" content="${retired ? 'Idle Slayer Companion has moved' : 'Idle Slayer Companion | Austin Garrod'}">`,
        `<meta property="og:url" content="${deployment.canonical}">`,
        `<meta property="og:description" content="${retired ? 'Move your saved Idle Slayer Companion data to AustinGarrod.ca. This former application is retired.' : 'An unofficial Idle Slayer companion with Ascension planning, progress tracking, crafting, quests, Bestiary and Divinities.'}">`,
        '<meta property="og:image" content="https://austingarrod.ca/images/projects/idle-slayer-companion.webp">',
        ...(deployment.target === 'legacy-migration' ? ['<meta name="robots" content="noindex">'] : []),
        '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Idle Slayer Companion', url: deployment.canonical, applicationCategory: 'GameApplication', operatingSystem: 'Any modern browser', isAccessibleForFree: true, author: { '@type': 'Person', name: 'Austin Garrod', url: 'https://austingarrod.ca/' } }).replace(/</g, '\\u003c') + '</script>',
      ].join('\n'))
    },
  }],
  server: {
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem}',
        '**/.git/**',
        '**/.local-game/**',
        '**/Idle Slayer_Data/**',
        '**/*.dll',
        '**/*.sav',
        '**/appmanifest_1353300.acf',
      ],
    },
  },
})
