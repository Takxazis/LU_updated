from pathlib import Path

ROOT = Path(r"D:\LU")
module_path = ROOT / "src" / "lib" / "model-request-measurement.ts"
text = module_path.read_text(encoding="utf-8-sig")

replacements = {
    "estimatedMessageTokens": "estimatedMessageUnits",
    "estimatedToolTokens": "estimatedToolUnits",
    "estimatedTotalTokens": "estimatedTotalUnits",
    "estimatedPromptTokens": "estimatedPromptUnits",
    "actualPromptTokens": "actualPromptUnits",
}

found = {old: text.count(old) for old in replacements}
if found["estimatedMessageTokens"] == 0:
    raise SystemExit(
        "ERROR: expected estimatedMessageTokens in the profiler module; no file changed"
    )

for old, new in replacements.items():
    text = text.replace(old, new)

module_path.write_text(text, encoding="utf-8", newline="\n")

print(f"Updated: {module_path}")
print("Replacements:")
for old, count in found.items():
    print(f"  {old}: {count}")
