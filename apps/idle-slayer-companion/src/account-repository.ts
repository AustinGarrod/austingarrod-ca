import { createAccountRepository as createRepository, type AccountRepositoryOptions, type DocumentStorage as BasicDocumentStorage } from '../../../packages/accounts/repository'

export { ACCOUNT_OBJECT_STORE, type AccountRepository } from '../../../packages/accounts/repository'
export type DocumentStorage = BasicDocumentStorage & { replaceItem?: BasicDocumentStorage['setItem'] }

export function storeDocument(storage: DocumentStorage, key: string, value: string, preservePrevious: boolean) {
  return preservePrevious && storage.replaceItem ? storage.replaceItem(key, value) : storage.setItem(key, value)
}

export const ACCOUNT_DATABASE = 'idle-slayer-companion.accounts.v1'

export function createAccountRepository(options: AccountRepositoryOptions & { name?: string } = {}) {
  return createRepository({ ...options, name: options.name ?? ACCOUNT_DATABASE })
}
