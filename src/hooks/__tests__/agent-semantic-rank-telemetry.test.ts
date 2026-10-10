import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../useAgentChat.ts', import.meta.url), 'utf8')

describe('Agent semantic-rank telemetry', () => {
  it('captures rank through the optional selector callback', () => {
    expect(source).toContain('selectionOpts.onSemanticRank = (ranked) => { semanticRank = ranked }')
  })

  it('logs rank, gate outcome, and final catalog size without prompt content', () => {
    const start = source.indexOf("log.warn('agent.tool_selection_measurement'")
    expect(start).toBeGreaterThan(-1)
    const block = source.slice(start, start + 900)
    for (const field of [
      'semantic_rank', 'routed_names', 'gated_out', 'selected_names',
      'selected_definition_units', 'available_count',
    ]) expect(block).toContain(field)
    for (const forbidden of ['lastUserMsg', 'description:', 'inputSchema', 'parameters:']) {
      expect(block).not.toContain(forbidden)
    }
  })

  it('measures the post-gate native catalog and leaves Hermes behavior untouched', () => {
    const gateAt = source.indexOf("const relevantDefs = strategy === 'hermes_xml'")
    const logAt = source.indexOf("log.warn('agent.tool_selection_measurement'")
    expect(gateAt).toBeGreaterThan(-1)
    expect(logAt).toBeGreaterThan(gateAt)
    expect(source).toContain("? routedDefs\n            : gateCreateTools(routedDefs, lastUserMsg, createGateOpened)")
  })
})
