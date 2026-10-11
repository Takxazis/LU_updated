/**
 * Shared bridge from one provider-reported prompt count to the bounded
 * session calibration cache. Agent surfaces call this after a successful turn
 * so measurement, acceptance, and telemetry fields cannot drift apart.
 */

import {
  recordCalibrationObservation,
  type CalibrationRejectionReason,
  type ContextBudgetTransport,
} from './context-budget-calibration'
import {
  measureTokenCalibration,
  type TokenCalibrationMeasurement,
} from './model-request-measurement'

export interface ContextCalibrationRecordInput {
  provider: string
  model: string
  transport: ContextBudgetTransport
  estimatedPromptUnits: number
  actualPromptUnits: number
}

export interface ContextCalibrationRecordResult extends TokenCalibrationMeasurement {
  provider: string
  model: string
  transport: ContextBudgetTransport
  sample_accepted: boolean
  rejection_reason: CalibrationRejectionReason | null
  observation_count: number
  median_accepted_ratio: number | null
  calibration_ready: boolean
}

export function recordContextCalibration(
  input: ContextCalibrationRecordInput,
): ContextCalibrationRecordResult {
  const measurement = measureTokenCalibration(
    input.estimatedPromptUnits,
    input.actualPromptUnits,
  )
  const observation = recordCalibrationObservation(input)

  return {
    provider: input.provider,
    model: input.model,
    transport: input.transport,
    ...measurement,
    sample_accepted: observation.accepted,
    rejection_reason: observation.rejectionReason,
    observation_count: observation.snapshot.observationCount,
    median_accepted_ratio: observation.snapshot.medianAcceptedRatio,
    calibration_ready: observation.snapshot.ready,
  }
}
