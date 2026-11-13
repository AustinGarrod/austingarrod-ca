import { reportFailure } from './reporting'

/** Browser adapter only: preserve the actual storage exception for domain recovery. */
export function diagnosticStorage(document: string, getStorage: () => Storage = () => localStorage): () => Storage {
  return () => {
    let storage: Storage
    try { storage = getStorage() } catch (error) { reportFailure(error, 'storage.access', { document }); throw error }
    return new Proxy(storage, { get(target, property) {
      if (property === 'getItem') return (key: string) => {
        try { return target.getItem(key) } catch (error) { reportFailure(error, 'storage.read', { document }); throw error }
      }
      if (property === 'setItem') return (key: string, value: string) => {
        try { target.setItem(key, value) } catch (error) { reportFailure(error, 'storage.write', { document, bytes: value.length }); throw error }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  }
}
