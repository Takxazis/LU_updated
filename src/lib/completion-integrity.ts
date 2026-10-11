/**
 * Tracks whether the most recent failed tool batch was followed by evidence of
 * a successful recovery before the model tries to end the run.
 *
 * This deliberately does not interpret task prose or completion claims. It
 * enforces one narrow invariant: a model may not finish immediately after an
 * unresolved execution failure.
 */

export type CompletionIntegrityExecutionStatus =
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cached'

export interface CompletionIntegrityExecutionResult {
  status: CompletionIntegrityExecutionStatus
  toolName?: string
  error?: string
  errorHint?: string
}

export type CompletionIntegrityVerdict =
  | { action: 'allow' }
  | { action: 'recover'; message: string; attempt: number }
  | { action: 'halt'; message: string; attempts: number }

export interface CompletionIntegrityTrackerOptions {
  maxRecoveryAttempts?: number
}

export interface CompletionIntegrityTracker {
  recordExecutionResults: (
    results: readonly CompletionIntegrityExecutionResult[],
  ) => void
  noToolsVerdict: () => CompletionIntegrityVerdict
  hasUnresolvedFailure: () => boolean
  recoveryAttempts: () => number
}

const DEFAULT_MAX_RECOVERY_ATTEMPTS = 2

function failureSummary(
  results: readonly CompletionIntegrityExecutionResult[],
): string {
  const failed = results.find((result) => result.status === 'failed')
  if (!failed) return 'The previous tool operation failed.'
  const tool = failed.toolName ? `Tool ${failed.toolName} failed.` : 'The previous tool operation failed.'
  const detail = failed.errorHint || failed.error
  return detail ? `${tool} ${detail}` : tool
}

export function createCompletionIntegrityTracker(
  options: CompletionIntegrityTrackerOptions = {},
): CompletionIntegrityTracker {
  const maxRecoveryAttempts = Math.max(
    1,
    Math.floor(options.maxRecoveryAttempts ?? DEFAULT_MAX_RECOVERY_ATTEMPTS),
  )
  let unresolvedFailure = false
  let attempts = 0
  let lastFailure = 'The previous tool operation failed.'

  return {
    recordExecutionResults: (results) => {
      if (results.some((result) => result.status === 'failed')) {
        unresolvedFailure = true
        lastFailure = failureSummary(results)
        return
      }

      // A later successful or cached result is execution evidence that the
      // model recovered and continued. Rejections do not prove recovery and do
      // not create a new failure by themselves.
      if (results.some((result) => result.status === 'completed' || result.status === 'cached')) {
        unresolvedFailure = false
        attempts = 0
      }
    },

    noToolsVerdict: () => {
      if (!unresolvedFailure) return { action: 'allow' }

      if (attempts < maxRecoveryAttempts) {
        attempts += 1
        return {
          action: 'recover',
          attempt: attempts,
          message:
            `${lastFailure} No later successful tool operation resolved it. ` +
            'Do not claim completion. Inspect the failure, correct the tool call or choose an appropriate available tool, then validate the actual result before finishing.',
        }
      }

      return {
        action: 'halt',
        attempts,
        message:
          `${lastFailure} Recovery was not demonstrated after ${attempts} corrective attempt${attempts === 1 ? '' : 's'}. ` +
          'Do not report the task as completed. State clearly that the requested change could not be verified.',
      }
    },

    hasUnresolvedFailure: () => unresolvedFailure,
    recoveryAttempts: () => attempts,
  }
}
