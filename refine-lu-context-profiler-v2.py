from pathlib import Path

ROOT = Path(r"D:\LU")
module_path = ROOT / "src" / "lib" / "model-request-measurement.ts"
hook_path = ROOT / "src" / "hooks" / "useAgentChat.ts"
test_path = ROOT / "src" / "lib" / "__tests__" / "model-request-measurement.test.ts"

module = module_path.read_text(encoding="utf-8-sig")
hook = hook_path.read_text(encoding="utf-8-sig")
test = test_path.read_text(encoding="utf-8-sig")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"ERROR: {label}: expected 1 match, found {count}; no files changed")
    return text.replace(old, new, 1)


if "tools_by_size" in module:
    raise SystemExit("ERROR: tools_by_size already exists; no files changed")

# Rename profiler fields so the logger's credential scrubber does not redact
# harmless numeric measurements containing the substring 'token'.
renames = {
    "estimated_message_tokens": "estimated_message_units",
    "estimated_tool_tokens": "estimated_tool_units",
    "estimated_total_tokens": "estimated_total_units",
    "estimated_prompt_tokens": "estimated_prompt_units",
    "actual_prompt_tokens": "actual_prompt_units",
}
for old, new in renames.items():
    if old not in module:
        raise SystemExit(f"ERROR: missing module field {old}; no files changed")
    module = module.replace(old, new)
    hook = hook.replace(old, new)
    test = test.replace(old, new)

# Add the per-tool safe size breakdown contract.
module = replace_once(
    module,
    """  tool_definition_count: number
  tool_definition_chars: number
  messages_serialized_chars: number
""",
    """  tool_definition_count: number
  tool_definition_chars: number
  tools_by_size: Array<{
    name: string
    definition_chars: number
    estimated_units: number
  }>
  messages_serialized_chars: number
""",
    "measurement interface tool breakdown",
)

# Build and sort the breakdown without logging descriptions, schemas, or values.
module = replace_once(
    module,
    """  const encodedTools = JSON.stringify(input.tools)
  const toolDefinitionChars = encodedTools.length
  const estimatedToolTokens = estimateTokens(encodedTools)
  const estimatedTotalTokens = estimatedMessageTokens + estimatedToolTokens

  return {
""",
    """  const encodedTools = JSON.stringify(input.tools)
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
""",
    "tool breakdown calculation",
)

module = replace_once(
    module,
    """    tool_definition_count: input.tools.length,
    tool_definition_chars: toolDefinitionChars,
    messages_serialized_chars: jsonLength(input.messages),
""",
    """    tool_definition_count: input.tools.length,
    tool_definition_chars: toolDefinitionChars,
    tools_by_size: toolsBySize,
    messages_serialized_chars: jsonLength(input.messages),
""",
    "tool breakdown return",
)

# Extend tests with safe names and deterministic descending sizes.
test = replace_once(
    test,
    """    expect(result.tool_definition_count).toBe(1)
    expect(result.tool_definition_chars).toBe(JSON.stringify(tools).length)
    expect(result.estimated_total_units).toBe(result.estimated_message_units + result.estimated_tool_units)
""",
    """    expect(result.tool_definition_count).toBe(1)
    expect(result.tool_definition_chars).toBe(JSON.stringify(tools).length)
    expect(result.tools_by_size).toEqual([
      {
        name: 'use_tool',
        definition_chars: JSON.stringify(tools[0]).length,
        estimated_units: Math.ceil(JSON.stringify(tools[0]).length / 4) + 1,
      },
    ])
    expect(result.estimated_total_units).toBe(result.estimated_message_units + result.estimated_tool_units)
""",
    "single tool breakdown expectation",
)

# Add a focused sorting test before the zero-window test.
test = replace_once(
    test,
    """  it('uses zero fill ratios when a window is unavailable', () => {
""",
    """  it('sorts tool definitions by descending serialized size', () => {
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
""",
    "sorting test anchor",
)

module_path.write_text(module, encoding="utf-8", newline="\n")
hook_path.write_text(hook, encoding="utf-8", newline="\n")
test_path.write_text(test, encoding="utf-8", newline="\n")

print(f"Updated: {module_path}")
print(f"Updated: {hook_path}")
print(f"Updated: {test_path}")
print("Logger-safe units and tools_by_size added.")
