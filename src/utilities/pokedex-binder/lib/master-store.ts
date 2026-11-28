import { type AccountClient, type DocumentWrite, type RemoteDocument } from "../../../../packages/accounts/client";
import { BinderRecovery } from "./recovery";
import { emptyMaster, sameSave as equal, validateMaster, type MasterState, type SetBinder } from "./master";
import { cardMarks, mergeCardMarks } from "./model";

export const app = "pokedex-binder",
  documentName = "master-sets";
export interface SetSave {
  state: MasterState;
  baseline: MasterState;
  revision: number;
  sequence: number;
  clientId: string;
  flight: DocumentWrite<MasterState> | null;
  conflict: RemoteDocument<MasterState> | null;
  preservePrevious?: true;
}
const fresh = (): SetSave => ({
  state: emptyMaster(),
  baseline: emptyMaster(),
  revision: 0,
  sequence: 0,
  clientId: crypto.randomUUID(),
  flight: null,
  conflict: null,
});
function remoteState(remote: RemoteDocument<MasterState>) {
  if (
    remote.app !== app ||
    remote.document !== documentName ||
    remote.schemaVersion !== 1 ||
    !Number.isSafeInteger(remote.revision) ||
    remote.revision < 1
  )
    throw new Error("Unsupported account set binders.");
  return validateMaster(remote.state);
}
/** Merge independent checkmarks and settings. A competing edit to one field needs review. */
function mergeLibrary(
  base: MasterState,
  device: MasterState,
  remote: MasterState,
  keepBoth = false,
): MasterState | null {
  const result = structuredClone(remote);
  for (const id of new Set([...base.binders, ...device.binders].map((b) => b.id))) {
    const before = base.binders.find((b) => b.id === id);
    const local = device.binders.find((b) => b.id === id);
    const index = result.binders.findIndex((b) => b.id === id);
    const other = result.binders[index];
    if (equal(local, before) || equal(local, other)) continue;
    if (equal(other, before)) {
      if (index >= 0) result.binders.splice(index, 1, ...(local ? [structuredClone(local)] : []));
      else if (local) result.binders.push(structuredClone(local));
      continue;
    }
    let merged: SetBinder | undefined;
    if (before && local && other) {
      merged = structuredClone(other);
      const fields = ["setId", "name", "goal", "order", "settings"] as const;
      for (const key of fields) {
        if (equal(local[key], before[key])) continue;
        if (!equal(other[key], before[key]) && !equal(other[key], local[key])) {
          merged = undefined;
          break;
        }
        Object.assign(merged, { [key]: structuredClone(local[key]) });
      }
      if (merged) {
        const marks = (binder: SetBinder) => cardMarks(binder.owned, binder.ordered);
        const statuses = mergeCardMarks(marks(before), marks(local), marks(other));
        const owned: string[] = [], ordered: string[] = [];
        for (const [key, status] of statuses) (status === "owned" ? owned : ordered).push(key);
        merged.owned = owned.sort();
        if (ordered.length) merged.ordered = ordered.sort();
        else delete merged.ordered;
        const specialties = new Set(other.specialties);
        const previous = new Set(before.specialties);
        const next = new Set(local.specialties);
        for (const key of previous) if (!next.has(key)) specialties.delete(key);
        for (const key of next) if (!previous.has(key)) specialties.add(key);
        merged.specialties = [...specialties].sort();
        const extras = new Map(other.extras.map((e) => [e.id, e]));
        for (const eid of new Set([...before.extras, ...local.extras].map((e) => e.id))) {
          const prior = before.extras.find((e) => e.id === eid),
            next = local.extras.find((e) => e.id === eid),
            latest = extras.get(eid);
          if (equal(prior, next) || equal(next, latest)) continue;
          if (!equal(prior, latest)) {
            merged = undefined;
            break;
          }
          if (next) extras.set(eid, next);
          else extras.delete(eid);
        }
        if (merged) merged.extras = [...extras.values()];
      }
    }
    if (merged) result.binders[index] = merged;
    else if (!keepBoth) return null;
    else if (local)
      result.binders.push({
        ...structuredClone(local),
        id: crypto.randomUUID(),
        name: local.name.slice(0, 91) + " (device)",
      });
  }
  return validateMaster(result);
}
/** Says whether an unresolved conflict involves a binder deleted on one side and changed on the other. */
export function conflictInvolvesDelete(save: Pick<SetSave, "state" | "baseline" | "conflict">) {
  const remote = save.conflict?.state;
  if (!remote) return false;
  return save.baseline.binders.some((before) => {
    const local = save.state.binders.find((b) => b.id === before.id);
    const other = remote.binders.find((b) => b.id === before.id);
    return (!local && other && !equal(other, before)) || (!other && local && !equal(local, before));
  });
}
export class MasterStore {
  constructor(readonly db: BinderRecovery) {}
  async read(scope: string) {
    return (await this.db.get<SetSave>("sets:" + scope)) ?? fresh();
  }
  /** Deletes one set binder. An account keeps the version before the delete as a recovery copy. */
  remove(scope: string, id: string) {
    return this.update(scope, (save) => {
      const kept = save.state.binders.filter((b) => b.id !== id);
      if (kept.length === save.state.binders.length) throw new Error("This binder was already deleted.");
      save.state.binders = kept;
      if (scope !== "guest") save.preservePrevious = true;
    });
  }
  update(scope: string, apply: (s: SetSave) => void, signal?: AbortSignal) {
    return this.db.update<SetSave>("sets:" + scope, (current) => {
      const save = current ?? fresh();
      apply(save);
      validateMaster(save.state);
      return save;
    }, signal);
  }
  async sync(scope: string, client: AccountClient, active: () => boolean) {
    if (scope === "guest" || !active()) return;
    await navigator.locks.request("pokedex-master-sync:" + scope, async () => {
      const initial = await this.update(scope, () => {});
      if (!active() || initial.conflict) return;
      const save = await this.update(scope, (current) => {
        if (!current.flight && !equal(current.state, current.baseline)) {
          current.flight = {
            app,
            document: documentName,
            schemaVersion: 1,
            state: structuredClone(current.state),
            clientId: current.clientId,
            baseRevision: current.revision,
            mutationSequence: current.sequence + 1,
            operationId: crypto.randomUUID(),
            ...(current.preservePrevious ? { preservePrevious: true } : {}),
          };
          delete current.preservePrevious;
        }
      });
      let remote: RemoteDocument<MasterState> | null;
      let rejected = false;
      try {
        if (!active()) return;
        remote = save.flight
          ? await client.writeDocument(save.flight)
          : await client.getDocument(app, documentName, save.clientId);
      } catch (error) {
        if (!(
          error &&
          typeof error === "object" &&
          "status" in error &&
          error.status === 409 &&
          "remote" in error &&
          error.remote
        ))
          throw error;
        remote = error.remote as RemoteDocument<MasterState>;
        rejected = true;
      }
      if (!remote || !active()) return;
      const state = remoteState(remote);
      await this.update(scope, (current) => {
        if (
          current.revision !== save.revision ||
          current.flight?.operationId !== save.flight?.operationId ||
          remote.revision < current.revision
        )
          return;
        const base = !rejected && save.flight ? save.flight.state : current.baseline;
        const merged = mergeLibrary(base, current.state, state);
        if (rejected && save.flight?.preservePrevious) current.preservePrevious = true;
        if (!merged) {
          current.conflict = remote;
          current.flight = null;
          return;
        }
        current.state = merged;
        current.baseline = state;
        if (equal(merged, state)) delete current.preservePrevious;
        current.sequence = remote.acknowledgedSequence;
        current.revision = remote.revision;
        current.flight = null;
      });
    });
  }
  async adopt(scope: string, remote: RemoteDocument<MasterState>, readClient: string, guestBefore: MasterState) {
    const confirmed = remoteState(remote);
    const guestNow = (await this.read("guest")).state;
    await this.update(scope, (current) => {
      // An older account outbox must replay with its original bytes. Normal sync reconciles it after opening.
      const pending =
        !!current.flight ||
        !!current.conflict ||
        !equal(current.state, current.baseline) ||
        current.revision > remote.revision;
      if (!pending) {
        current.baseline = confirmed;
        current.state = confirmed;
        current.revision = remote.revision;
        current.sequence = current.clientId === readClient ? remote.acknowledgedSequence : 0;
      }
      current.state = mergeLibrary(guestBefore, guestNow, current.state, true)!;
    });
  }
  async resolve(scope: string) {
    await this.update(scope, (current) => {
      const other = current.conflict;
      if (!other) return;
      current.state = mergeLibrary(current.baseline, current.state, other.state, true)!;
      current.baseline = other.state;
      current.revision = other.revision;
      current.sequence = other.acknowledgedSequence;
      current.flight = null;
      current.conflict = null;
    });
  }
}
