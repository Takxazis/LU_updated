import type { ChatMessage, ToolDefinition } from '../api/providers/types'
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
  tools_by_size: Array<{
    name: string
    definition_chars: number
    estimated_units: number
  }>
  messages_serialized_chars: number
  logical_request_chars: number
  estimated_message_units: number
  estimated_tool_units: number
  estimated_total_units: number
  model_fill_ratio: number
  send_window_fill_ratio: number
}

export interface TokenCalibrationMeasurement {
  estimated_prompt_units: number
  actual_prompt_units: number
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
  let estimatedMessageUnits = 0

  for (const message of input.messages) {
    messagesByRole[message.role] += 1
    charsByRole[message.role] += message.content.length
    contentChars += message.content.length
    if (message.role === 'tool') toolResultChars += message.content.length

    estimatedMessageUnits += estimateTokens(message.content) + 4

    if (message.tool_calls?.length) {
      const encoded = JSON.stringify(message.tool_calls)
      toolCallChars += encoded.length
      estimatedMessageUnits += estimateTokens(encoded)
    }

    if (message.tool_call_id) {
      toolCallIdChars += message.tool_call_id.length
      estimatedMessageUnits += estimateTokens(message.tool_call_id)
    }

    if (message.images?.length) {
      imageCount += message.images.length
      for (const image of message.images) imageBase64Chars += image.data.length
    }
  }

  const encodedTools = JSON.stringify(input.tools)
  const toolDefinitionChars = encodedTools.length
  const estimatedToolUnits = estimateTokens(encodedTools)
  const estimatedTotalUnits = estimatedMessageUnits + estimatedToolUnits
  const toolsBySize = input.tools
    .map((tool) => {
      const encoded = JSON.stringify(tool)
      return {
        name: tool.function.name,
        definition_chars: encoded.length,
        estimated_units: estimateTokens(encoded),
      }
    })
    .sort((a, b) => b.definition_chars - a.definition_chars || a.name.localeCompare(b.name))

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
    tools_by_size: toolsBySize,
    messages_serialized_chars: jsonLength(input.messages),
    logical_request_chars: jsonLength({ messages: input.messages, tools: input.tools }),
    estimated_message_units: estimatedMessageUnits,
    estimated_tool_units: estimatedToolUnits,
    estimated_total_units: estimatedTotalUnits,
    model_fill_ratio: safeRatio(estimatedTotalUnits, input.modelContextLimit),
    send_window_fill_ratio: safeRatio(estimatedTotalUnits, input.effectiveSendWindow),
  }
}

export function measureTokenCalibration(
  estimatedPromptUnits: number,
  actualPromptUnits: number,
): TokenCalibrationMeasurement {
  const absoluteError = actualPromptUnits - estimatedPromptUnits
  return {
    estimated_prompt_units: estimatedPromptUnits,
    actual_prompt_units: actualPromptUnits,
    absolute_error: absoluteError,
    relative_error: safeRatio(Math.abs(absoluteError), actualPromptUnits),
    calibration_ratio: safeRatio(actualPromptUnits, estimatedPromptUnits),
  }
}
