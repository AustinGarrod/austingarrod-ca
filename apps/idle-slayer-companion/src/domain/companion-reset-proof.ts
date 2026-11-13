import type { Profile } from './types'
import { sameRecordedProfile } from './checkpoints'

/** Ephemeral certificates cannot be imported, persisted, inferred from labels or recovered after reload. */
const proofs = new WeakMap<object, { before: Profile; after: Profile; revision: string }>()
export function certifyCompanionReset(entry: object, before: Profile, after: Profile, revision: string) { proofs.set(entry, { before, after, revision }) }
export function copyCompanionResetProof(from: object, to: object) { const proof = proofs.get(from); if (proof) proofs.set(to, proof) }
export function companionResetProofMatches(entry: object, before: Profile, after: Profile, revision: string) {
  const proof = proofs.get(entry)
  return !!proof && proof.revision === revision && sameRecordedProfile(proof.before, before) && sameRecordedProfile(proof.after, after)
}
