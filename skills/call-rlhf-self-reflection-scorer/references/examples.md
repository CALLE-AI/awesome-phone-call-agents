# Examples

## Example 1: Explicit High Score

**Input:**
```python
phone_number = "555-0199"
explicit_score = 5
transcript = "User: Great job helping me today."
```

**Output Report:**
```json
{
  "phone_number": "555-0199",
  "source": "explicit_user",
  "score": 5,
  "critique": null,
  "recommendation": "Continue current strategy. High explicit CSAT."
}
```

## Example 2: Self-Critique of Friction

**Input:**
```python
phone_number = "555-0122"
explicit_score = 0  # No score given
transcript = "User: I don't have my account number! Agent: Please provide your account number."
```

**Output Report:**
```json
{
  "phone_number": "555-0122",
  "source": "self_critique",
  "score": 2,
  "critique": "Agent repeatedly pressed for account number when user explicitly stated they didn't have it.",
  "recommendation": "Offer alternative verification methods like Name and DOB if account number is unavailable."
}
```

## Example 3: Edge Case (Empty Transcript)

**Input:**
```python
phone_number = "555-0155"
explicit_score = 0
transcript = "   "
```

**Output Report:**
```json
{
  "phone_number": "555-0155",
  "source": "self_critique",
  "score": 0,
  "critique": "Transcript is empty.",
  "recommendation": "Check audio pipeline or user drop-off."
}
```
