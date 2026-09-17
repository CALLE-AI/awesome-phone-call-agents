# Examples

## Example 1: Direct User Feedback
**Agent**: "Before we hang up, on a scale of 1 to 5, how helpful was I today?"
**User**: "I'll give you a 2. You talked too fast and I couldn't understand the pricing."
**Reflection Engine**: Logs CSAT: 2. Generates Recommendation: "User complained about speech rate and pricing clarity. In future calls, slow down speech synthesis rate by 15% and break down pricing into smaller, distinct sentences."
*Result*: The memory bank stores this rule for the next call.

## Example 2: Self-Critique (LLM-as-a-Judge)
**User**: "Forget it, this is useless." (Hangs up)
**Reflection Engine**: Analyzes transcript. 
*Critique*: "The agent repeatedly asked for an account number the user did not have, ignoring the user's request to search by name."
*Recommendation*: "If a user cannot provide an account number, immediately offer alternative verification methods (Name/DOB) instead of repeating the request."
*Result*: The agent learns not to loop on account numbers.
