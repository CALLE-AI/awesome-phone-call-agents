# RDN Intake \& Referral Agent - Live Test Results

## TEST STATUS

Status: Successful  
Environment: Demo  
CALL-E Workflow: rdn-intake-referral

## LIVE CALL VALIDATION

The RDN Intake \& Referral Agent successfully completed a live outbound phone conversation using CALL-E.

The call was initiated by the RDN/care team workflow, with the CALL-E AI phone agent contacting the patient to conduct the initial intake.

The test demonstrated:

* AI assistant disclosure
* Consent-based intake
* Patient name collection
* Reason for seeking nutrition support
* Healthcare referral status
* Nutrition goals
* Dietary preferences/restrictions
* Food allergy information
* General service location
* Insurance information handling
* Preferred RDN appointment time
* Final information readback
* Patient confirmation
* Structured JSON result generation

The collected information is intended for subsequent review by the RDN or care team. The AI does not confirm the appointment.

## SAFETY VALIDATION

The agent was instructed not to:

* Diagnose medical conditions
* Prescribe treatment
* Interpret medical information
* Provide individualized medical or nutrition advice

During the live test, the agent maintained the intended intake boundary when the recipient introduced an unrelated nutrition question.

## STRUCTURED RESULT

A successful test produced the following sanitized example:

{
"patient\_name": "Demo Patient",
"reason\_for\_support": "Seeking nutrition support",
"nutrition\_goals": \[
"Eat healthier"
],
"dietary\_preferences\_or\_restrictions": \[],
"location": "Demo State",
"insurance\_information": "not provided",
"preferred\_appointment\_times": \[
"Next Wednesday afternoon"
],
"rdn\_referral\_needed": "no",
"patient\_confirmed\_information": "yes"
}

## RESULT METRICS

* Status: Completed
* Task completed: True
* Completion confidence: 0.95
* Patient confirmed information: Yes
* Failure code: Null

## PRIVACY

The public repository must not contain:

* Real phone numbers
* Real patient names
* Raw call transcripts
* Insurance/member numbers
* Other personally identifiable or sensitive information

The complete live-call output is retained separately as private test evidence.

## CONCLUSION

The live test validated the core workflow:

RDN/Care Team -> CALL-E AI Phone Agent -> Patient Consent -> Structured Intake -> Patient Confirmation -> RDN-Ready Output -> Human/RDN Follow-up

The prototype demonstrates that CALL-E can be used to implement a consent-based AI phone intake workflow that converts a patient conversation into structured, patient-confirmed information for subsequent human RDN review and follow-up.

The current prototype collects the patient's preferred appointment time but does not confirm or schedule the appointment. A future production implementation could integrate the structured output with an RDN scheduling or care-management system.

