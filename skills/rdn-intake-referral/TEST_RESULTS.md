# RDN Intake & Referral Agent - Synthetic Validation Results

## TEST STATUS

Status: Synthetic validation
Environment: Documentation fixture
CALL-E Workflow: rdn-intake-referral

## SYNTHETIC WORKFLOW VALIDATION

The RDN Intake & Referral Agent includes synthetic validation scenarios representing an outbound nutrition-intake workflow.

The synthetic scenario models an RDN/care team initiating an intake workflow in which a CALL-E AI phone agent contacts a fictional patient to collect basic information for subsequent human review.

The scenario demonstrates:

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

The synthetic scenario is designed to verify that the agent:

* Does not diagnose medical conditions
* Does not prescribe treatment
* Does not interpret medical information
* Does not provide individualized medical or nutrition advice
* Maintains the intended intake and coordination boundary
* Defers appropriate clinical questions to a qualified human professional

## SYNTHETIC STRUCTURED RESULT

The following is a wholly fictional example of the structured result:

```json
{
  "patient_name": "Jordan Lee",
  "reason_for_support": "General nutrition support",
  "nutrition_goals": [
    "Develop healthier eating habits"
  ],
  "dietary_preferences_or_restrictions": [
    "Vegetarian"
  ],
  "allergies": [],
  "location": "Example City, California",
  "insurance_information": null,
  "preferred_appointment_times": [
    "Next Wednesday afternoon"
  ],
  "rdn_referral_needed": "yes",
  "patient_confirmed_information": "yes"
}
```

All names, locations, responses, and values in this example are fictional and are provided only to demonstrate the expected structure.

## VALIDATION CRITERIA

The synthetic validation scenarios are designed to verify:

* AI identity disclosure
* Consent handling
* Required intake-field collection
* Optional-information handling
* Safety-boundary behavior
* Information readback
* Patient confirmation
* Structured JSON generation
* Human/RDN handoff

No live-call performance metrics or patient-specific results are represented in this document.

## PRIVACY

Public repository documentation must not contain:

* Real phone numbers
* Real patient names
* Raw call transcripts
* Insurance/member numbers
* Call identifiers associated with real interactions
* Other personally identifiable or sensitive information

The examples in this document are wholly synthetic and are not records of real patient interactions or clinical encounters.

## CONCLUSION

The synthetic validation scenarios demonstrate the intended workflow:

RDN/Care Team -> CALL-E AI Phone Agent -> AI Disclosure -> Patient Consent -> Structured Intake -> Patient Confirmation -> RDN-Ready Output -> Human/RDN Follow-up

The prototype is designed to use CALL-E for consent-based AI phone intake that organizes information into a structured format for subsequent human RDN review and follow-up.

The current prototype collects the patient's preferred appointment time but does not confirm or schedule the appointment. A future production implementation could integrate the structured output with an RDN scheduling or care-management system.

These synthetic scenarios are documentation fixtures and should not be interpreted as evidence of a real patient interaction, clinical outcome, or production deployment.
