import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (name: string) =>
  readFileSync(resolve(process.cwd(), 'src/hooks', name), 'utf8').replace(/\r\n/g, '\n')

const agent = read('useAgentChat.ts')
const codex = read('useCodex.ts')

describe('shared context calibration recorder wiring', () => {
  it('both loops import the shared measurement and recorder', () => {
    for (const source of [agent, codex]) {
      expect(source).toContain("import { measureLogicalModelRequest } from '../lib/model-request-measurement'")
      expect(source).toContain("import { recordContextCalibration } from '../lib/context-calibration-recorder'")
      expect(source).toContain('const contextMeasurement = measureLogicalModelRequest({')
      expect(source).toContain('const recordCalibration = (actualPromptUnits?: number) => {')
      expect(source).toContain('const calibration = recordContextCalibration({')
      expect(source).toContain('runDiagnostics.recordCalibration(calibration)')
      expect(source).toContain('...calibration,')
    }
  })

  it('measures native tools separately and Hermes through its system message', () => {
    for (const source of [agent, codex]) {
      expect(source).toContain("const measurementTools = strategy === 'native' ? nativeTools : []")
      expect(source).toContain('tools: measurementTools,')
      expect(source).toContain("transport: strategy === 'native' ? 'native' : 'hermes_xml'")
    }
  })

  it('Agent records both native and Hermes actual prompt usage', () => {
    expect(agent).toContain('recordCalibration(turn.promptEvalCount)')
    expect(agent).toContain('recordCalibration(hermesTurn.promptEvalCount)')
    expect(agent).not.toContain('measureTokenCalibration(')
  })

  it('Codex records both native provider branches and Hermes', () => {
    expect(codex.split('recordCalibration(turn.promptEvalCount)')).toHaveLength(3)
    expect(codex).toContain('recordCalibration(hermesTurn.promptEvalCount)')
    expect(codex).toContain('reportTurnUsage(convId!, assistantMsg.id, hermesTurn)')
  })

  it('measures after request build and before transport', () => {
    const agentBuild = agent.indexOf('const built = buildRequestMessages(agentMessages, {')
    const agentMeasure = agent.indexOf('const contextMeasurement = measureLogicalModelRequest({')
    const agentTransport = agent.indexOf("if (strategy === 'native') {", agentMeasure)
    expect(agentMeasure).toBeGreaterThan(agentBuild)
    expect(agentTransport).toBeGreaterThan(agentMeasure)

    const codexBuild = codex.indexOf('const built = buildRequestMessages(messages, {')
    const codexMeasure = codex.indexOf('const contextMeasurement = measureLogicalModelRequest({')
    const codexTransport = codex.indexOf("if (strategy === 'native') {", codexMeasure)
    expect(codexMeasure).toBeGreaterThan(codexBuild)
    expect(codexTransport).toBeGreaterThan(codexMeasure)
  })
})
