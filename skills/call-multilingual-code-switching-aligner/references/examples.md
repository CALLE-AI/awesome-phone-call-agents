# Examples

## Example 1: Strict Monolingual Caller

**Input Transcript Turn:**
"I want to check my balance please."

**Output Report:**
```json
{
  "phone_number": "555-0199",
  "cmi": 0.0,
  "prompt_style_injection": "monolingual_english",
  "embedded_words_detected": 0,
  "total_words": 6
}
```

## Example 2: High Code-Switching (Spanglish)

**Input Transcript Turn:**
"Pero I have no money left, entonces I need to cancel."

**Output Report:**
```json
{
  "phone_number": "555-0105",
  "cmi": 0.18,
  "prompt_style_injection": "low_code_switching",
  "embedded_words_detected": 2,
  "total_words": 11
}
```

## Example 3: Edge Cases (Punctuation and Silence)

**Input Transcript Turn:**
"...,, !!!"

**Output Report:**
```json
{
  "phone_number": "555-0130",
  "cmi": 0.0,
  "prompt_style_injection": "monolingual_english",
  "embedded_words_detected": 0,
  "total_words": 0
}
```
