import { beforeEach, describe, expect, it } from 'vitest'
import {
  getCalibrationSnapshot,
  resetContextBudgetCalibrationForTests,
} from '../context-budget-calibration'
import { recordContextCalibration } from '../context-calibration-recorder'

const identity = {
  provider: 'ollama',
  model: 'qwen3:14b',
  transport: 'native' as const,
}

beforeEach(() => resetContextBudgetCalibrationForTests())

describe('recordContextCalibration', () => {
  it('returns the existing token-calibration measurement and cache metadata', () => {
    const result = recordContextCalibration({
      ...identity,
      estimatedPromptUnits: 3_000,
      actualPromptUnits: 3_300,
    })

    expect(result).toMatchObject({
      ...identity,
      estimated_prompt_units: 3_000,
      actual_prompt_units: 3_300,
      absolute_error: 300,
      calibration_ratio: 1.1,
      sample_accepted: true,
      rejection_reason: null,
      observation_count: 1,
      median_accepted_ratio: 1.1,
      calibration_ready: false,
    })
    expect(result.relative_error).toBe(300 / 3_300)
  })

  it('rejects an anomalous sample without adding it to the cache', () => {
    const result = recordContextCalibration({
      ...identity,
      estimatedPromptUnits: 13_207,
      actualPromptUnits: 4_098,
    })

    expect(result.sample_accepted).toBe(false)
    expect(result.rejection_reason).toBe('ratio_below_minimum')
    expect(result.observation_count).toBe(0)
    expect(result.calibration_ready).toBe(false)
    expect(getCalibrationSnapshot(identity).recentAcceptedRatios).toEqual([])
  })

  it('becomes ready only after three accepted observations', () => {
    for (const actualPromptUnits of [1_010, 1_020, 1_030]) {
      recordContextCalibration({
        ...identity,
        estimatedPromptUnits: 1_000,
        actualPromptUnits,
      })
    }

    const result = recordContextCalibration({
      ...identity,
      estimatedPromptUnits: 1_000,
      actualPromptUnits: 1_040,
    })
    expect(result.observation_count).toBe(4)
    expect(result.median_accepted_ratio).toBeCloseTo(1.025)
    expect(result.calibration_ready).toBe(true)
  })

  it('keeps native and Hermes observations separate', () => {
    recordContextCalibration({
      ...identity,
      estimatedPromptUnits: 1_000,
      actualPromptUnits: 1_100,
    })
    const hermes = recordContextCalibration({
      ...identity,
      transport: 'hermes_xml',
      estimatedPromptUnits: 1_000,
      actualPromptUnits: 1_050,
    })

    expect(hermes.observation_count).toBe(1)
    expect(hermes.median_accepted_ratio).toBe(1.05)
    expect(getCalibrationSnapshot(identity).recentAcceptedRatios).toEqual([1.1])
  })

  it('reports invalid actual usage with stable telemetry fields', () => {
    const result = recordContextCalibration({
      ...identity,
      estimatedPromptUnits: 1_000,
      actualPromptUnits: 0,
    })

    expect(result.sample_accepted).toBe(false)
    expect(result.rejection_reason).toBe('invalid_actual_usage')
    expect(result.observation_count).toBe(0)
    expect(result.median_accepted_ratio).toBeNull()
  })
})
