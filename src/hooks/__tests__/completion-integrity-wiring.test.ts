import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (name: string) =>
  readFileSync(resolve(process.cwd(), 'src/hooks', name), 'utf8').replace(/\r\n/g, '\n')

const agent = read('useAgentChat.ts')
const codex = read('useCodex.ts')

describe('completion integrity wiring', () => {
  it('creates one tracker per Agent and Codex run', () => {
    for (const source of [agent, codex]) {
      expect(source).toContain("import { createCompletionIntegrityTracker } from '../lib/completion-integrity'")
      expect(source.split('const completionIntegrity = createCompletionIntegrityTracker()')).toHaveLength(2)
    }
  })

  it('records each finalized execution batch once', () => {
    for (const source of [agent, codex]) {
      expect(source.split('completionIntegrity.recordExecutionResults(results)')).toHaveLength(2)
      const execute = source.indexOf('const results = await executeParallel(requests')
      const diagnostics = source.indexOf('runDiagnostics.recordExecutionResults(results)', execute)
      const integrity = source.indexOf('completionIntegrity.recordExecutionResults(results)', diagnostics)
      expect(execute).toBeGreaterThan(-1)
      expect(diagnostics).toBeGreaterThan(execute)
      expect(integrity).toBeGreaterThan(diagnostics)
    }
  })

  it('checks unresolved failures before existing no-tools completion logic', () => {
    const agentFinal = agent.indexOf('if (isFinalTurn) {')
    const agentVerdict = agent.indexOf('const integrity = completionIntegrity.noToolsVerdict()', agentFinal)
    const agentPlan = agent.indexOf('// G16: ending the run is only legitimate', agentVerdict)
    expect(agentVerdict).toBeGreaterThan(agentFinal)
    expect(agentPlan).toBeGreaterThan(agentVerdict)

    const codexFinal = codex.indexOf('if (toolCalls.length === 0) {')
    const codexVerdict = codex.indexOf('const integrity = completionIntegrity.noToolsVerdict()', codexFinal)
    const codexStall = codex.indexOf('// Steckengeblieben oder fertig', codexVerdict)
    expect(codexVerdict).toBeGreaterThan(codexFinal)
    expect(codexStall).toBeGreaterThan(codexVerdict)
  })

  it('continues after corrective recovery and halts after the bounded limit', () => {
    for (const source of [agent, codex]) {
      expect(source).toContain("if (integrity.action === 'recover') {")
      expect(source).toContain("if (integrity.action === 'halt') {")
      expect(source).toContain('content: integrity.message')
      expect(source).toContain("diagnosticsStatus = 'halted'")
    }
  })
})
