/** A module counts toward certification unless it is explicitly marked not-core. */
export function isCoreModule(m: { core?: boolean | null }): boolean {
  return m.core !== false;
}
