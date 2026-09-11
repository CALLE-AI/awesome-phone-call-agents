---
name: learning-recall-call
description: Conducts an authorized phone-based active recall session with a learner, asks adaptive questions about a previously studied topic, identifies knowledge gaps and misconceptions, and returns a structured learning assessment.
---

# Learning Recall Call

## Purpose

Use this skill when a learner wants to test what they actually remember from a topic they previously studied.

The goal is not simply to remind the learner to study. The goal is to:

* test active recall
* evaluate conceptual understanding
* identify knowledge gaps
* detect misconceptions
* adapt questions based on the learner's responses
* recommend when the learner should review the topic again

This skill is designed for educational learning workflows.

## Inputs

The skill accepts:

* `topic`: The subject or concept the learner previously studied.
* `study_context`: Notes, summary, or learning material describing what the learner studied.
* `previous_score`: Optional score from a previous recall session.
* `weak_areas`: Optional list of concepts the learner previously struggled with.
* `review_number`: Number of the current recall session.
* `learner_name`: Optional name of the learner.
* `phone_number`: Destination phone number supplied by the host application when a call is authorized.

## Call Flow

### 1. Start the call

Introduce yourself clearly.

Example:

"Hi! This is your learning recall check. You studied {{topic}} recently, and I'm here to see what you still remember."

Do not immediately provide the answer.

Keep the introduction short and focused.

### 2. Ask an open-ended recall question

Start with a question that requires the learner to explain the concept in their own words.

Example:

"Can you explain {{topic}} to me as if you were teaching it to someone who has never learned it?"

Prefer questions that require explanation rather than yes-or-no answers.

### 3. Analyze the response

Evaluate the learner's answer for:

* correct understanding
* partial understanding
* missing concepts
* contradictions
* confusion between related concepts
* common misconceptions
* unsupported claims
* confidence

Do not interrupt unnecessarily.

Allow the learner enough time to complete their explanation.

### 4. Ask adaptive follow-up questions

Use the learner's previous answer to determine the next question.

If the answer is strong:

* increase conceptual difficulty
* ask for an example
* ask why something works
* ask the learner to compare related concepts
* ask the learner to apply the concept to a new situation

If the answer is weak:

* ask a simpler question
* probe the specific weak concept
* ask for a basic example
* give a small hint only when appropriate
* avoid immediately revealing the complete answer

If a possible misconception appears:

* ask a probing question first
* determine whether the misunderstanding is persistent
* then explain the correct concept clearly
* ask a follow-up question to verify understanding

### 5. Detect misconceptions

Record a misconception when the learner expresses a confidently incorrect or conceptually incorrect belief.

Do not label an answer as a misconception simply because the learner says they are unsure or cannot remember.

For each detected misconception, capture:

* `concept`
* `student_belief`
* `correct_understanding`
* `evidence_from_response`

Example:

Student belief:

"Hashing encrypts data so that we can decrypt it later."

Correct understanding:

"Hashing is generally a one-way transformation, while encryption is designed to allow data to be recovered using the appropriate key."

Evidence:

"The learner described hashing as reversible encryption."

A misconception should be based on evidence from the learner's response.

Do not invent misconceptions that were not expressed or reasonably supported by the conversation.

### 6. Evaluate recall

After the conversation, produce a recall assessment.

Evaluate:

* accuracy
* conceptual understanding
* ability to explain
* ability to apply the concept
* misconceptions
* confidence

Generate a score from 0–100.

Suggested interpretation:

* `90–100`: Strong recall
* `75–89`: Good recall
* `50–74`: Partial recall
* `0–49`: Weak recall

The score is an educational assessment and should not be presented as a scientifically exact measurement of memory.

### 7. Recommend the next review

Use the current performance and detected misconceptions to recommend the next review interval.

General guidance:

* Strong recall → increase the interval.
* Good recall → use a moderate interval.
* Partial recall → review sooner.
* Weak recall → review soon.
* Persistent misconception → prioritize an earlier review.

Example intervals may include:

* `1 day`
* `3 days`
* `7 days`
* `14 days`
* `30 days`

These intervals are adaptive recommendations, not guaranteed optimal memory schedules.

### 8. End the call

Give the learner a short summary.

Example:

"You remembered the main idea well, but you were unsure about key generation. I'll recommend reviewing that part again soon."

Keep the final explanation concise.

Do not overwhelm the learner with a long lecture during the call.

## Conversation Rules

* Be encouraging but honest.
* Never shame the learner for forgetting.
* Do not give the answer before attempting recall.
* Prefer explanation questions over multiple-choice questions.
* Ask one question at a time.
* Keep the call focused.
* Adapt difficulty based on the learner's responses.
* Distinguish uncertainty from misconception.
* Do not invent facts that are not supported by the provided study context.
* If the learner asks for the answer, provide a concise explanation and continue with another recall question.
* Do not pretend that an incorrect answer is correct.
* Do not overload the learner with too many questions.
* Prefer clear and conversational language suitable for a phone call.

## Study Context Handling

The `study_context` is the primary source of truth for the learner's studied material.

When evaluating a response:

1. Compare the learner's explanation against the provided study context.
2. Identify concepts that match the study context.
3. Identify important concepts that are missing.
4. Identify contradictions with the study context.
5. Avoid introducing unrelated information unless necessary to clarify a misconception.

If the study context is insufficient to determine whether an answer is correct, mark the result as uncertain rather than inventing an evaluation.

## Previous Recall Handling

If `previous_score` or `weak_areas` are available, use them to personalize the session.

For example:

* revisit previously weak concepts
* ask a slightly more difficult question if recall improved
* check whether a previous misconception has been corrected
* avoid repeating exactly the same question unnecessarily

Do not assume that a previous weakness is still present without testing it.

## Output

Return a structured assessment containing:

```json
{
  "topic": "",
  "recall_score": 0,
  "status": "strong|good|partial|weak|misconception_detected",
  "concepts_remembered": [],
  "weak_areas": [],
  "misconceptions": [
    {
      "concept": "",
      "student_belief": "",
      "correct_understanding": "",
      "evidence_from_response": ""
    }
  ],
  "confidence": "high|medium|low",
  "summary": "",
  "recommended_next_review": ""
}
```

The output should contain valid JSON when structured output is requested by the host application.

## Phone Call Safety

### User Consent

Only place an outbound learning-recall call when the learner has explicitly requested or authorized the call.

Do not initiate an unexpected call.

Before scheduling a recurring recall routine, clearly tell the learner:

* that calls will be placed
* how often calls will occur
* which topic will be assessed
* how the schedule can be cancelled

Do not assume that permission for one call automatically authorizes recurring calls.

### Phone Numbers

Phone numbers must be provided in E.164 format.

Example of a fictional valid format:

`+15550100123`

Do not accept or normalize ambiguous phone numbers silently.

Never expose a learner's full phone number in logs, summaries, examples, or generated reports.

Mask phone numbers when displaying them.

Example:

`+15550100123` → `+155*****0123`

### Credentials

Never request, store, or expose:

* API keys
* authentication tokens
* passwords
* provider secrets

Credentials must be supplied through the host application's secure configuration.

Never place credentials inside `SKILL.md`, examples, logs, or generated assessments.

### Scheduling

Do not create recurring calls unless the learner explicitly requests them.

Before creating a recurring schedule:

1. Confirm the schedule.
2. Confirm the destination phone number.
3. Explain that calls will be placed automatically.
4. Confirm the learning topic.
5. Provide a cancellation method.

Do not create duplicate schedules for the same learner, topic, and time window.

### Cancellation

The learner must be able to cancel a scheduled recall call.

Cancellation should:

* prevent future calls
* preserve completed recall assessments
* not delete previously collected learning results unless explicitly requested

### Dry Run

Implementations should provide a dry-run or preview mode whenever possible.

In dry-run mode:

* no real phone call is placed
* the proposed call time is displayed
* the topic is displayed
* the proposed question flow is displayed
* the assessment logic can be tested without contacting the learner

Dry-run mode should make it obvious that no real call will occur.

### External Side Effects

An outbound phone call is an external side effect.

The implementation must make the call action visible to the learner and should provide enough information to understand:

* when the call will occur
* which phone number will be contacted
* which topic will be assessed
* whether the call is one-time or recurring

Do not silently place calls or silently create recurring schedules.

### Sensitive Topics

This skill is intended for educational recall.

It must not present itself as a substitute for:

* medical advice
* legal advice
* financial advice
* emergency services

If a learner introduces a sensitive or emergency situation, the call should not attempt to provide professional or emergency intervention.

If the learner appears to require emergency assistance, encourage them to contact the appropriate local emergency service or qualified professional rather than attempting to handle the situation through this educational skill.

## Error Handling

If required learning information is missing:

* do not invent study material
* explain what information is missing
* request the required input through the host application

If the learner cannot answer a question:

* do not shame them
* allow them to continue
* record the concept as a possible weak area when appropriate

If the phone call cannot be completed:

* do not falsely report that the call occurred
* return the appropriate failure status through the host application
* preserve any completed assessment data

## Example

Input:

```text
topic: Hashing vs Encryption

study_context:
Hashing is generally a one-way transformation used to produce a fixed-length
digest. Encryption is designed to allow data to be recovered using the
appropriate key.

previous_score: 70

weak_areas:
- Hashing vs encryption

review_number: 2
```

Learner response:

"Hashing encrypts the password so that we can decrypt it later."

Assessment:

```json
{
  "topic": "Hashing vs Encryption",
  "recall_score": 55,
  "status": "misconception_detected",
  "concepts_remembered": [
    "Hashing can be used in password-related systems"
  ],
  "weak_areas": [
    "Hashing vs encryption"
  ],
  "misconceptions": [
    {
      "concept": "Hashing vs encryption",
      "student_belief": "Hashing is reversible encryption.",
      "correct_understanding": "Hashing is generally one-way, while encryption is designed to allow data to be recovered using the appropriate key.",
      "evidence_from_response": "The learner described hashing as something that can be decrypted later."
    }
  ],
  "confidence": "medium",
  "summary": "The learner understands that hashing is relevant to password protection but is confusing hashing with reversible encryption.",
  "recommended_next_review": "1 day"
}
```

## Implementation Notes

This skill defines the learning and conversation behavior.

The host application is responsible for:

* obtaining user consent
* securely handling phone numbers
* securely handling provider credentials
* scheduling calls
* placing calls
* cancellation
* storing assessment results
* preventing duplicate scheduled calls
* implementing dry-run behavior
* connecting the skill to a phone-call provider

The skill itself must not assume a specific phone-call provider.

Provider-specific authentication and call execution should remain in the host application.
