import type { Requirement } from './types'

type LeafRequirement = Exclude<Requirement, { kind: 'all' | 'any' }>

/** Group mixed logical operators while letting the caller supply spoiler-safe leaf labels. */
export function formatRequirement(requirement: Requirement, labelLeaf: (requirement: LeafRequirement) => string): string {
  if (!('requirements' in requirement)) return labelLeaf(requirement)
  const operator = requirement.kind === 'all' ? ' AND ' : ' OR '
  return requirement.requirements.map((child) => {
    const text = formatRequirement(child, labelLeaf)
    return (child.kind === 'all' || child.kind === 'any') && child.kind !== requirement.kind ? `(${text})` : text
  }).join(operator)
}
