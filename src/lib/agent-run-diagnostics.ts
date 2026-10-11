/**
 * Pure, session-local accumulator for one Agent or Codex turn.
 *
 * The hooks own lifecycle classification and pass an explicit final status and
 * reason. This module only aggregates typed measurements and guarantees that
 * finalize() returns one stable snapshot.
 */

export type AgentRunSurface = 'agent' | 'codex'
export type AgentRunTransport = 'native' | 'hermes_xml'
export type AgentRunCompletionStatus = 'completed' | 'stopped' | 'halted' | 'failed'
export type AgentRunCompletionReason =
  | 'model_completed'
  | 'model_cutoff'
  | 'budget_exhausted'
  | 'loop_guard_halt'
  | 'user_stop'
  | 'queued_cancelled'
  | 'credits_exhausted'
  | 'signed_out'
  | 'provider_error'
  | 'template_refusal'
  | 'tools_unsupported'
  | 'flash_timeout'
  | 'unknown_error'

export interface AgentRunDiagnosticsInput {
  surface: AgentRunSurface
  provider: string
  model: string
  transport: AgentRunTransport
  conversationId: string
  startedAt?: number
}

export interface RunRequestMeasurement {
  estimated_total_units: number
  estimated_tool_units: number
  model_fill_ratio: number
  send_window_fill_ratio: number
}

export interface RunCompactionMeasurement {
  trimmedResults: number
  savedChars: number
  prunedPlans: number
  droppedImages: number
}

export type RunExecutionStatus = 'completed' | 'failed' | 'rejected' | 'cached'

export interface RunExecutionResult {
  status: RunExecutionStatus
  durationMs?: number
}

export interface RunCalibrationMeasurement {
  actual_prompt_units: number
  sample_accepted: boolean
  observation_count: number
  median_accepted_ratio: number | null
}

export interface RunPolicyMeasurement {
  calibrationApplied: boolean
}

export interface AgentRunDiagnosticsSummary {
  event: 'lu_agent_run_diagnostics_summary'
  surface: AgentRunSurface
  provider: string
  model: string
  transport: AgentRunTransport
  conversation_id: string
  started_at: number
  finished_at: number
  duration_ms: number
  iteration_count: number
  tool_call_count: number
  completed_tool_count: number
  failed_tool_count: number
  rejected_tool_count: number
  cached_tool_count: number
  tool_duration_ms: number
  context_measurement_count: number
  peak_estimated_prompt_units: number
  peak_actual_prompt_units: number
  peak_catalog_units: number
  peak_model_fill_ratio: number
  peak_send_window_fill_ratio: number
  compaction_event_count: number
  trimmed_result_count: number
  pruned_plan_count: number
  dropped_image_count: number
  saved_chars: number
  calibration_sample_count: number
  calibration_observation_count: number
  final_calibration_median: number | null
  final_calibration_applied: boolean
  completion_status: AgentRunCompletionStatus
  completion_reason: AgentRunCompletionReason
}

export interface FinalizeAgentRunDiagnosticsInput {
  status: AgentRunCompletionStatus
  reason: AgentRunCompletionReason
  finishedAt?: number
}

export interface AgentRunDiagnostics {
  recordIteration: () => void
  recordRequestMeasurement: (measurement: RunRequestMeasurement) => void
  recordCompaction: (measurement: RunCompactionMeasurement) => void
  recordExecutionResults: (results: readonly RunExecutionResult[]) => void
  recordCalibration: (measurement: RunCalibrationMeasurement) => void
  recordPolicy: (measurement: RunPolicyMeasurement) => void
  finalize: (input: FinalizeAgentRunDiagnosticsInput) => AgentRunDiagnosticsSummary
  isFinalized: () => boolean
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function createAgentRunDiagnostics(input: AgentRunDiagnosticsInput): AgentRunDiagnostics {
  const startedAt = input.startedAt ?? Date.now()
  let finalized: AgentRunDiagnosticsSummary | null = null
  let iterationCount = 0
  let toolCallCount = 0
  let completedToolCount = 0
  let failedToolCount = 0
  let rejectedToolCount = 0
  let cachedToolCount = 0
  let toolDurationMs = 0
  let contextMeasurementCount = 0
  let peakEstimatedPromptUnits = 0
  let peakActualPromptUnits = 0
  let peakCatalogUnits = 0
  let peakModelFillRatio = 0
  let peakSendWindowFillRatio = 0
  let compactionEventCount = 0
  let trimmedResultCount = 0
  let prunedPlanCount = 0
  let droppedImageCount = 0
  let savedChars = 0
  let calibrationSampleCount = 0
  let calibrationObservationCount = 0
  let finalCalibrationMedian: number | null = null
  let finalCalibrationApplied = false

  const active = (): boolean => finalized === null

  return {
    recordIteration: () => {
      if (!active()) return
      iterationCount += 1
    },

    recordRequestMeasurement: (measurement) => {
      if (!active()) return
      contextMeasurementCount += 1
      peakEstimatedPromptUnits = Math.max(
        peakEstimatedPromptUnits,
        finiteNonNegative(measurement.estimated_total_units),
      )
      peakCatalogUnits = Math.max(
        peakCatalogUnits,
        finiteNonNegative(measurement.estimated_tool_units),
      )
      peakModelFillRatio = Math.max(
        peakModelFillRatio,
        finiteNonNegative(measurement.model_fill_ratio),
      )
      peakSendWindowFillRatio = Math.max(
        peakSendWindowFillRatio,
        finiteNonNegative(measurement.send_window_fill_ratio),
      )
    },

    recordCompaction: (measurement) => {
      if (!active()) return
      const trimmed = finiteNonNegative(measurement.trimmedResults)
      const pruned = finiteNonNegative(measurement.prunedPlans)
      const dropped = finiteNonNegative(measurement.droppedImages)
      const saved = finiteNonNegative(measurement.savedChars)
      if (trimmed > 0 || pruned > 0 || dropped > 0) compactionEventCount += 1
      trimmedResultCount += trimmed
      prunedPlanCount += pruned
      droppedImageCount += dropped
      savedChars += saved
    },

    recordExecutionResults: (results) => {
      if (!active()) return
      for (const result of results) {
        toolCallCount += 1
        toolDurationMs += finiteNonNegative(result.durationMs ?? 0)
        if (result.status === 'completed') completedToolCount += 1
        else if (result.status === 'failed') failedToolCount += 1
        else if (result.status === 'rejected') rejectedToolCount += 1
        else cachedToolCount += 1
      }
    },

    recordCalibration: (measurement) => {
      if (!active()) return
      calibrationSampleCount += 1
      peakActualPromptUnits = Math.max(
        peakActualPromptUnits,
        finiteNonNegative(measurement.actual_prompt_units),
      )
      calibrationObservationCount = Math.max(
        calibrationObservationCount,
        finiteNonNegative(measurement.observation_count),
      )
      finalCalibrationMedian = measurement.median_accepted_ratio
    },

    recordPolicy: (measurement) => {
      if (!active()) return
      finalCalibrationApplied = measurement.calibrationApplied
    },

    finalize: ({ status, reason, finishedAt = Date.now() }) => {
      if (finalized) return finalized
      finalized = {
        event: 'lu_agent_run_diagnostics_summary',
        surface: input.surface,
        provider: input.provider,
        model: input.model,
        transport: input.transport,
        conversation_id: input.conversationId,
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: Math.max(0, finishedAt - startedAt),
        iteration_count: iterationCount,
        tool_call_count: toolCallCount,
        completed_tool_count: completedToolCount,
        failed_tool_count: failedToolCount,
        rejected_tool_count: rejectedToolCount,
        cached_tool_count: cachedToolCount,
        tool_duration_ms: toolDurationMs,
        context_measurement_count: contextMeasurementCount,
        peak_estimated_prompt_units: peakEstimatedPromptUnits,
        peak_actual_prompt_units: peakActualPromptUnits,
        peak_catalog_units: peakCatalogUnits,
        peak_model_fill_ratio: peakModelFillRatio,
        peak_send_window_fill_ratio: peakSendWindowFillRatio,
        compaction_event_count: compactionEventCount,
        trimmed_result_count: trimmedResultCount,
        pruned_plan_count: prunedPlanCount,
        dropped_image_count: droppedImageCount,
        saved_chars: savedChars,
        calibration_sample_count: calibrationSampleCount,
        calibration_observation_count: calibrationObservationCount,
        final_calibration_median: finalCalibrationMedian,
        final_calibration_applied: finalCalibrationApplied,
        completion_status: status,
        completion_reason: reason,
      }
      return finalized
    },

    isFinalized: () => finalized !== null,
  }
}
