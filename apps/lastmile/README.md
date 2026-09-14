# LastMile — Meet Miles

**Ask once. Miles gets it done.**

LastMile is a voice-first Android agent that turns everyday needs into real-world action. A user speaks naturally to Miles, which uses the device's location to discover relevant nearby businesses, maintains conversational context across follow-up requests, and uses CALL-E to make an authorized phone call on the user's behalf.

## What it does

1. The user wakes the assistant with **“Hey Miles.”**
2. Miles accepts a spoken request, such as finding a nearby business that carries a particular item.
3. LastMile uses the user's real device location and Google Places to discover nearby options.
4. Miles presents the results and allows conversational follow-ups such as selecting the first, closest, or another result.
5. A phone call is never initiated by search or selection alone.
6. Only after explicit user authorization, such as **“Call result number one,”** does LastMile submit the selected business and the original task to CALL-E.
7. CALL-E handles the real-world phone-call workflow to ask the business about availability, price, exact match, and other requested details.

## Safety and control

- Explicit authorization is required before every phone call.
- Search and result selection do not authorize a call.
- Users can cancel an active conversational request.
- Business phone numbers are validated before submission.
- Microphone and location permissions are requested explicitly.
- Credentials are not included in this repository contribution.
- Emergency requests are handled separately from ordinary business-search calls.

## CALL-E integration

LastMile uses CALL-E as the phone-call execution provider. The Android application constructs a task from the user's original request, associates it with the explicitly selected business, and submits the authorized call to CALL-E.

This separates the responsibilities clearly:

**Miles:** understand → locate → search → converse → select → obtain authorization

**CALL-E:** place the authorized real-world phone call

## Project

Source code and Android APK are available from the LastMile project repository and its release page:

https://github.com/aishahamidm-droid/LastMile

## Hackathon

Built for **CALL-E: Your Code Is Calling**.
