/**
 * Shared history-allowance policy for agent request compaction.
 *
 * Native transports pay for their separate tool catalog before the reserve.
 * Prompt transports already carry their catalog inside the system message and
 * therefore must not subtract it a second time.
 */

import {
  getCalibrationSnapshot,
  type CalibrationIdentity,
  type ContextBudgetTransport,
} from './context-budget-calibration'
import { toolAwareHistoryAllowance } from './tool-catalog-budget'

export const CONTEXT_BASE_RESERVE_RATIO = 0.05
export const CONTEXT_MAX_EFFECTIVE_CALIBRATION_RATIO = 1.15

export type ContextBudgetPolicyReason =
  | 'unknown_window'
  | 'insufficient_observations'
  | 'median_not_above_one'
  | 'calibration_applied'

export interface ContextBudgetPolicyInput extends CalibrationIdentity {
  sendWindow: number
  nativeToolUnits: number
}

export interface ContextBudgetPolicyResult {
  provider: string
  model: string
  transport: ContextBudgetTransport
  baseHistoryAllowance: number
  baseReserveRatio: number
  baseReserveUnits: number
  baseReservedAllowance: number
  observationCount: number
  medianAcceptedRatio: number | null
  effectiveCalibrationRatio: number
  calibratedHistoryAllowance: number
  calibrationApplied: boolean
  calibrationReason: ContextBudgetPolicyReason
}

function knownAllowanceFloor(value: number): number {
  return Math.max(1, Math.floor(value))
}

export function contextBudgetPolicy(
  input: ContextBudgetPolicyInput,
): ContextBudgetPolicyResult {
  const snapshot = getCalibrationSnapshot(input)
  const baseHistoryAllowance = input.transport === 'native'
    ? toolAwareHistoryAllowance(input.sendWindow, input.nativeToolUnits)
    : input.sendWindow

  if (baseHistoryAllowance <= 0) {
    return {
      provider: input.provider,
      model: input.model,
      transport: input.transport,
      baseHistoryAllowance: 0,
      baseReserveRatio: CONTEXT_BASE_RESERVE_RATIO,
      baseReserveUnits: 0,
      baseReservedAllowance: 0,
      observationCount: snapshot.observationCount,
      medianAcceptedRatio: snapshot.medianAcceptedRatio,
      effectiveCalibrationRatio: 1,
      calibratedHistoryAllowance: 0,
      calibrationApplied: false,
      calibrationReason: 'unknown_window',
    }
  }

  const baseReservedAllowance = knownAllowanceFloor(
    baseHistoryAllowance * (1 - CONTEXT_BASE_RESERVE_RATIO),
  )
  const baseReserveUnits = baseHistoryAllowance - baseReservedAllowance
  const median = snapshot.medianAcceptedRatio
  const canCalibrate = snapshot.ready && median !== null && median > 1
  const effectiveCalibrationRatio = canCalibrate
    ? Math.min(median, CONTEXT_MAX_EFFECTIVE_CALIBRATION_RATIO)
    : 1
  const calibratedHistoryAllowance = canCalibrate
    ? Math.min(
        baseReservedAllowance,
        knownAllowanceFloor(
          baseHistoryAllowance * (1 - CONTEXT_BASE_RESERVE_RATIO)
            / effectiveCalibrationRatio,
        ),
      )
    : baseReservedAllowance

  const calibrationReason: ContextBudgetPolicyReason = !snapshot.ready
    ? 'insufficient_observations'
    : canCalibrate
      ? 'calibration_applied'
      : 'median_not_above_one'

  return {
    provider: input.provider,
    model: input.model,
    transport: input.transport,
    baseHistoryAllowance,
    baseReserveRatio: CONTEXT_BASE_RESERVE_RATIO,
    baseReserveUnits,
    baseReservedAllowance,
    observationCount: snapshot.observationCount,
    medianAcceptedRatio: median,
    effectiveCalibrationRatio,
    calibratedHistoryAllowance,
    calibrationApplied: canCalibrate,
    calibrationReason,
  }
}
