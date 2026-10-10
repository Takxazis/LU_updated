import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../useAgentChat.ts', import.meta.url), 'utf8')

describe('Agent native tool gate parity', () => {
  it('imports and applies the shared Codex gate after routing', () => {
    expect(source).toContain('gateCreateTools, isGatedTool')
    expect(source).toMatch(
      /const routedDefs = await selectRelevantToolsAsync\([\s\S]*?const relevantDefs = strategy === 'hermes_xml'[\s\S]*?\? routedDefs[\s\S]*?: gateCreateTools\(routedDefs, lastUserMsg, createGateOpened\)/,
    )
  })

  it('keeps gate state run-scoped and outside the iteration loop', () => {
    const stateAt = source.indexOf('let createGateOpened = false')
    const loopAt = source.indexOf('while (!abort.signal.aborted)')
    expect(stateAt).toBeGreaterThan(-1)
    expect(loopAt).toBeGreaterThan(stateAt)
    expect(source.match(/let createGateOpened = false/g)).toHaveLength(1)
  })

  it('opens the gate before executing any real or synthesized gated call', () => {
    const openAt = source.indexOf('if (isGatedTool(name)) createGateOpened = true')
    const dispatchAt = source.indexOf('return raceWithToolTimeout(', openAt)
    expect(openAt).toBeGreaterThan(-1)
    expect(dispatchAt).toBeGreaterThan(openAt)
  })

  it('leaves the pre-loop Hermes catalog path unchanged in phase one', () => {
    expect(source).toMatch(
      /const hermesToolDefs = strategy === 'hermes_xml'[\s\S]*?await selectRelevantToolsAsync\(/,
    )
    expect(source).not.toMatch(
      /const hermesToolDefs = strategy === 'hermes_xml'[\s\S]{0,700}?gateCreateTools\(/,
    )
  })
})
