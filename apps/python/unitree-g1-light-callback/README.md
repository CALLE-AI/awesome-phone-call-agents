# Unitree G1 phone-to-light integration

A focused CALL-E contribution: request a callback, collect a confirmed instruction to turn off one demo light, and return a generic command for a separately supplied robot controller.

This directory contains only the phone integration. It contains **no robot motion, perception, navigation, switch-pressing, firmware, or proprietary controller code**. It does not itself move a robot or switch a light.

## No-call preview

Python 3.9+; no third-party packages required.

```sh
python3 calle_light.py preview
```

This prints the proposed CALL-E request and a clearly labelled example command. It requires no API key, makes no network requests, and controls no hardware. This is a dry-run of the integration, not a robot simulator.

## One authorized live callback

Set `CALLE_API_KEY` in your server environment. Never put credentials in frontend code, command-line arguments, recordings, or Git.

Choose a number you own or have permission to call. Confirm the destination, supported region and locale. The following number is a fictional example; replace it for an authorized live test:

```sh
python3 calle_light.py call --phone +12025550123 --region US --locale en-US --live
python3 calle_light.py poll
```

Calling is opt-in. CALL-E may charge credits. `poll` only reads the existing call and never redials. Poll at intervals of at least five seconds until the call reaches a terminal status. No recurring calls are created.

Request state is saved before transmission in `.state/call.json`, with a stable idempotency key. After an uncertain response, preserve that file and repeat the same command. An existing call ID prevents duplicate creation. A new state filename authorizes a separate logical call only when the operator intentionally wants one.

The documented API offers no client cancel-call operation. Ending this program does not cancel an accepted phone call. The recipient can decline or hang up. A rejection, voicemail, missing result, or unclear final confirmation emits no robot command.

## Public/private interface

A supported, confirmed call result produces:

```json
{
  "action": "turn_off_light",
  "target": "demo_light",
  "source_call_id": "call_example",
  "confirmation_quote": "Yes, please.",
  "execution_status": "not_dispatched"
}
```

A private controller may consume this object. It must authenticate the operator, check current hardware readiness, deduplicate by call ID, and perform its own verified switch-pressing routine. This public integration does not supply that controller and never reports physical completion. Hardware integration is a separate deployment step; the included command is advisory and is never dispatched automatically.

The example uses the terminal structured result. The final explicit affirmative is checked against the human transcript; uncertain wording is rejected. CALL-E extraction is advisory, not proof that a physical action is safe. This is not an emergency-control, medical, financial, or legal workflow.

## Supported scope

This callback example identifies itself as Unitree G1's AI phone interface. It collects a decision after the call ends. It does not inject hardware status into an ongoing conversation. Voice selection is left to the provider; the public create-call schema used here has no voice selector.

## Manual verification

1. Run `preview` with the API key unset; verify `places_call` and `controls_robot` are false.
2. Run `python3 -m unittest -v`; the checks use synthetic data and no network.
3. With permission, place one live call and confirm the demo-light instruction.
4. Poll the saved call; verify the output is an instruction, not a success claim about the light.
5. In a separate authorized run, decline; verify `command` is null.

Local state contains phone/transcript data. It is ignored by Git. Do not include it in a public contribution or video. Stop using this integration by stopping the local process; it schedules no background work.

Official API: https://docs.heycall-e.com/api-reference/calls
