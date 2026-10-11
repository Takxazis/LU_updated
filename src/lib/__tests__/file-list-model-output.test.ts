import { describe, expect, it } from 'vitest'
import {
  FILE_LIST_MODEL_MAX_CHARS,
  FILE_LIST_MODEL_MAX_ENTRIES,
  formatFileListForModel,
} from '../file-list-model-output'
import type { FsEntry, FsListResult } from '../../types/bridge'

const bytes = (value: number) => `${value} B`
const entry = (i: number, path = `/repo/src/file-${i}.ts`): FsEntry => ({
  name: `file-${i}.ts`,
  path,
  size: 12,
  isDir: false,
  modified: 0,
})

describe('file_list output for the model', () => {
  it('keeps an ordinary short listing byte-identical to the old formatter', () => {
    const data: FsListResult = { entries: [entry(1), entry(2)], count: 2 }
    expect(formatFileListForModel(data, bytes)).toBe(
      ' file-1.ts (12 B) /repo/src/file-1.ts\n file-2.ts (12 B) /repo/src/file-2.ts',
    )
  })

  it('caps broad listings at whole rows and tells the model how to narrow them', () => {
    const data: FsListResult = {
      entries: Array.from({ length: 327 }, (_, i) => entry(i)),
      count: 327,
    }
    const out = formatFileListForModel(data, bytes)
    const rows = out.split('\n').filter((line) => line.startsWith(' file-'))
    expect(rows).toHaveLength(FILE_LIST_MODEL_MAX_ENTRIES)
    expect(out).toContain('showing 100 of 327 entries')
    expect(out).toContain('Narrow path or pattern')
  })

  it('uses an honest lower bound when the backend also hit its cap', () => {
    const data: FsListResult = {
      entries: Array.from({ length: 500 }, (_, i) => entry(i)),
      count: 500,
      truncated: true,
      maxEntries: 500,
    }
    const out = formatFileListForModel(data, bytes)
    expect(out).toContain('showing 100 of at least 500 entries; backend limit reached')
    expect(out).not.toContain('of 500 entries]')
  })

  it('reports repository-noise directories pruned by the backend', () => {
    const data: FsListResult = {
      entries: [entry(1)],
      skippedDirectories: ['node_modules', '.git', '.git'],
    }
    expect(formatFileListForModel(data, bytes)).toContain(
      '[skipped repository-noise directories: .git, node_modules]',
    )
  })

  it('honors the character ceiling without cutting a row in half', () => {
    const longPath = `/repo/${'deep/'.repeat(80)}file.ts`
    const data: FsListResult = {
      entries: Array.from({ length: 100 }, (_, i) => entry(i, `${longPath}-${i}`)),
    }
    const out = formatFileListForModel(data, bytes)
    expect(out.length).toBeLessThanOrEqual(FILE_LIST_MODEL_MAX_CHARS)
    expect(out).toContain('listing shortened for model context')
    for (const line of out.split('\n').filter((value) => value.startsWith(' file-'))) {
      expect(line).toContain('.ts-')
    }
  })
})
