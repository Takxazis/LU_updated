import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../useAgentChat.ts', import.meta.url), 'utf8')

describe('Agent semantic-rank telemetry', () => {
  it('captures rank through the optional selector callback', () => {
    expect(source).toContain('selectionOpts.onSemanticRank = (ranked) => { semanticRank = ranked }')
  })

  it('logs rank, gate, budget, and final catalog metadata without prompt content', () => {
    const start = source.indexOf("log.warn('agent.tool_selection_measurement'")
    expect(start).toBeGreaterThan(-1)
    const end = source.indexOf("if (convId) {", start)
    expect(end).toBeGreaterThan(start)
    const block = source.slice(start, end)
    for (const field of [
      'semantic_rank', 'routed_names', 'gated_out',
      'semantic_budget_limit_units', 'semantic_budget_used_units',
      'semantic_budget_kept', 'semantic_budget_dropped',
      'selected_names', 'selected_definition_units', 'available_count',
    ]) expect(block).toContain(field)
    for (const forbidden of ['lastUserMsg', 'description:', 'inputSchema', 'parameters:']) {
      expect(block).not.toContain(forbidden)
    }
  })

  it('measures the native catalog after gate and weighted budget, while bypassing Hermes', () => {
    const gateAt = source.indexOf("const gatedDefs = strategy === 'hermes_xml'")
    const budgetAt = source.indexOf('const budget =', gateAt)
    const finalAt = source.indexOf('const relevantDefs = budget.defs', budgetAt)
    const logAt = source.indexOf("log.warn('agent.tool_selection_measurement'", finalAt)
    expect(gateAt).toBeGreaterThan(-1)
    expect(budgetAt).toBeGreaterThan(gateAt)
    expect(finalAt).toBeGreaterThan(budgetAt)
    expect(logAt).toBeGreaterThan(finalAt)
    expect(source).toContain("? routedDefs\n            : gateCreateTools(routedDefs, lastUserMsg, createGateOpened)")
    expect(source).toContain("const budget = strategy === 'hermes_xml' || settings.smallModelMode")
  })
})
