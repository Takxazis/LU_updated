import type { FsEntry, FsListResult } from '../types/bridge'

/** Maximum number of listing rows exposed to one model tool result. */
export const FILE_LIST_MODEL_MAX_ENTRIES = 100
/** Hard ceiling for the complete model-facing listing, including its notice. */
export const FILE_LIST_MODEL_MAX_CHARS = 12_000

function lineFor(entry: FsEntry, formatBytes: (bytes: number) => string): string {
  return `${entry.isDir ? '[DIR]' : ''} ${entry.name} (${formatBytes(entry.size)}) ${entry.path}`
}

function noticeFor(data: FsListResult, shown: number): string[] {
  const returned = data.entries.length
  const backendTruncated = data.truncated === true
  const frontendTruncated = shown < returned
  const notices: string[] = []

  if (backendTruncated) {
    const floor = Math.max(returned, data.maxEntries ?? returned)
    notices.push(`[listing truncated: showing ${shown} of at least ${floor} entries; backend limit reached]`)
  } else if (frontendTruncated) {
    notices.push(`[listing shortened for model context: showing ${shown} of ${returned} entries]`)
  }

  const skipped = [...new Set(data.skippedDirectories ?? [])].sort()
  if (skipped.length > 0) {
    notices.push(`[skipped repository-noise directories: ${skipped.join(', ')}]`)
  }

  if (backendTruncated || frontendTruncated) {
    notices.push('Narrow path or pattern, or use recursive=false.')
  }
  return notices
}

/**
 * Format fs_list for a model without letting one broad walk consume the turn.
 *
 * The Explorer bypasses this formatter and still receives the complete backend
 * result. Rows are removed whole, never sliced midway through a path.
 */
export function formatFileListForModel(
  data: FsListResult,
  formatBytes: (bytes: number) => string,
): string {
  const rows = data.entries
    .slice(0, FILE_LIST_MODEL_MAX_ENTRIES)
    .map((entry) => lineFor(entry, formatBytes))

  while (true) {
    const notices = noticeFor(data, rows.length)
    const out = [...rows, ...notices].join('\n')
    if (out.length <= FILE_LIST_MODEL_MAX_CHARS || rows.length === 0) return out
    rows.pop()
  }
}
