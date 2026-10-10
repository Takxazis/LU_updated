from pathlib import Path

ROOT = Path(r"D:\LU")
hook_path = ROOT / "src" / "hooks" / "useAgentChat.ts"
module_path = ROOT / "src" / "lib" / "model-request-measurement.ts"
test_path = ROOT / "src" / "lib" / "__tests__" / "model-request-measurement.test.ts"

hook = hook_path.read_text(encoding="utf-8-sig")

if module_path.exists() or test_path.exists():
    raise SystemExit("ERROR: profiler module or test already exists; no files changed")

import_old = "import { getModelMaxTokens, estimateTokens } from '../lib/context-compaction'\n"
import_new = import_old + "import { measureLogicalModelRequest, measureTokenCalibration } from '../lib/model-request-measurement'\n"
measurement_anchor = "          // Aus den beiden Transporten abgeleitet statt abgeschrieben. Die\n"
calibration_old = """          if (turn.promptEvalCount || turn.evalCount) {
            useChatStore.getState().updateMessageUsage(convId!, assistantMessage.id, {
              promptTokens: turn.promptEvalCount || 0,
              completionTokens: turn.evalCount || 0,
              totalTokens: (turn.promptEvalCount || 0) + (turn.evalCount || 0),
              estimated: false,
            })
          }
"""

checks = [
    (import_old, "import anchor"),
    (measurement_anchor, "measurement anchor"),
    (calibration_old, "calibration anchor"),
]
for target, label in checks:
    count = hook.count(target)
    if count != 1:
        raise SystemExit(f"ERROR: {label}: expected 1 match, found {count}; no files changed")

measurement_insert = """          const contextMeasurement = measureLogicalModelRequest({
            provider: providerId,
            model: modelToUse,
            conversationId: convId!,
            step: stepNo,
            messages: sendMessages,
            tools,
            modelContextLimit: agentCtx,
            effectiveSendWindow: sendWindow,
          })
          log.warn('agent.context_measurement', contextMeasurement)

"""
calibration_new = """          if (turn.promptEvalCount || turn.evalCount) {
            useChatStore.getState().updateMessageUsage(convId!, assistantMessage.id, {
              promptTokens: turn.promptEvalCount || 0,
              completionTokens: turn.evalCount || 0,
              totalTokens: (turn.promptEvalCount || 0) + (turn.evalCount || 0),
              estimated: false,
            })
            if (turn.promptEvalCount) {
              log.warn('agent.context_calibration', {
                provider: providerId,
                model: modelToUse,
                conversation_id: convId!,
                step: stepNo,
                ...measureTokenCalibration(
                  contextMeasurement.estimated_total_tokens,
                  turn.promptEvalCount,
                ),
              })
            }
          }
"""

hook = hook.replace(import_old, import_new, 1)
hook = hook.replace(measurement_anchor, measurement_insert + measurement_anchor, 1)
hook = hook.replace(calibration_old, calibration_new, 1)

module = """import type { ChatMessage, ToolDefinition } from '../api/providers/types'
import { estimateTokens } from './context-compaction'

type Role = ChatMessage['role']
type RoleCounts = Record<Role, number>

export interface LogicalModelRequestInput {
  provider: string
  model: string
  conversationId: string
  step: number
  messages: ChatMessage[]
  tools: ToolDefinition[]
  modelContextLimit: number
  effectiveSendWindow: number
}

export interface LogicalModelRequestMeasurement {
  event: 'lu_model_request_measurement'
  provider: string
  model: string
  conversation_id: string
  step: number
  model_context_limit: number
  effective_send_window: number
  message_count: number
  messages_by_role: RoleCounts
  chars_by_role: RoleCounts
  content_chars: number
  tool_result_chars: number
  tool_call_chars: number
  tool_call_id_chars: number
  image_count: number
  image_base64_chars: number
  tool_definition_count: number
  tool_definition_chars: number
  messages_serialized_chars: number
  logical_request_chars: number
  estimated_message_tokens: number
  estimated_tool_tokens: number
  estimated_total_tokens: number
  model_fill_ratio: number
  send_window_fill_ratio: number
}

export interface TokenCalibrationMeasurement {
  estimated_prompt_tokens: number
  actual_prompt_tokens: number
  absolute_error: number
  relative_error: number
  calibration_ratio: number
}

function emptyRoleCounts(): RoleCounts {
  return { system: 0, user: 0, assistant: 0, tool: 0 }
}

function jsonLength(value: unknown): number {
  const encoded = JSON.stringify(value)
  return encoded?.length ?? 0
}

function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0
  return numerator / denominator
}

export function measureLogicalModelRequest(
  input: LogicalModelRequestInput,
): LogicalModelRequestMeasurement {
  const messagesByRole = emptyRoleCounts()
  const charsByRole = emptyRoleCounts()
  let contentChars = 0
  let toolResultChars = 0
  let toolCallChars = 0
  let toolCallIdChars = 0
  let imageCount = 0
  let imageBase64Chars = 0
  let estimatedMessageTokens = 0

  for (const message of input.messages) {
    messagesByRole[message.role] += 1
    charsByRole[message.role] += message.content.length
    contentChars += message.content.length
    if (message.role === 'tool') toolResultChars += message.content.length

    estimatedMessageTokens += estimateTokens(message.content) + 4

    if (message.tool_calls?.length) {
      const encoded = JSON.stringify(message.tool_calls)
      toolCallChars += encoded.length
      estimatedMessageTokens += estimateTokens(encoded)
    }

    if (message.tool_call_id) {
      toolCallIdChars += message.tool_call_id.length
      estimatedMessageTokens += estimateTokens(message.tool_call_id)
    }

    if (message.images?.length) {
      imageCount += message.images.length
      for (const image of message.images) imageBase64Chars += image.data.length
    }
  }

  const encodedTools = JSON.stringify(input.tools)
  const toolDefinitionChars = encodedTools.length
  const estimatedToolTokens = estimateTokens(encodedTools)
  const estimatedTotalTokens = estimatedMessageTokens + estimatedToolTokens

  return {
    event: 'lu_model_request_measurement',
    provider: input.provider,
    model: input.model,
    conversation_id: input.conversationId,
    step: input.step,
    model_context_limit: input.modelContextLimit,
    effective_send_window: input.effectiveSendWindow,
    message_count: input.messages.length,
    messages_by_role: messagesByRole,
    chars_by_role: charsByRole,
    content_chars: contentChars,
    tool_result_chars: toolResultChars,
    tool_call_chars: toolCallChars,
    tool_call_id_chars: toolCallIdChars,
    image_count: imageCount,
    image_base64_chars: imageBase64Chars,
    tool_definition_count: input.tools.length,
    tool_definition_chars: toolDefinitionChars,
    messages_serialized_chars: jsonLength(input.messages),
    logical_request_chars: jsonLength({ messages: input.messages, tools: input.tools }),
    estimated_message_tokens: estimatedMessageTokens,
    estimated_tool_tokens: estimatedToolTokens,
    estimated_total_tokens: estimatedTotalTokens,
    model_fill_ratio: safeRatio(estimatedTotalTokens, input.modelContextLimit),
    send_window_fill_ratio: safeRatio(estimatedTotalTokens, input.effectiveSendWindow),
  }
}

export function measureTokenCalibration(
  estimatedPromptTokens: number,
  actualPromptTokens: number,
): TokenCalibrationMeasurement {
  const absoluteError = actualPromptTokens - estimatedPromptTokens
  return {
    estimated_prompt_tokens: estimatedPromptTokens,
    actual_prompt_tokens: actualPromptTokens,
    absolute_error: absoluteError,
    relative_error: safeRatio(Math.abs(absoluteError), actualPromptTokens),
    calibration_ratio: safeRatio(actualPromptTokens, estimatedPromptTokens),
  }
}
"""

test = """import { describe, expect, it } from 'vitest'
import type { ChatMessage, ToolDefinition } from '../../api/providers/types'
import { measureLogicalModelRequest, measureTokenCalibration } from '../model-request-measurement'

describe('measureLogicalModelRequest', () => {
  it('breaks a logical request down by role, tools, calls, ids, and images', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system rules' },
      { role: 'user', content: 'inspect the scene' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', function: { name: 'use_tool', arguments: { x: 1 } } }] },
      { role: 'tool', content: 'scene result', tool_call_id: 'call-1' },
      { role: 'user', content: 'look at this', images: [{ data: 'AAAA', mimeType: 'image/png' }] },
    ]
    const tools: ToolDefinition[] = [{
      type: 'function',
      function: {
        name: 'use_tool',
        description: 'Use one tool',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    }]

    const result = measureLogicalModelRequest({
      provider: 'ollama',
      model: 'test-model',
      conversationId: 'conv-1',
      step: 2,
      messages,
      tools,
      modelContextLimit: 16_384,
      effectiveSendWindow: 8_192,
    })

    expect(result.messages_by_role).toEqual({ system: 1, user: 2, assistant: 1, tool: 1 })
    expect(result.chars_by_role.tool).toBe('scene result'.length)
    expect(result.tool_result_chars).toBe('scene result'.length)
    expect(result.tool_call_chars).toBe(JSON.stringify(messages[2]?.tool_calls).length)
    expect(result.tool_call_id_chars).toBe('call-1'.length)
    expect(result.image_count).toBe(1)
    expect(result.image_base64_chars).toBe(4)
    expect(result.tool_definition_count).toBe(1)
    expect(result.tool_definition_chars).toBe(JSON.stringify(tools).length)
    expect(result.estimated_total_tokens).toBe(result.estimated_message_tokens + result.estimated_tool_tokens)
    expect(result.model_fill_ratio).toBe(result.estimated_total_tokens / 16_384)
    expect(result.send_window_fill_ratio).toBe(result.estimated_total_tokens / 8_192)
  })

  it('uses zero fill ratios when a window is unavailable', () => {
    const result = measureLogicalModelRequest({
      provider: 'openai', model: 'test', conversationId: 'conv', step: 1,
      messages: [], tools: [], modelContextLimit: 0, effectiveSendWindow: 0,
    })
    expect(result.model_fill_ratio).toBe(0)
    expect(result.send_window_fill_ratio).toBe(0)
  })
})

describe('measureTokenCalibration', () => {
  it('compares the estimate with provider-reported prompt usage', () => {
    expect(measureTokenCalibration(3_000, 3_600)).toEqual({
      estimated_prompt_tokens: 3_000,
      actual_prompt_tokens: 3_600,
      absolute_error: 600,
      relative_error: 600 / 3_600,
      calibration_ratio: 1.2,
    })
  })
})
"""

hook_path.write_text(hook, encoding="utf-8", newline="\n")
module_path.write_text(module, encoding="utf-8", newline="\n")
test_path.write_text(test, encoding="utf-8", newline="\n")

print(f"Updated: {hook_path}")
print(f"Created: {module_path}")
print(f"Created: {test_path}")
print("Universal LU logical request profiler added.")
