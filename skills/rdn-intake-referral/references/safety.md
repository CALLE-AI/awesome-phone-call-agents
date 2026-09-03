# Safety



## Consent and Authorization



- Never place a phone call without explicit authorization for the specific recipient and purpose.

- The patient must know they are speaking with an AI assistant.

- Do not call a third party unless the calling workflow has appropriate consent or authorization.

- Never guess or fabricate a phone number.

- Validate phone numbers before they reach the CALL-E call execution step.



## Healthcare Boundaries



- This skill is for nutrition intake and care coordination only.

- The AI must not diagnose medical conditions.

- The AI must not prescribe treatment or provide individualized medical or nutrition advice.

- The AI must not interpret laboratory results, medications, or clinical measurements.

- The AI must not represent itself as an RDN, physician, nurse, or other healthcare professional.

- Clinical decisions remain with qualified healthcare professionals.



## Emergency Handling



- If the patient describes a medical emergency or potentially urgent medical situation, stop the routine intake.

- Do not attempt to diagnose or treat the situation.

- Direct the patient toward appropriate emergency or urgent medical services.

- Do not continue collecting routine intake information during an emergency escalation.



## Data Protection



- Collect only information necessary for the intake and referral workflow.

- Never expose API keys, authentication tokens, confirmation tokens, or credentials.

- Mask phone numbers in logs, demonstrations, screenshots, and videos.

- Do not include unnecessary sensitive information in the structured result.

- Never commit secrets to the repository.



## Call Execution



- Use dry-run or preview mode before a live call whenever possible.

- Do not automatically retry an ambiguous, failed, or unknown call result.

- Do not treat voicemail as a completed patient intake.

- Do not assume missing information.

- If the structured result cannot be reliably extracted, return `needs_human` rather than guessing.



## Human Review



- The structured intake is for RDN or authorized human review.

- The AI-generated intake must not be treated as a clinical assessment.

- Appointment, referral, or care decisions remain subject to the appropriate human workflow.

