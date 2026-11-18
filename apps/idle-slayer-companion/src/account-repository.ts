import { createAccountRepository as createRepository, type AccountRepositoryOptions } from '../../../packages/accounts/repository'

export { ACCOUNT_OBJECT_STORE, type AccountRepository, type DocumentStorage } from '../../../packages/accounts/repository'

export const ACCOUNT_DATABASE = 'idle-slayer-companion.accounts.v1'

export function createAccountRepository(options: AccountRepositoryOptions & { name?: string } = {}) {
  return createRepository({ ...options, name: options.name ?? ACCOUNT_DATABASE })
}
