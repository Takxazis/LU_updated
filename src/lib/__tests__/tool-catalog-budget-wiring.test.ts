import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (file: string) => readFileSync(resolve(process.cwd(), 'src/hooks', file), 'utf8')

function expectNativeCatalogBeforeBuild(source: string, historyName: string): void {
  const catalogAt = source.indexOf('nativeToolUnits = toolCatalogUnits(nativeTools)')
  const policyAt = source.indexOf('const budgetPolicy = contextBudgetPolicy({')
  const allowanceAt = source.indexOf('const historyAllowance = budgetPolicy.calibratedHistoryAllowance')
  const trimAt = source.indexOf(`trimWorkingHistory(${historyName}, historyAllowance`)
  const buildAt = source.indexOf('budgetTokens: historyAllowance')
  expect(catalogAt).toBeGreaterThan(-1)
  expect(policyAt).toBeGreaterThan(catalogAt)
  expect(allowanceAt).toBeGreaterThan(policyAt)
  expect(trimAt).toBeGreaterThan(allowanceAt)
  expect(buildAt).toBeGreaterThan(trimAt)
  expect(source.slice(policyAt, allowanceAt)).toContain('nativeToolUnits,')
}

describe('native catalog budgeting wiring', () => {
  const agent = read('useAgentChat.ts')
  const codex = read('useCodex.ts')

  it('finalizes Agent tools before request compaction', () => {
    expectNativeCatalogBeforeBuild(agent, 'agentMessages')
    expect(agent).toContain('reportTools(convId, toolUnits)')
    expect(agent).toContain('selected_definition_units: nativeToolUnits')
  })

  it('finalizes Codex tools before request compaction', () => {
    expectNativeCatalogBeforeBuild(codex, 'messages')
    expect(codex).toContain('reportTools(convId, toolUnits)')
  })

  it('keeps the full send window as telemetry', () => {
    for (const source of [agent, codex]) {
      expect(source).toContain('window: sendWindow')
      expect(source).not.toContain('window: historyAllowance')
    }
  })

  it('does not double-charge the Codex Hermes catalog', () => {
    expect(codex).toContain('useSendSizeStore.getState().reportTools(convId, 0)')
  })
})

describe('Agent thinking placeholder ownership', () => {
  const agent = read('useAgentChat.ts')

  it('has one shared idempotent cleanup with a finally', () => {
    expect(agent.split('let thinkingBlockRemoved = false')).toHaveLength(2)
    expect(agent.split('const dropThinkingBlock = () => {')).toHaveLength(2)
    expect(agent).toContain('finally {\n            dropThinkingBlock()')
  })

  it('creates the placeholder after measurement and before transport', () => {
    const measurementAt = agent.indexOf("log.warn('agent.context_measurement'")
    const indicatorAt = agent.indexOf("content: 'Analyzing...'")
    const transportAt = agent.indexOf("if (providerId === 'ollama')")
    expect(indicatorAt).toBeGreaterThan(measurementAt)
    expect(transportAt).toBeGreaterThan(indicatorAt)
  })
})
