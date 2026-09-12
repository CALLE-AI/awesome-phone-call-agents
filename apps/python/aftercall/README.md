# AfterCare

AfterCare is a post-discharge care coordinator that uses CALL-E to conduct
 consent-aware follow-up calls, collect structured patient-reported recovery information,
 identify risk signals and instantly flags anyone who needs to be escalated.

This directory is a 
guide for [AfterCare app](https://github.com/frasfras/after-call).


- [Public demo](https://aftercare.ai.studio/)
- [Source repository](https://github.com/frasfras/after-call)

**Provider:** CALL-E MCP

## Structured checkin
   The patient is asked about their medical procedure as well as how they feel and flags whether
   they need to be reseen.
   The call response is information for clinicians. 
   Patient can decline call

## Credentials

- The CALL-E token is stored in secrets management in Cloud run and refered to as CALLE_TOKEN

## Side effects, retries, and cancellation
  Starting in live demo mode sends the authorized number, call instructions.
  Planning and scheduling does not initiate call.
  no retries.
  Demo may cost credits and contact a real phone. Only test with personal number or agreeing recipient .
  Patient can decline call.
  
## Default call demonstration

- For The [demo](https://aftercare.ai.studio/#/demo) enter who to call and about what
