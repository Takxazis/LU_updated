import { describe, expect, it } from 'vitest'
import { gateCreateTools, selectRelevantTools } from '../tool-selection'
import type { MCPToolDefinition, PermissionMap } from '../../api/mcp/types'
import { DEFAULT_PERMISSIONS } from '../../api/mcp/types'

const T = (name: string, category: MCPToolDefinition['category']): MCPToolDefinition => ({
  name,
  description: name,
  inputSchema: { type: 'object', properties: {}, required: [] },
  category,
  source: 'builtin',
})

const ALL: MCPToolDefinition[] = [
  T('web_search', 'web'), T('web_fetch', 'web'),
  T('file_read', 'filesystem'), T('file_write', 'filesystem'),
  T('file_edit', 'filesystem'), T('file_list', 'filesystem'),
  T('file_search', 'filesystem'), T('todo_write', 'system'),
  T('shell_execute', 'terminal'), T('screenshot', 'desktop'), T('pr_resume', 'system'),
]
const PERMS: PermissionMap = { ...DEFAULT_PERMISSIONS }
const names = (message: string) => selectRelevantTools(message, ALL, PERMS).map((t) => t.name)

const GATED = [
  T('file_read', 'filesystem'),
  T('pr_resume', 'system'),
  T('delegate_task', 'system'),
  T('check_tasks', 'system'),
  T('message_agent', 'system'),
]

describe('tool keyword boundaries and natural English web intent', () => {
  it('routes a natural latest-version request to the web deterministically', () => {
    const out = names('Find the latest stable Godot version online and open the official source.')
    expect(out).toContain('web_search')
    expect(out).toContain('web_fetch')
    expect(out).not.toContain('shell_execute')
  })

  it('keeps real test intent while rejecting words that merely contain test', () => {
    expect(names('run the tests for the parser')).toContain('shell_execute')
    expect(names('capture a screenshot of contest results')).not.toContain('shell_execute')
    expect(names('find the latest release online')).not.toContain('shell_execute')
  })

  it('does not turn ordinary online or local-change prose into a web request', () => {
    expect(names('capture a screenshot of the online status indicator')).not.toContain('web_search')
    expect(names('capture a screenshot of the latest local changes')).not.toContain('web_search')
    expect(names('npm init vite@latest')).not.toContain('web_search')
  })

  it('keeps the existing such-as negative control', () => {
    expect(names('write examples such as cats and dogs')).not.toContain('web_search')
  })

  it('does not open the PR gate for this project, but does for this PR', () => {
    expect(gateCreateTools(GATED, 'help me understand this project').map((t) => t.name))
      .not.toContain('pr_resume')
    expect(gateCreateTools(GATED, 'continue this PR from yesterday').map((t) => t.name))
      .toContain('pr_resume')
  })
})


