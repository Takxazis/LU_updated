import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (name: string) =>
  readFileSync(resolve(process.cwd(), 'src/hooks', name), 'utf8').replace(/\r\n/g, '\n')

const agent = read('useAgentChat.ts')
const codex = read('useCodex.ts')

describe('shared agent run diagnostics recording wiring', () => {
  it('creates one surface-specific accumulator after run identity is known', () => {
    for (const source of [agent, codex]) {
      expect(source).toContain(
        "import { createAgentRunDiagnostics, type AgentRunCompletionReason, type AgentRunCompletionStatus } from '../lib/agent-run-diagnostics'",
      )
    }
    expect(agent).toContain("surface: 'agent'")
    expect(codex).toContain("surface: 'codex'")
    for (const source of [agent, codex]) {
      expect(source).toContain("transport: strategy === 'native' ? 'native' : 'hermes_xml'")
      expect(source).toContain('conversationId: convId,')
    }
  })

  it('records one iteration at the top of each model loop', () => {
    expect(agent).toContain('stepNo++\n        runDiagnostics.recordIteration()')
    expect(codex).toContain('i++) {\n        runDiagnostics.recordIteration()')
  })

  it('records policy, compaction, request measurement, and calibration on both surfaces', () => {
    for (const source of [agent, codex]) {
      expect(source).toContain('runDiagnostics.recordPolicy(budgetPolicy)')
      expect(source).toContain('runDiagnostics.recordCompaction({')
      expect(source).toContain('trimmedResults: built.trimmedCount')
      expect(source).toContain('prunedPlans: built.prunedPlans')
      expect(source).toContain('droppedImages: built.droppedImages')
      expect(source).toContain('runDiagnostics.recordRequestMeasurement(contextMeasurement)')
      expect(source).toContain('const calibration = recordContextCalibration({')
      expect(source).toContain('runDiagnostics.recordCalibration(calibration)')
    }
  })

  it('records each finalized executor batch once, before per-result projection', () => {
    for (const source of [agent, codex]) {
      expect(source.split('runDiagnostics.recordExecutionResults(results)')).toHaveLength(2)
      const execute = source.indexOf('const results = await executeParallel(requests')
      const record = source.indexOf('runDiagnostics.recordExecutionResults(results)', execute)
      const project = source.indexOf('for (const entry of batch)', record)
      expect(execute).toBeGreaterThan(-1)
      expect(record).toBeGreaterThan(execute)
      expect(project).toBeGreaterThan(record)
    }
  })

  it('publishes one finalized summary per owning run after durability', () => {
    expect(agent).toContain("log.warn('agent.run_diagnostics_summary'")
    expect(codex).toContain("log.warn('codex.run_diagnostics_summary'")
    for (const source of [agent, codex]) {
      expect(source.split('runDiagnostics.finalize(')).toHaveLength(2)
      const durability = source.indexOf('await endTurnDurably(')
      const finalize = source.indexOf('runDiagnostics.finalize(')
      const ownership = source.lastIndexOf('if (stillOwnsSlot) {', finalize)
      expect(durability).toBeGreaterThan(-1)
      expect(finalize).toBeGreaterThan(durability)
      expect(ownership).toBeGreaterThan(durability)
      expect(finalize).toBeGreaterThan(ownership)
    }
  })

  it('classifies budget, loop, cutoff, stop, and failures explicitly', () => {
    for (const source of [agent, codex]) {
      expect(source).toContain("diagnosticsReason = 'budget_exhausted'")
      expect(source).toContain("diagnosticsReason = 'loop_guard_halt'")
      expect(source).toContain("diagnosticsReason = 'model_cutoff'")
      expect(source).toContain("diagnosticsReason = 'user_stop'")
      expect(source).toContain("diagnosticsReason = 'unknown_error'")
      expect(source).toContain("diagnosticsReason = 'tools_unsupported'")
      expect(source).toContain("diagnosticsReason = 'credits_exhausted'")
    }
  })
})
