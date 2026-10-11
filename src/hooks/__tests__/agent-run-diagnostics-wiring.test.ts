import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (name: string) =>
  readFileSync(resolve(process.cwd(), 'src/hooks', name), 'utf8').replace(/\r\n/g, '\n')

const agent = read('useAgentChat.ts')
const codex = read('useCodex.ts')

describe('shared agent run diagnostics recording wiring', () => {
  it('creates one surface-specific accumulator after run identity is known', () => {
    expect(agent).toContain("import { createAgentRunDiagnostics } from '../lib/agent-run-diagnostics'")
    expect(codex).toContain("import { createAgentRunDiagnostics } from '../lib/agent-run-diagnostics'")
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

  it('records finalized executor results exactly once per surface', () => {
    expect(agent.split('runDiagnostics.recordExecutionResults(results)')).toHaveLength(2)
    expect(codex.split('runDiagnostics.recordExecutionResults(results)')).toHaveLength(2)
  })

  it('does not finalize or publish a summary in the recording-only patch', () => {
    for (const source of [agent, codex]) {
      expect(source).not.toContain('runDiagnostics.finalize(')
      expect(source).not.toContain('run_diagnostics_summary')
    }
  })
})
