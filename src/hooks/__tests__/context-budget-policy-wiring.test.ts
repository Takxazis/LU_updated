import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (name: string) =>
  readFileSync(resolve(process.cwd(), 'src/hooks', name), 'utf8').replace(/\r\n/g, '\n')

const agent = read('useAgentChat.ts')
const codex = read('useCodex.ts')

describe('shared context budget policy wiring', () => {
  it('both agent loops import and call the same policy', () => {
    for (const source of [agent, codex]) {
      expect(source).toContain("import { contextBudgetPolicy } from '../lib/context-budget-policy'")
      expect(source).toContain('const budgetPolicy = contextBudgetPolicy({')
      expect(source).toContain("transport: strategy === 'native' ? 'native' : 'hermes_xml'")
      expect(source).toContain('const historyAllowance = budgetPolicy.calibratedHistoryAllowance')
    }
  })

  it('both compaction stages consume the calibrated allowance', () => {
    expect(agent).toContain('trimWorkingHistory(agentMessages, historyAllowance')
    expect(codex).toContain('trimWorkingHistory(messages, historyAllowance')
    for (const source of [agent, codex]) {
      expect(source).toContain('budgetTokens: historyAllowance')
      expect(source).not.toContain('toolAwareHistoryAllowance(sendWindow, nativeToolUnits)')
    }
  })

  it('Codex finalizes the Hermes system prompt before policy and compaction', () => {
    const finalization = codex.indexOf("if (strategy !== 'native') {")
    const policy = codex.indexOf('const budgetPolicy = contextBudgetPolicy({')
    const trim = codex.indexOf('trimWorkingHistory(messages, historyAllowance')
    const transport = codex.indexOf('// Hermes-XML fallback. The final catalog was embedded')

    expect(finalization).toBeGreaterThan(-1)
    expect(policy).toBeGreaterThan(finalization)
    expect(trim).toBeGreaterThan(policy)
    expect(transport).toBeGreaterThan(trim)
    expect(codex).not.toContain('sendMessages[0] = messages[0]')
  })

  it('keeps native catalog units available to the shared policy', () => {
    for (const source of [agent, codex]) {
      expect(source).toContain('nativeToolUnits = toolCatalogUnits(nativeTools)')
      expect(source).toContain('nativeToolUnits,')
    }
  })
})
