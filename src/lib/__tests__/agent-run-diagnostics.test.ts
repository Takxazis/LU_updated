import { describe, expect, it } from 'vitest'
import { createAgentRunDiagnostics } from '../agent-run-diagnostics'

function run() {
  return createAgentRunDiagnostics({
    surface: 'agent',
    provider: 'ollama',
    model: 'qwen3:14b',
    transport: 'native',
    conversationId: 'conv-1',
    startedAt: 1_000,
  })
}

describe('createAgentRunDiagnostics', () => {
  it('aggregates request peaks, iterations, and compaction totals', () => {
    const diagnostics = run()
    diagnostics.recordIteration()
    diagnostics.recordIteration()
    diagnostics.recordRequestMeasurement({
      estimated_total_units: 2_984,
      estimated_tool_units: 1_379,
      model_fill_ratio: 0.36,
      send_window_fill_ratio: 0.45,
    })
    diagnostics.recordRequestMeasurement({
      estimated_total_units: 3_662,
      estimated_tool_units: 1_261,
      model_fill_ratio: 0.44,
      send_window_fill_ratio: 0.56,
    })
    diagnostics.recordCompaction({
      trimmedResults: 2,
      savedChars: 4_000,
      prunedPlans: 1,
      droppedImages: 0,
    })
    diagnostics.recordCompaction({
      trimmedResults: 0,
      savedChars: 0,
      prunedPlans: 0,
      droppedImages: 0,
    })

    const summary = diagnostics.finalize({
      status: 'completed',
      reason: 'model_completed',
      finishedAt: 1_250,
    })

    expect(summary).toMatchObject({
      iteration_count: 2,
      context_measurement_count: 2,
      peak_estimated_prompt_units: 3_662,
      peak_catalog_units: 1_379,
      peak_model_fill_ratio: 0.44,
      peak_send_window_fill_ratio: 0.56,
      compaction_event_count: 1,
      trimmed_result_count: 2,
      pruned_plan_count: 1,
      dropped_image_count: 0,
      saved_chars: 4_000,
      duration_ms: 250,
    })
  })

  it('keeps completed, failed, rejected, and cached tool calls separate', () => {
    const diagnostics = run()
    diagnostics.recordExecutionResults([
      { status: 'completed', durationMs: 10 },
      { status: 'failed', durationMs: 20 },
      { status: 'rejected', durationMs: 0 },
      { status: 'cached', durationMs: 2 },
    ])
    const summary = diagnostics.finalize({
      status: 'halted',
      reason: 'loop_guard_halt',
      finishedAt: 1_100,
    })

    expect(summary).toMatchObject({
      tool_call_count: 4,
      completed_tool_count: 1,
      failed_tool_count: 1,
      rejected_tool_count: 1,
      cached_tool_count: 1,
      tool_duration_ms: 32,
    })
  })

  it('tracks actual prompt peaks and the final calibration state', () => {
    const diagnostics = run()
    diagnostics.recordCalibration({
      actual_prompt_units: 2_700,
      sample_accepted: true,
      observation_count: 1,
      median_accepted_ratio: 0.90,
    })
    diagnostics.recordPolicy({ calibrationApplied: false })
    diagnostics.recordCalibration({
      actual_prompt_units: 3_746,
      sample_accepted: true,
      observation_count: 2,
      median_accepted_ratio: 0.96,
    })
    diagnostics.recordPolicy({ calibrationApplied: true })

    const summary = diagnostics.finalize({
      status: 'completed',
      reason: 'model_completed',
      finishedAt: 1_200,
    })

    expect(summary).toMatchObject({
      peak_actual_prompt_units: 3_746,
      calibration_sample_count: 2,
      calibration_observation_count: 2,
      final_calibration_median: 0.96,
      final_calibration_applied: true,
    })
  })

  it('returns one stable summary and ignores late records', () => {
    const diagnostics = run()
    diagnostics.recordIteration()
    const first = diagnostics.finalize({
      status: 'stopped',
      reason: 'user_stop',
      finishedAt: 1_050,
    })

    diagnostics.recordIteration()
    diagnostics.recordExecutionResults([{ status: 'failed', durationMs: 99 }])
    const second = diagnostics.finalize({
      status: 'failed',
      reason: 'provider_error',
      finishedAt: 9_999,
    })

    expect(diagnostics.isFinalized()).toBe(true)
    expect(second).toBe(first)
    expect(second).toMatchObject({
      iteration_count: 1,
      tool_call_count: 0,
      completion_status: 'stopped',
      completion_reason: 'user_stop',
      finished_at: 1_050,
    })
  })

  it('sanitizes invalid numeric inputs without inventing counts', () => {
    const diagnostics = run()
    diagnostics.recordRequestMeasurement({
      estimated_total_units: Number.NaN,
      estimated_tool_units: -1,
      model_fill_ratio: Number.POSITIVE_INFINITY,
      send_window_fill_ratio: -2,
    })
    diagnostics.recordCompaction({
      trimmedResults: -1,
      savedChars: Number.NaN,
      prunedPlans: -2,
      droppedImages: Number.POSITIVE_INFINITY,
    })
    diagnostics.recordExecutionResults([{ status: 'completed', durationMs: -5 }])

    const summary = diagnostics.finalize({
      status: 'failed',
      reason: 'unknown_error',
      finishedAt: 900,
    })

    expect(summary).toMatchObject({
      duration_ms: 0,
      context_measurement_count: 1,
      peak_estimated_prompt_units: 0,
      peak_catalog_units: 0,
      peak_model_fill_ratio: 0,
      peak_send_window_fill_ratio: 0,
      compaction_event_count: 0,
      saved_chars: 0,
      tool_call_count: 1,
      completed_tool_count: 1,
      tool_duration_ms: 0,
    })
  })
})
