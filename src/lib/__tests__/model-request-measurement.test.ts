import { describe, expect, it } from 'vitest'
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
    expect(result.tools_by_size).toEqual([
      {
        name: 'use_tool',
        definition_chars: JSON.stringify(tools[0]).length,
        estimated_units: Math.ceil(JSON.stringify(tools[0]).length / 4) + 1,
      },
    ])
    expect(result.estimated_total_units).toBe(result.estimated_message_units + result.estimated_tool_units)
    expect(result.model_fill_ratio).toBe(result.estimated_total_units / 16_384)
    expect(result.send_window_fill_ratio).toBe(result.estimated_total_units / 8_192)
  })

  it('sorts tool definitions by descending serialized size', () => {
    const tools: ToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'small_tool',
          description: 'x',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'large_tool',
          description: 'a much longer description for measurement',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: 'A file path' } },
            required: ['path'],
          },
        },
      },
    ]
    const result = measureLogicalModelRequest({
      provider: 'openai', model: 'test', conversationId: 'conv', step: 1,
      messages: [], tools, modelContextLimit: 8_192, effectiveSendWindow: 8_192,
    })
    expect(result.tools_by_size.map((tool) => tool.name)).toEqual(['large_tool', 'small_tool'])
    expect(result.tools_by_size[0]!.definition_chars).toBeGreaterThan(
      result.tools_by_size[1]!.definition_chars,
    )
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
      estimated_prompt_units: 3_000,
      actual_prompt_units: 3_600,
      absolute_error: 600,
      relative_error: 600 / 3_600,
      calibration_ratio: 1.2,
    })
  })
})
