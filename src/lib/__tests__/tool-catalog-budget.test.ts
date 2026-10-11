import { describe, expect, it } from 'vitest'
import { estimateTokens } from '../context-compaction'
import {
  toolAwareHistoryAllowance,
  toolCatalogUnits,
} from '../tool-catalog-budget'

describe('toolCatalogUnits', () => {
  it('charges an empty catalog exactly zero', () => {
    expect(toolCatalogUnits([])).toBe(0)
  })

  it('uses the existing wire estimator for a non-empty catalog', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'file_read',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
          },
        },
      },
    ]

    expect(toolCatalogUnits(tools)).toBe(
      estimateTokens(JSON.stringify(tools)),
    )
  })

  it('does not hide a serialization failure', () => {
    const circular: unknown[] = []
    circular.push(circular)

    expect(() => toolCatalogUnits(circular)).toThrow()
  })
})

describe('toolAwareHistoryAllowance', () => {
  it('subtracts the native catalog from a known send window', () => {
    expect(toolAwareHistoryAllowance(8192, 1200)).toBe(6992)
  })

  it('keeps a structural floor when the catalog fills the window', () => {
    expect(toolAwareHistoryAllowance(8192, 8192)).toBe(1)
  })

  it('keeps the same floor when the catalog exceeds the window', () => {
    expect(toolAwareHistoryAllowance(8192, 9000)).toBe(1)
  })

  it('preserves zero as the unknown-window sentinel', () => {
    expect(toolAwareHistoryAllowance(0, 9000)).toBe(0)
  })
})
