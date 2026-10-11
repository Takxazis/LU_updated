import { describe, expect, it } from 'vitest'
import { createCompletionIntegrityTracker } from '../completion-integrity'

describe('createCompletionIntegrityTracker', () => {
  it('allows a read-only or successful run to finish', () => {
    const tracker = createCompletionIntegrityTracker()
    expect(tracker.noToolsVerdict()).toEqual({ action: 'allow' })

    tracker.recordExecutionResults([{ status: 'completed', toolName: 'file_read' }])
    expect(tracker.noToolsVerdict()).toEqual({ action: 'allow' })
  })

  it('requires recovery after a failed execution batch', () => {
    const tracker = createCompletionIntegrityTracker()
    tracker.recordExecutionResults([{
      status: 'failed',
      toolName: 'use_tool',
      errorHint: 'tool_input is required',
    }])

    const verdict = tracker.noToolsVerdict()
    expect(verdict.action).toBe('recover')
    expect(verdict).toMatchObject({ attempt: 1 })
    if (verdict.action === 'recover') {
      expect(verdict.message).toContain('Tool use_tool failed.')
      expect(verdict.message).toContain('tool_input is required')
      expect(verdict.message).toContain('Do not claim completion')
    }
  })

  it('clears an unresolved failure only after later execution evidence', () => {
    const tracker = createCompletionIntegrityTracker()
    tracker.recordExecutionResults([{ status: 'failed', toolName: 'use_tool' }])
    expect(tracker.hasUnresolvedFailure()).toBe(true)

    tracker.recordExecutionResults([{ status: 'rejected', toolName: 'file_write' }])
    expect(tracker.hasUnresolvedFailure()).toBe(true)

    tracker.recordExecutionResults([{ status: 'completed', toolName: 'script_patch' }])
    expect(tracker.hasUnresolvedFailure()).toBe(false)
    expect(tracker.recoveryAttempts()).toBe(0)
    expect(tracker.noToolsVerdict()).toEqual({ action: 'allow' })
  })

  it('treats cached execution evidence as a successful continuation', () => {
    const tracker = createCompletionIntegrityTracker()
    tracker.recordExecutionResults([{ status: 'failed' }])
    tracker.recordExecutionResults([{ status: 'cached', toolName: 'file_read' }])
    expect(tracker.noToolsVerdict()).toEqual({ action: 'allow' })
  })

  it('halts honestly after the bounded recovery budget is exhausted', () => {
    const tracker = createCompletionIntegrityTracker({ maxRecoveryAttempts: 2 })
    tracker.recordExecutionResults([{ status: 'failed', error: 'Invalid arguments' }])

    expect(tracker.noToolsVerdict()).toMatchObject({ action: 'recover', attempt: 1 })
    expect(tracker.noToolsVerdict()).toMatchObject({ action: 'recover', attempt: 2 })
    const verdict = tracker.noToolsVerdict()
    expect(verdict).toMatchObject({ action: 'halt', attempts: 2 })
    if (verdict.action === 'halt') {
      expect(verdict.message).toContain('could not be verified')
    }
  })

  it('keeps mixed failed batches unresolved', () => {
    const tracker = createCompletionIntegrityTracker()
    tracker.recordExecutionResults([
      { status: 'completed', toolName: 'scene_get_hierarchy' },
      { status: 'failed', toolName: 'use_tool' },
    ])
    expect(tracker.hasUnresolvedFailure()).toBe(true)
    expect(tracker.noToolsVerdict().action).toBe('recover')
  })
})
