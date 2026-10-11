/**
 * A1/A2/A3 wiring: the two agent loops actually use the builder, in the
 * binding order, and on a COPY.
 *
 * There is no render harness for these hooks in this repo, so the contract is
 * guarded at the source the way host-platform.test.ts guards the prompt. These
 * are the properties that a well-meaning refactor would silently undo, and each
 * one has a price attached: decaying the working array would put shortened
 * results into the store and into the next session; running the budget before
 * the decay would drop whole messages the decay would have made fit; sending
 * `messages` instead of `sendMessages` would keep paying full price while every
 * unit test still passed.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')
const codex = read('useCodex.ts')
const agent = read('useAgentChat.ts')

describe.each([
  ['useCodex', codex, 'messages', 'sendMessages'],
  ['useAgentChat', agent, 'agentMessages', 'sendMessages'],
])('%s builds the request instead of trimming the history', (_name, source, working, send) => {
  it('calls the request builder', () => {
    expect(source).toMatch(/buildRequestMessages\(/)
  })

  it('no longer calls compactMessages behind the back of the builder', () => {
    expect(source).not.toMatch(/compactMessages\(/)
  })

  it('never assigns the built request back onto the working history', () => {
    // This is the line that would push decayed results into the store.
    expect(source).not.toMatch(new RegExp(`${working}\\s*=\\s*buildRequestMessages`))
    expect(source).not.toMatch(new RegExp(`${working}\\s*=\\s*built\\.messages`))
  })

  it('derives the budget from the effective send window', () => {
    expect(source).toMatch(/effectiveSendWindow\(\{/)
    expect(source).toMatch(/sendWindowTokens: settings\.codexSendWindowTokens/)
    expect(source).toMatch(/capEnabled: decayOn/)
  })

  it('honours the contextDecay notaus', () => {
    expect(source).toMatch(/const decayOn = settings\.contextDecay !== false/)
    expect(source).toMatch(/enabled: decayOn/)
    expect(source).toMatch(/hysteresis: decayOn/)
  })

  it('reports the built size for the token counter', () => {
    expect(source).toMatch(/useSendSizeStore\.getState\(\)\.report\(/)
    expect(source).toMatch(/tokens: built\.promptTokens/)
  })

  it('reports the same finalized catalog units the history budget reserved', () => {
    // Native tool definitions ride in a separate wire field. The finalized
    // catalog is sized once before compaction; the same value is subtracted
    // from message history and then reported separately to the meter. This
    // describe runs once for Codex and once for Agent, so one guard covers both.
    expect(source).toContain('nativeToolUnits = toolCatalogUnits(nativeTools)')
    expect(source).toContain('const budgetPolicy = contextBudgetPolicy({')
    expect(source).toContain('nativeToolUnits,')
    expect(source).toContain('const historyAllowance = budgetPolicy.calibratedHistoryAllowance')
    expect(source).toContain('reportTools(convId, toolUnits)')
    expect(source).not.toMatch(/reportTools\(convId, estimateTokens\(JSON\.stringify\(tools\)\)\)/)
  })

  it('leaves a decay row in the tool audit so support can see it', () => {
    expect(source).toMatch(/toolName: 'context_decay'/)
    expect(source).toMatch(/savedChars: built\.savedChars/)
  })

  it('tells the loop guard which reads went out capped', () => {
    expect(source).toMatch(/\{ trimmedReadKeys \}/)
    expect(source).toMatch(/guardKeyOfResult\.set\(/)
    expect(source).toMatch(/keyOf: \(m\) => guardKeyOfResult\.get\(/)
  })

  it('surfaces loop-guard steers and halts as notes in the thread', () => {
    expect(source).toMatch(/Loop guard halted the run/)
    expect(source).toMatch(/Loop guard steered the model/)
  })

  it('sends the built copy, not the working history', () => {
    expect(source).toMatch(new RegExp(`streamProviderTurn\\(provider, modelToUse, ${send}`))
  })
})

describe('useCodex keeps the working history whole for the store', () => {
  it('still persists the hidden tool chain from the untouched array', () => {
    expect(codex).toMatch(/const toolHistoryAll = messages\.slice\(messagesStartLen\)/)
  })

  it('shortens restored tool messages of PREVIOUS turns', () => {
    expect(codex).toMatch(/decayRestoredToolResult\(msg\.content\)/)
    expect(codex).toMatch(/decayRestored && m\.hidden && isToolResult\(msg\)/)
  })

  it('leaves the restore alone when the notaus is off', () => {
    expect(codex).toMatch(/const decayRestored = settings\.contextDecay !== false/)
  })
})

describe('the builder runs before the model call, every step', () => {
  it('useCodex sizes the catalog, builds, then enters the native transport', () => {
    const catalogAt = codex.indexOf('nativeToolUnits = toolCatalogUnits(nativeTools)')
    const buildAt = codex.indexOf('const built = buildRequestMessages(messages, {')
    const transportAt = codex.indexOf("if (providerId === 'ollama')")
    expect(catalogAt).toBeGreaterThan(-1)
    expect(buildAt).toBeGreaterThan(catalogAt)
    expect(transportAt).toBeGreaterThan(buildAt)
  })

  it('useAgentChat sizes the catalog, builds, then enters the native transport', () => {
    const catalogAt = agent.indexOf('nativeToolUnits = toolCatalogUnits(nativeTools)')
    const buildAt = agent.indexOf('const built = buildRequestMessages(agentMessages, {')
    const transportAt = agent.indexOf("if (providerId === 'ollama')")
    expect(catalogAt).toBeGreaterThan(-1)
    expect(buildAt).toBeGreaterThan(catalogAt)
    expect(transportAt).toBeGreaterThan(buildAt)
  })
})

describe('the prompt-transport path does not count its catalog twice', () => {
  it('useCodex zeroes the catalog after embedding it before compaction', () => {
    // The prompt catalog is finalized into messages[0] before policy and
    // compaction. The meter still reports zero separate tool units because
    // those bytes are already part of the message estimate.
    const promptAt = codex.indexOf('content: buildHermesToolPrompt(hermesTools)')
    const policyAt = codex.indexOf('const budgetPolicy = contextBudgetPolicy({')
    const trimAt = codex.indexOf('trimWorkingHistory(messages, historyAllowance')
    const zeroAt = codex.indexOf('reportTools(convId, 0)')
    expect(promptAt).toBeGreaterThan(-1)
    expect(policyAt).toBeGreaterThan(promptAt)
    expect(trimAt).toBeGreaterThan(policyAt)
    expect(zeroAt).toBeGreaterThan(trimAt)
  })

  it('useAgentChat builds its hermes prompt into the system message up front', () => {
    // Same reason, different shape: there it is already in the first system
    // message, so that loop never reports a catalog at all.
    expect(agent).toMatch(/buildHermesToolPrompt\(hermesToolDefs\)/)
  })
})
