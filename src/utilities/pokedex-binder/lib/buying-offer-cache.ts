import { buyingStores, printingKey, type BuyingStore } from "./buying-offers";
import { freshOfferCheck, freshOffers, offerLifetime, pricingRequest, type PricingTarget, type RetailOffer, type RetailOffers } from "./pricing";

interface StoreCheck {
  store: BuyingStore;
  checkedAt: string;
  expiresAt: number;
  offers: RetailOffer[];
}
interface SavedCheck extends StoreCheck { scope: string; key: string }
interface Snapshot {
  checks: Map<BuyingStore, StoreCheck>;
  failures: Map<BuyingStore, number>;
}
interface LookupOptions { force?: boolean; signal?: AbortSignal }

const emptyOffers = (): RetailOffers => ({ offers: [], unavailableStores: [] });
const storeName = "checks";

function storeChecks(results: RetailOffers, now: number): StoreCheck[] {
  const offers = freshOffers(results.offers, now, results.expiresAt);
  return buyingStores.flatMap(store => {
    const storeOffers = offers.filter(offer => offer.store === store);
    const checkedAt = results.checkedStores?.[store] ?? storeOffers[0]?.checkedAt;
    if (!checkedAt || !freshOfferCheck(checkedAt, now)) return [];
    const validUntil = results.expiresAt?.[store];
    const expiresAt = Math.min(Date.parse(checkedAt) + offerLifetime,
      validUntil ? Date.parse(validUntil) : Infinity,
      ...storeOffers.map(offer => Date.parse(offer.checkedAt) + offerLifetime));
    return expiresAt > now ? [{ store, checkedAt, expiresAt, offers: storeOffers }] : [];
  });
}

function acceptCheck(current: StoreCheck | undefined, incoming: StoreCheck, now: number) {
  if (incoming.expiresAt <= now) return false;
  if (!current || current.expiresAt <= now) return true;
  return Date.parse(incoming.checkedAt) > Date.parse(current.checkedAt);
}

function createStorage() {
  let opening: Promise<IDBDatabase> | undefined;
  function open() {
    opening ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("austingarrod.utilities.pokemon-binder.offers", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(storeName, { keyPath: ["scope", "key", "store"] });
        store.createIndex("scope", "scope");
        store.createIndex("expiresAt", "expiresAt");
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); opening = undefined; };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("The offer cache is unavailable."));
    });
    return opening;
  }
  function transaction<T>(database: IDBDatabase, use: (store: IDBObjectStore, result: (value: T) => void) => void) {
    return new Promise<T>((resolve, reject) => {
      const tx = database.transaction(storeName, "readwrite");
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
      use(tx.objectStore(storeName), next => { value = next; });
    });
  }
  function deleteExpired(store: IDBObjectStore, now: number) {
    const request = store.index("expiresAt").openKeyCursor(IDBKeyRange.upperBound(now));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
  }
  return {
    async read(scope: string, now: number) {
      return transaction<SavedCheck[]>(await open(), (store, result) => {
        deleteExpired(store, now);
        const request = store.index("scope").getAll(scope);
        request.onsuccess = () => result(request.result);
      });
    },
    async write(scope: string, key: string, checks: StoreCheck[]) {
      await transaction<void>(await open(), store => {
        for (const check of checks) {
          const request = store.get([scope, key, check.store]);
          request.onsuccess = () => {
            if (acceptCheck(request.result, check, Date.now())) store.put({ ...check, scope, key } satisfies SavedCheck);
          };
        }
      });
    },
    async prune(now: number) {
      await transaction<void>(await open(), store => deleteExpired(store, now));
    },
  };
}

export function createBuyOfferCache(scope: () => string, changed: () => void) {
  const storage = createStorage();
  const snapshots = new Map<string, Snapshot>();
  const deadlines = new Set<number>();
  const pending = new Map<string, { controller: AbortController; signal: AbortSignal; result: Promise<RetailOffers> }>();
  let hydration: Promise<void> | undefined;
  let generation = 0;

  function snapshot(key: string) {
    let value = snapshots.get(key);
    if (!value) {
      value = { checks: new Map(), failures: new Map() };
      snapshots.set(key, value);
    }
    return value;
  }

  function hydrate() {
    const ticket = generation, owner = scope();
    hydration ??= storage.read(owner, Date.now()).then(checks => {
      if (ticket !== generation || owner !== scope()) return;
      const now = Date.now();
      for (const { scope: _scope, key, ...check } of checks) {
        const { checks: saved } = snapshot(key);
        if (acceptCheck(saved.get(check.store), check, now)) {
          saved.set(check.store, check);
          deadlines.add(check.expiresAt);
        }
      }
    }).catch(() => {});
    return hydration;
  }

  function peek(key: string, now: number) {
    const snapshot = snapshots.get(key);
    if (!snapshot) return;
    const checks = [...snapshot.checks.values()].filter(check => check.expiresAt > now);
    const unavailableStores = [...snapshot.failures].filter(([store, expiresAt]) =>
      expiresAt > now && !checks.some(check => check.store === store)).map(([store]) => store);
    if (!checks.length && !unavailableStores.length) return;
    return {
      offers: checks.flatMap(check => check.offers),
      checkedStores: Object.fromEntries(checks.map(check => [check.store, check.checkedAt])),
      expiresAt: Object.fromEntries(checks.map(check => [check.store, new Date(check.expiresAt).toISOString()])),
      unavailableStores,
    } satisfies RetailOffers;
  }

  async function record(target: PricingTarget, results: RetailOffers) {
    const key = printingKey(target), now = Date.now();
    const accepted: StoreCheck[] = [], state = snapshot(key);
    for (const check of storeChecks(results, now)) {
      state.failures.delete(check.store);
      if (!acceptCheck(state.checks.get(check.store), check, now)) continue;
      state.checks.set(check.store, check);
      deadlines.add(check.expiresAt);
      accepted.push(check);
    }
    for (const store of buyingStores) {
      if (results.unavailableStores.includes(store) && (state.checks.get(store)?.expiresAt ?? 0) <= now) {
        state.failures.set(store, now + offerLifetime);
      }
    }
    if (accepted.length) await storage.write(scope(), key, accepted).catch(() => {});
  }

  async function read(target: PricingTarget) {
    const ticket = generation;
    await hydrate();
    if (ticket === generation) return peek(printingKey(target), Date.now());
  }

  async function check(target: PricingTarget, { force = false, signal }: LookupOptions = {}): Promise<RetailOffers> {
    const ticket = generation, key = printingKey(target);
    const previous = await read(target);
    signal?.throwIfAborted();
    if (ticket !== generation) throw new DOMException("The binder account changed.", "AbortError");
    if (previous && !force) return previous;
    const existing = pending.get(key);
    if (existing && !existing.signal.aborted) return existing.result;
    const controller = new AbortController();
    const network = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    const result = pricingRequest<RetailOffers>("offers", { set: target.setId, number: target.number, variant: target.variant },
      AbortSignal.any([network, AbortSignal.timeout(20_000)]))
      .catch(() => ({ ...emptyOffers(), unavailableStores: [...buyingStores] }))
      .then(async data => {
        network.throwIfAborted();
        if (ticket !== generation) throw new DOMException("The binder account changed.", "AbortError");
        await record(target, data);
        network.throwIfAborted();
        return peek(key, Date.now()) ?? emptyOffers();
      }).finally(() => {
        if (pending.get(key)?.controller === controller) pending.delete(key);
        changed();
      });
    pending.set(key, { controller, signal: network, result });
    return result;
  }

  function expire(now: number) {
    let next = Infinity, expired = false;
    for (const at of deadlines) {
      if (at > now) next = Math.min(next, at);
      else { deadlines.delete(at); expired = true; }
    }
    for (const [key, { checks, failures }] of snapshots) {
      for (const [store, check] of checks) {
        if (check.expiresAt <= now) checks.delete(store);
      }
      for (const [store, expiresAt] of failures) {
        if (expiresAt > now) next = Math.min(next, expiresAt);
        else failures.delete(store);
      }
      if (!checks.size && !failures.size) snapshots.delete(key);
    }
    if (expired) void storage.prune(now).catch(() => {});
    return next;
  }

  function reset() {
    generation++;
    hydration = undefined;
    for (const { controller } of pending.values()) controller.abort();
    pending.clear();
    snapshots.clear();
  }

  return { hydrate, peek, read, check, expire, reset };
}
