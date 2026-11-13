// Deliberate delivery receipt, separate from browser regressions. Local app only.
import { chromium } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
if (process.env.REPORTING_DELIVERY_CHECK !== 'true') throw new Error('Set REPORTING_DELIVERY_CHECK=true after building with VITE_REPORTING_ENABLED=true and VITE_REPORTING_ENVIRONMENT=verification.')
const url = 'http://127.0.0.1:4173/utilities/idle-slayer-companion/'
const browser = await chromium.launch()
const receipts = []
try {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route('https://analytics.garrod.house/**', (route) => route.abort())
  await context.route('**/companion-catalog.json', (route) => route.fulfill({ contentType: 'application/json', body: '{"invalid":true}' }))
  const page = await context.newPage()
  page.on('requestfinished', async (request) => {
    if (!request.url().startsWith('https://reports.garrod.house/api/7/envelope/')) return
    const lines = (request.postData() || '').split('\n')
    const items = []
    for (let i = 1; i < lines.length; i += 2) {
      try { items.push({ type: JSON.parse(lines[i]).type, payload: JSON.parse(lines[i + 1]) }) } catch { /* envelope trailer */ }
    }
    receipts.push({ status: (await request.response())?.status(), items })
  })
  await page.goto(url)
  await page.getByRole('button', { name: 'Idle Slayer Companion overview', exact: true }).waitFor()
  await page.evaluate(() => {
    setTimeout(() => { throw new Error('Reporting verification: uncaught exception', { cause: new TypeError('Reporting verification: original cause') }) }, 0)
    setTimeout(() => { void Promise.reject(new Error('Reporting verification: unhandled promise rejection')) }, 200)
    console.warn('Reporting verification: structured browser log')
  })
  await page.waitForTimeout(20000)
  const items = receipts.flatMap((receipt) => receipt.items)
  if (!receipts.length || receipts.some((receipt) => receipt.status !== 200)) throw new Error('Reporting envelope delivery failed')
  const events = items.filter((item) => item.type === 'event').map((item) => item.payload)
  if (!events.some((event) => event.tags?.operation === 'catalog.load')) throw new Error('Catalog failure was not reported')
  if (!events.some((event) => event.exception?.values?.some((value) => value.value?.includes('unhandled promise rejection')))) throw new Error('Unhandled promise rejection was not delivered')
  if (!events.some((event) => event.exception?.values?.length > 1)) throw new Error('Original exception chain was lost')
  if (!items.some((item) => item.type === 'transaction')) throw new Error('No complete performance transaction delivered')
  if (!items.some((item) => item.type === 'log')) throw new Error('No structured logs delivered')
  mkdirSync('.cache/reporting', { recursive: true })
  writeFileSync('.cache/reporting/delivery-receipt.json', JSON.stringify({ url, receipts }, null, 2))
  console.log(JSON.stringify({ envelopes: receipts.length, items: items.map((item) => ({ type: item.type, event_id: item.payload.event_id, release: item.payload.release, operation: item.payload.tags?.operation })) }, null, 2))
} finally { await browser.close() }
