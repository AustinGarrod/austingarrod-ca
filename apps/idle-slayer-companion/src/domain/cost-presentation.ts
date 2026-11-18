/** Exact presentation only; costs never pass through floating-point arithmetic. */
export function presentCost(value: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Cost must be a canonical decimal integer.')
  const groups = value.match(/^[0-9]{1,3}(?=(?:[0-9]{3})*$)|[0-9]{3}/g)!
  const exact = groups.join(',')
  const fraction = value.slice(1).replace(/0+$/, '')
  return {
    exact,
    groups,
    scientific: value.length >= 13 ? { coefficient: value[0] + (fraction ? `.${fraction}` : ''), exponent: value.length - 1 } : null,
  }
}
