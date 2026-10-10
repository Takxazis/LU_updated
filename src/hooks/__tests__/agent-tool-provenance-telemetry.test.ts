import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../useAgentChat.ts', import.meta.url), 'utf8')

describe('Agent tool provenance telemetry', () => {
  it('captures deterministic provenance from the selector instead of reconstructing routing rules', () => {
    expect(source).toContain('selectionOpts.onDeterministicProvenance = (provenance) => {')
    expect(source).toContain('deterministicProvenance = provenance')
  })

  it('logs deterministic origins and semantic-only candidates', () => {
    const start = source.indexOf("log.warn('agent.tool_selection_measurement'")
    expect(start).toBeGreaterThan(-1)
    const block = source.slice(start, start + 1500)
    for (const field of [
      'semantic_names', 'semantic_only_names', 'selected_semantic_only_names',
    ]) expect(block).toContain(field)
    expect(block).toContain('...deterministicProvenance')
    for (const field of [
      'always_include_names', 'keyword_names', 'external_names', 'verbatim_names',
      'fallback_names', 'safety_names', 'deterministic_names',
    ]) expect(source).toContain(field)
  })

  it('keeps deterministic provenance protected from the semantic-only budget', () => {
    const protectedAt = source.indexOf('const deterministicOriginNames = new Set([')
    const budgetAt = source.indexOf('applySemanticOnlyBudget(', protectedAt)
    expect(protectedAt).toBeGreaterThan(-1)
    expect(budgetAt).toBeGreaterThan(protectedAt)
    for (const field of [
      'always_include_names', 'keyword_names', 'external_names', 'verbatim_names',
      'fallback_names', 'safety_names',
    ]) {
      expect(source.slice(protectedAt, budgetAt)).toContain(`deterministicProvenance.${field}`)
    }
    expect(source).toContain(': gateCreateTools(routedDefs, lastUserMsg, createGateOpened)')
  })
})
