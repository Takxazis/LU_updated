import { estimateTokens } from './context-compaction'

/**
 * Estimated units occupied by the native tool catalog on the wire.
 *
 * An empty list means no catalog payload and therefore costs zero. Running the
 * shared estimator over the serialized `[]` would invent two units that are
 * not part of a real catalog.
 *
 * Serialization errors are deliberately not hidden. A catalog that cannot be
 * serialized cannot be sent either, and silently budgeting it as zero would
 * make the request estimate dishonest.
 */
export function toolCatalogUnits(tools: readonly unknown[]): number {
  if (tools.length === 0) return 0
  return estimateTokens(JSON.stringify(tools))
}

/**
 * The part of one send window available to messages after the native catalog.
 *
 * Zero is the existing sentinel for an unknown model window and stays zero.
 * For a known window, one unit is the structural floor: the message compactor
 * still needs to preserve the mandatory request shape when the catalog alone
 * fills or exceeds the window.
 */
export function toolAwareHistoryAllowance(
  sendWindow: number,
  toolUnits: number,
): number {
  if (sendWindow === 0) return 0
  return Math.max(1, sendWindow - toolUnits)
}
