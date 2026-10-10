import { describe, expect, it } from 'vitest'
import {
  applySemanticOnlyBudget,
  NORMAL_AGENT_SEMANTIC_ONLY_BUDGET_UNITS,
} from '../tool-selection'
import type { MCPToolDefinition } from '../../api/mcp/types'

const T = (name: string): MCPToolDefinition => ({
  name,
  description: name,
  inputSchema: { type: 'object', properties: {}, required: [] },
  category: 'system',
  source: 'builtin',
})
const names = (defs: MCPToolDefinition[]) => defs.map((d) => d.name)

describe('semantic-only weighted tool budget', () => {
  it('never budgets deterministic or pinned tools', () => {
    const defs = [T('file_read'), T('shell_execute'), T('screenshot')]
    const out = applySemanticOnlyBudget(
      defs,
      ['shell_execute', 'screenshot'],
      ['file_read', 'shell_execute'],
      1,
      () => 500,
    )
    expect(names(out.defs)).toEqual(['file_read', 'shell_execute'])
    expect(out.droppedNames).toEqual(['screenshot'])
  })

  it('skips an expensive candidate and still admits a cheaper lower-ranked helper', () => {
    const defs = [T('base'), T('shell_execute'), T('screenshot')]
    const weights: Record<string, number> = { base: 1000, shell_execute: 444, screenshot: 119 }
    const out = applySemanticOnlyBudget(
      defs,
      ['shell_execute', 'screenshot'],
      ['base'],
      NORMAL_AGENT_SEMANTIC_ONLY_BUDGET_UNITS,
      (def) => weights[def.name],
    )
    expect(names(out.defs)).toEqual(['base', 'screenshot'])
    expect(out.keptNames).toEqual(['screenshot'])
    expect(out.droppedNames).toEqual(['shell_execute'])
    expect(out.usedUnits).toBe(119)
  })

  it('treats the semantic web pair atomically', () => {
    const defs = [T('base'), T('web_search'), T('web_fetch'), T('screenshot')]
    const weights: Record<string, number> = { base: 1, web_search: 149, web_fetch: 160, screenshot: 119 }
    const out = applySemanticOnlyBudget(
      defs,
      ['web_search', 'web_fetch', 'screenshot'],
      ['base'],
      NORMAL_AGENT_SEMANTIC_ONLY_BUDGET_UNITS,
      (def) => weights[def.name],
    )
    expect(names(out.defs)).toEqual(['base', 'screenshot'])
    expect(out.droppedNames).toEqual(['web_search', 'web_fetch'])
  })

  it('drops a lone semantic web_search instead of offering snippets without a reader', () => {
    const out = applySemanticOnlyBudget(
      [T('base'), T('web_search')],
      ['web_search'],
      ['base'],
      999,
      () => 1,
    )
    expect(names(out.defs)).toEqual(['base'])
    expect(out.droppedNames).toEqual(['web_search'])
  })

  it('preserves original registry order in the final provider catalog', () => {
    const out = applySemanticOnlyBudget(
      [T('base'), T('cheap_b'), T('cheap_a')],
      ['cheap_a', 'cheap_b'],
      ['base'],
      20,
      () => 10,
    )
    expect(names(out.defs)).toEqual(['base', 'cheap_b', 'cheap_a'])
    expect(out.keptNames).toEqual(['cheap_a', 'cheap_b'])
  })
})
