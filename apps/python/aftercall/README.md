# AfterCare

AfterCare is a post-discharge care coordinator that uses CALL-E to conduct
 consent-aware follow-up calls, collect structured patient-reported recovery information,
 identify risk signals and instantly flags anyone who needs to be escalated.

This directory is a 
guide for [AfterCare app](https://github.com/frasfras/after-call).


- [Public demo](https://aftercare.ai.studio/)
- [Source repository](https://github.com/frasfras/after-call)

## Structured checkin
   The patient is asked about their medical procedure as well as how they feel and whether
   they need to be reseen.
   The call response is information for clinicians. 

## Credentials

- The CALL-E token is stored in secrets management in Cloud run and refered as CALLE_TOKEN

## Default call demonstration

- The [demo](https://aftercare.ai.studio/#/demo) enter who to call and about what
