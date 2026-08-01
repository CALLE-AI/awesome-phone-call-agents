# Examples

All numbers and venues below are fictional. These examples are previews; they do not authorize or place a real call.

## Preview one venue

```text
status: preview only
visit: dinner for four at 6:30 PM
venue: River Room
destination: +1******1234
public business number confirmed: yes

must verify:
1. Is there a step-free route from the public sidewalk to the reserved table?
2. Is the clear width of the entrance used after 7 PM at least 32 inches?

helpful to know:
3. Is quieter seating available away from speakers?

side effect after authorization: at most one outbound CALL-E call
next step: review the disclosure, action limits, data treatment, and exact questions
```

## Conservative result

```text
venue: River Room
destination: +1******1234
provider state: completed

condition 1: confirmed
staff report: The host reported that the side entrance is level with the sidewalk.
source: staff_reported, host
captured: 2026-07-31T18:14:00Z
evidence: respondent excerpt aligned to attempt 0, turn 6
limitation: Staff-reported evidence, not an audit or guarantee.

condition 2: unclear
staff report: The respondent estimated the doorway was about 30 to 34 inches wide but did not measure it.
source: staff_reported, host
captured: 2026-07-31T18:14:00Z
evidence: respondent excerpt aligned to attempt 0, turn 9
limitation: The reported range does not establish the 32-inch threshold.

condition 3: not_asked
staff report: The call ended before this question.
evidence: none
limitation: No answer was collected.
```

Provider completion does not turn the unclear or unasked conditions into confirmation.

## Decline

```text
provider state: completed
venue identity: confirmed
respondent consent: declined
all planned conditions: not_asked
retry: none
```

End the call after the decline. Do not automatically redial.

## Focused follow-up preview

```text
status: preview only
prior condition: entrance clear width at least 32 inches
prior state: unclear
new question: Could someone measure the clear opening of the entrance used after 7 PM at its narrowest point?
side effect after new authorization: at most one outbound CALL-E follow-up call
prior evidence: preserved and unchanged
```
