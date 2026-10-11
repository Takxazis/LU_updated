import { beforeEach, describe, expect, it } from 'vitest'
import {
  CALIBRATION_MAX_OBSERVATIONS,
  getCalibrationSnapshot,
  recordCalibrationObservation,
  resetContextBudgetCalibrationForTests,
  type CalibrationIdentity,
} from '../context-budget-calibration'

const native: CalibrationIdentity = {
  provider: 'ollama',
  model: 'qwen3:14b',
  transport: 'native',
}

function record(ratio: number, identity: CalibrationIdentity = native) {
  return recordCalibrationObservation({
    ...identity,
    estimatedPromptUnits: 1_000,
    actualPromptUnits: 1_000 * ratio,
  })
}

beforeEach(() => resetContextBudgetCalibrationForTests())

describe('context budget calibration cache', () => {
  it('accepts a valid ratio and exposes it in the snapshot', () => {
    const result = record(1.1)
    expect(result.accepted).toBe(true)
    expect(result.rejectionReason).toBeNull()
    expect(result.snapshot.recentAcceptedRatios).toEqual([1.1])
  })

  it('rejects the historical low mismatch without learning from it', () => {
    const result = record(0.31)
    expect(result.accepted).toBe(false)
    expect(result.rejectionReason).toBe('ratio_below_minimum')
    expect(result.snapshot.observationCount).toBe(0)
  })

  it('rejects a ratio above the accepted range', () => {
    const result = record(1.26)
    expect(result.accepted).toBe(false)
    expect(result.rejectionReason).toBe('ratio_above_maximum')
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid estimate %s',
    (estimatedPromptUnits) => {
      const result = recordCalibrationObservation({
        ...native,
        estimatedPromptUnits,
        actualPromptUnits: 1_000,
      })
      expect(result.accepted).toBe(false)
      expect(result.rejectionReason).toBe('invalid_estimate')
    },
  )

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid actual usage %s',
    (actualPromptUnits) => {
      const result = recordCalibrationObservation({
        ...native,
        estimatedPromptUnits: 1_000,
        actualPromptUnits,
      })
      expect(result.accepted).toBe(false)
      expect(result.rejectionReason).toBe('invalid_actual_usage')
    },
  )

  it('keeps provider, model, and transport buckets separate', () => {
    record(1.01)
    record(1.02, { ...native, provider: 'openai' })
    record(1.03, { ...native, model: 'other-model' })
    record(1.04, { ...native, transport: 'hermes_xml' })

    expect(getCalibrationSnapshot(native).recentAcceptedRatios).toEqual([1.01])
    expect(getCalibrationSnapshot({ ...native, provider: 'openai' }).recentAcceptedRatios).toEqual([1.02])
    expect(getCalibrationSnapshot({ ...native, model: 'other-model' }).recentAcceptedRatios).toEqual([1.03])
    expect(getCalibrationSnapshot({ ...native, transport: 'hermes_xml' }).recentAcceptedRatios).toEqual([1.04])
  })

  it('shares a bucket across callers because surface is not part of identity', () => {
    record(1.01)
    record(1.02)
    expect(getCalibrationSnapshot(native).observationCount).toBe(2)
  })

  it('retains only the bounded newest accepted observations', () => {
    for (let i = 1; i <= CALIBRATION_MAX_OBSERVATIONS + 2; i++) record(1 + i / 100)
    const snapshot = getCalibrationSnapshot(native)
    expect(snapshot.observationCount).toBe(CALIBRATION_MAX_OBSERVATIONS)
    expect(snapshot.recentAcceptedRatios[0]).toBeCloseTo(1.03)
    expect(snapshot.recentAcceptedRatios.at(-1)).toBeCloseTo(1.10)
  })

  it('computes odd and even medians without changing insertion order', () => {
    record(1.2)
    record(0.9)
    record(1.0)
    let snapshot = getCalibrationSnapshot(native)
    expect(snapshot.medianAcceptedRatio).toBe(1.0)
    expect(snapshot.recentAcceptedRatios).toEqual([1.2, 0.9, 1.0])

    record(1.1)
    snapshot = getCalibrationSnapshot(native)
    expect(snapshot.medianAcceptedRatio).toBeCloseTo(1.05)
    expect(snapshot.recentAcceptedRatios).toEqual([1.2, 0.9, 1.0, 1.1])
  })

  it('reports not ready until three accepted observations exist', () => {
    expect(getCalibrationSnapshot(native).ready).toBe(false)
    record(1.01)
    record(1.02)
    expect(getCalibrationSnapshot(native).ready).toBe(false)
    record(1.03)
    expect(getCalibrationSnapshot(native).ready).toBe(true)
  })

  it('reset clears all session observations', () => {
    record(1.1)
    resetContextBudgetCalibrationForTests()
    expect(getCalibrationSnapshot(native)).toMatchObject({
      observationCount: 0,
      recentAcceptedRatios: [],
      medianAcceptedRatio: null,
      ready: false,
    })
  })
})
