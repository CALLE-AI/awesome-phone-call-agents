\# Examples



\## Safe Example: Completed Nutrition Intake



A patient agrees to speak with the AI assistant and provides information about their nutrition support needs.



Example outcome:



```json

{

&#x20; "status": "completed",

&#x20; "patient\_name": "Alex",

&#x20; "reason\_for\_support": "Nutrition support for prediabetes",

&#x20; "referral\_status": "Self-requested",

&#x20; "nutrition\_goals": \[

&#x20;   "Improve eating habits"

&#x20; ],

&#x20; "dietary\_preferences\_or\_restrictions": \[

&#x20;   "Vegetarian"

&#x20; ],

&#x20; "location": "Michigan",

&#x20; "insurance\_information": "Provided to the intake workflow",

&#x20; "preferred\_appointment\_times": \[

&#x20;   "Weekday afternoons"

&#x20; ],

&#x20; "rdn\_referral\_needed": true,

&#x20; "patient\_confirmed\_information": true

}



The patient confirms that the information read back by the AI assistant is accurate.



\## Safe Example: Incomplete Intake



A patient starts the intake but does not provide enough information to complete the workflow.



Example outcome:





```json

{

&#x20; "status": "not\_completed",

&#x20; "patient\_name": "",

&#x20; "reason\_for\_support": "",

&#x20; "referral\_status": "",

&#x20; "nutrition\_goals": \[],

&#x20; "dietary\_preferences\_or\_restrictions": \[],

&#x20; "location": "",

&#x20; "insurance\_information": "",

&#x20; "preferred\_appointment\_times": \[],

&#x20; "rdn\_referral\_needed": false,

&#x20; "patient\_confirmed\_information": false

}

```



The AI assistant must not invent missing information.



\## Safe Example: Human Review Required



The call completes, but the structured result cannot be reliably extracted.



Example outcome:





```json

{

&#x20; "status": "needs\_human",

&#x20; "patient\_name": "",

&#x20; "reason\_for\_support": "",

&#x20; "referral\_status": "",

&#x20; "nutrition\_goals": \[],

&#x20; "dietary\_preferences\_or\_restrictions": \[],

&#x20; "location": "",

&#x20; "insurance\_information": "",

&#x20; "preferred\_appointment\_times": \[],

&#x20; "rdn\_referral\_needed": false,

&#x20; "patient\_confirmed\_information": false

}

```



The workflow should stop and route the result for human review rather than guessing.



\## Unsafe Example: Clinical Advice



The AI assistant should not diagnose a medical condition, interpret laboratory results, prescribe treatment, or provide individualized nutrition treatment.



For example, the assistant must not tell a patient what medication to take or prescribe a specific therapeutic diet based on an individual's medical condition.



\## Unsafe Example: Emergency Handling



If a patient describes a medical emergency or potentially urgent medical situation, the AI assistant must stop the routine nutrition intake and direct the patient toward appropriate emergency or urgent medical services.



It must not attempt to diagnose or treat the emergency.



\## Unsafe Example: Unauthorized Call



The workflow must not place a call when the recipient, phone number, calling purpose, or authorization is missing or unclear.



It must return `needs\_human` rather than guessing or proceeding. 

