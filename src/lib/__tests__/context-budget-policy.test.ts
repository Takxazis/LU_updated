import { beforeEach, describe, expect, it } from 'vitest'
import {
  CONTEXT_BASE_RESERVE_RATIO,
  CONTEXT_MAX_EFFECTIVE_CALIBRATION_RATIO,
  contextBudgetPolicy,
} from '../context-budget-policy'
import {
  recordCalibrationObservation,
  resetContextBudgetCalibrationForTests,
  type CalibrationIdentity,
} from '../context-budget-calibration'

const native: CalibrationIdentity = {
  provider: 'ollama',
  model: 'qwen3:14b',
  transport: 'native',
}

function observe(ratio: number, identity: CalibrationIdentity = native): void {
  recordCalibrationObservation({
    ...identity,
    estimatedPromptUnits: 1_000,
    actualPromptUnits: 1_000 * ratio,
  })
}

function policy(overrides: Partial<Parameters<typeof contextBudgetPolicy>[0]> = {}) {
  return contextBudgetPolicy({
    ...native,
    sendWindow: 6_553,
    nativeToolUnits: 2_174,
    ...overrides,
  })
}

beforeEach(() => resetContextBudgetCalibrationForTests())

describe('contextBudgetPolicy', () => {
  it('subtracts the native catalog before applying the five-percent reserve', () => {
    const result = policy()
    expect(result.baseHistoryAllowance).toBe(4_379)
    expect(result.baseReserveRatio).toBe(CONTEXT_BASE_RESERVE_RATIO)
    expect(result.baseReservedAllowance).toBe(Math.floor(4_379 * 0.95))
    expect(result.baseReserveUnits).toBe(4_379 - Math.floor(4_379 * 0.95))
    expect(result.calibratedHistoryAllowance).toBe(result.baseReservedAllowance)
  })

  it('does not subtract a separate catalog from Hermes messages', () => {
    const result = policy({ transport: 'hermes_xml' })
    expect(result.baseHistoryAllowance).toBe(6_553)
    expect(result.baseReservedAllowance).toBe(Math.floor(6_553 * 0.95))
  })

  it('preserves the unknown-window zero sentinel', () => {
    expect(policy({ sendWindow: 0 }).calibratedHistoryAllowance).toBe(0)
    expect(policy({ sendWindow: 0 }).calibrationReason).toBe('unknown_window')
  })

  it('preserves a structural floor for a known positive allowance', () => {
    const result = policy({ sendWindow: 1, nativeToolUnits: 0 })
    expect(result.baseHistoryAllowance).toBe(1)
    expect(result.baseReservedAllowance).toBe(1)
    expect(result.calibratedHistoryAllowance).toBe(1)
  })

  it('does not tighten from one high observation', () => {
    observe(1.12)
    const result = policy()
    expect(result.observationCount).toBe(1)
    expect(result.calibrationApplied).toBe(false)
    expect(result.calibrationReason).toBe('insufficient_observations')
    expect(result.calibratedHistoryAllowance).toBe(result.baseReservedAllowance)
  })

  it('uses only the base reserve when a ready median is below one', () => {
    observe(0.90)
    observe(0.91)
    observe(1.02)
    const result = policy()
    expect(result.medianAcceptedRatio).toBe(0.91)
    expect(result.effectiveCalibrationRatio).toBe(1)
    expect(result.calibrationApplied).toBe(false)
    expect(result.calibrationReason).toBe('median_not_above_one')
    expect(result.calibratedHistoryAllowance).toBe(result.baseReservedAllowance)
  })

  it('tightens after three stable underestimation observations', () => {
    observe(1.08)
    observe(1.10)
    observe(1.12)
    const result = policy()
    expect(result.medianAcceptedRatio).toBe(1.10)
    expect(result.effectiveCalibrationRatio).toBe(1.10)
    expect(result.calibrationApplied).toBe(true)
    expect(result.calibrationReason).toBe('calibration_applied')
    expect(result.calibratedHistoryAllowance).toBe(
      Math.floor(4_379 * 0.95 / 1.10),
    )
    expect(result.calibratedHistoryAllowance).toBeLessThan(result.baseReservedAllowance)
  })

  it('caps adaptive correction at the configured maximum', () => {
    observe(1.20)
    observe(1.22)
    observe(1.24)
    const result = policy()
    expect(result.medianAcceptedRatio).toBe(1.22)
    expect(result.effectiveCalibrationRatio).toBe(CONTEXT_MAX_EFFECTIVE_CALIBRATION_RATIO)
    expect(result.calibratedHistoryAllowance).toBe(
      Math.floor(4_379 * 0.95 / CONTEXT_MAX_EFFECTIVE_CALIBRATION_RATIO),
    )
  })

  it('never expands beyond the base-reserved allowance', () => {
    observe(0.80)
    observe(0.90)
    observe(1.00)
    const result = policy()
    expect(result.calibratedHistoryAllowance).toBeLessThanOrEqual(result.baseReservedAllowance)
  })

  it('keeps rejected historical mismatch samples out of policy', () => {
    observe(0.31)
    observe(1.08)
    observe(1.10)
    const result = policy()
    expect(result.observationCount).toBe(2)
    expect(result.calibrationApplied).toBe(false)
    expect(result.calibrationReason).toBe('insufficient_observations')
  })

  it('reads the Hermes bucket independently from native observations', () => {
    observe(1.10)
    observe(1.11)
    observe(1.12)
    const hermes = policy({ transport: 'hermes_xml' })
    expect(hermes.observationCount).toBe(0)
    expect(hermes.calibrationApplied).toBe(false)
  })
})
