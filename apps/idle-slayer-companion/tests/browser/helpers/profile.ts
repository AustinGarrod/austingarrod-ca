import type { Page } from '@playwright/test'
import type { Profile } from '../../../src/domain/types'
import { PROFILE_STORAGE_KEY } from '../../../src/domain/storage'
import { COMPANION_STORAGE_KEY } from '../../../src/domain/companion-storage'

// Explicit synthetic profiles only. Retain edits across reload when requested.
export async function seedProfile(page: Page, profile: Profile, onlyWhenAbsent = false) {
  await page.addInitScript(({ key, profile, onlyWhenAbsent }) => {
    if (!onlyWhenAbsent || localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(profile))
  }, { key: PROFILE_STORAGE_KEY, profile, onlyWhenAbsent })
}

export async function denyProfileWrites(page: Page, flag: 'denyProfileWrites' | 'failProfileWrites' = 'denyProfileWrites') {
  await page.addInitScript(({ key, flag }) => {
    const win = window as Window & { denyProfileWrites?: boolean; failProfileWrites?: boolean }
    win[flag] = true
    const native = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if (name === key && win[flag]) throw new DOMException('Synthetic quota refusal', 'QuotaExceededError')
      native.call(this, name, value)
    }
  }, { key: COMPANION_STORAGE_KEY, flag })
}
