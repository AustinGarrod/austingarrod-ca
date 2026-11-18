import { reportFailure } from './reporting'
import type { DocumentStorage } from './account-repository'

/** Browser adapter only: preserve the actual storage exception for domain recovery. */
export function diagnosticStorage(document: string, getStorage: () => DocumentStorage = () => localStorage): () => DocumentStorage {
  return () => {
    let storage: DocumentStorage
    try { storage = getStorage() } catch (error) { reportFailure(error, 'storage.access', { document }); throw error }
    return new Proxy(storage, { get(target, property) {
      if (property === 'getItem') return (key: string) => {
        try { return target.getItem(key) } catch (error) { reportFailure(error, 'storage.read', { document }); throw error }
      }
      if (property === 'setItem') return (key: string, value: string) => {
        try {
          const result = target.setItem(key, value)
          if (result && typeof result.then === 'function') return result.catch((error) => { reportFailure(error, 'storage.write', { document, bytes: value.length }); throw error })
          return result
        } catch (error) { reportFailure(error, 'storage.write', { document, bytes: value.length }); throw error }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  }
}
