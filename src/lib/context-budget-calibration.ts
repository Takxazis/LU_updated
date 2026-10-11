/**
 * Session-only calibration observations for context budgeting.
 *
 * The cache is deliberately process-local and bounded. Model builds, quants,
 * templates, providers, and request assembly can change while retaining the
 * same model name, so observations must not survive an LU restart.
 */

export type ContextBudgetTransport = 'native' | 'hermes_xml'

export interface CalibrationIdentity {
  provider: string
  model: string
  transport: ContextBudgetTransport
}

export interface CalibrationObservationInput extends CalibrationIdentity {
  estimatedPromptUnits: number
  actualPromptUnits: number
}

export type CalibrationRejectionReason =
  | 'invalid_estimate'
  | 'invalid_actual_usage'
  | 'non_finite_ratio'
  | 'ratio_below_minimum'
  | 'ratio_above_maximum'

export interface CalibrationSnapshot extends CalibrationIdentity {
  observationCount: number
  recentAcceptedRatios: readonly number[]
  medianAcceptedRatio: number | null
  ready: boolean
}

export interface CalibrationObservationResult {
  accepted: boolean
  ratio: number | null
  rejectionReason: CalibrationRejectionReason | null
  snapshot: CalibrationSnapshot
}

export const CALIBRATION_MIN_RATIO = 0.8
export const CALIBRATION_MAX_RATIO = 1.25
export const CALIBRATION_MIN_OBSERVATIONS = 3
export const CALIBRATION_MAX_OBSERVATIONS = 8

const acceptedRatios = new Map<string, number[]>()

function calibrationKey(identity: CalibrationIdentity): string {
  return JSON.stringify([identity.provider, identity.model, identity.transport])
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]!
  return (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function getCalibrationSnapshot(identity: CalibrationIdentity): CalibrationSnapshot {
  const ratios = acceptedRatios.get(calibrationKey(identity)) ?? []
  return {
    ...identity,
    observationCount: ratios.length,
    recentAcceptedRatios: [...ratios],
    medianAcceptedRatio: median(ratios),
    ready: ratios.length >= CALIBRATION_MIN_OBSERVATIONS,
  }
}

export function recordCalibrationObservation(
  input: CalibrationObservationInput,
): CalibrationObservationResult {
  let rejectionReason: CalibrationRejectionReason | null = null
  let ratio: number | null = null

  if (!Number.isFinite(input.estimatedPromptUnits) || input.estimatedPromptUnits <= 0) {
    rejectionReason = 'invalid_estimate'
  } else if (!Number.isFinite(input.actualPromptUnits) || input.actualPromptUnits <= 0) {
    rejectionReason = 'invalid_actual_usage'
  } else {
    ratio = input.actualPromptUnits / input.estimatedPromptUnits
    if (!Number.isFinite(ratio)) rejectionReason = 'non_finite_ratio'
    else if (ratio < CALIBRATION_MIN_RATIO) rejectionReason = 'ratio_below_minimum'
    else if (ratio > CALIBRATION_MAX_RATIO) rejectionReason = 'ratio_above_maximum'
  }

  if (rejectionReason) {
    return {
      accepted: false,
      ratio,
      rejectionReason,
      snapshot: getCalibrationSnapshot(input),
    }
  }

  const key = calibrationKey(input)
  const next = [...(acceptedRatios.get(key) ?? []), ratio!]
    .slice(-CALIBRATION_MAX_OBSERVATIONS)
  acceptedRatios.set(key, next)

  return {
    accepted: true,
    ratio,
    rejectionReason: null,
    snapshot: getCalibrationSnapshot(input),
  }
}

/** Test-only reset. Production state otherwise lives until the process exits. */
export function resetContextBudgetCalibrationForTests(): void {
  acceptedRatios.clear()
}
