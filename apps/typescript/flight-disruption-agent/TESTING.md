# Testing instructions

Everything below runs in dry run by default: no CALL-E account, no API key, no phone calls, fictional data. Section 3 then uses CALL-E for real without placing a call, and live calls are optional at the end.

## 1. Set up

Requirements: Node.js 22 or later, and git.

```bash
git clone https://github.com/mau-kaya/awesome-phone-call-agents.git
cd awesome-phone-call-agents/apps/typescript/flight-disruption-agent
npm install
```

## 2. Automated checks

```bash
npm test        # 82 tests, no network
npm run check   # TypeScript type check
```

Expected: `# pass 82`, `# fail 0`, and no type errors.

## 3. Test with CALL-E, without placing a call

This sends the desk's real call tasks to CALL-E's planner (`plan_call`). CALL-E reads the task, checks the destination, and answers whether the call is ready to run, returning its own plan with success and failure criteria. Planning never dials, and the desk drops the confirmation token CALL-E returns, so the plan cannot be run from here.

```bash
npm install -g @call-e/cli
calle auth login                              # your CALL-E account, in the browser
export CALLE_PLAN_PHONE=+65XXXXXXXX           # your own number in a CALL-E supported region; it is not dialed
npm run calle-plan
```

Expected: "ready to run" for Daniel's delay call and for Nadia's request call, with the first lines of CALL-E's plan, then "No call was placed." Each check takes about 15 seconds.

In the dashboard (section 5), every call box also has **Check with CALL-E (no call)**. It shows CALL-E's verdict, the masked number it planned for, and CALL-E's plan for that exact call. It works in dry run, as long as `CALLE_PLAN_PHONE` is set when you run `npm start`.

Indonesian (+62) numbers are refused before anything is sent, because CALL-E currently rejects them.

## 4. Terminal walkthroughs

```bash
npm run demo            # delay of 4 hours: involuntary pricing
npm run demo 90         # delay of 90 minutes: voluntary pricing
npm run demo cancel     # cancellation: no "keep" option
npm run demo:requests   # passenger requests: passenger -> CALL-E -> airline desk
```

Expected, for `npm run demo`:

| Booking | Result |
| --- | --- |
| K7Q2XA | Kept on the delayed flight |
| M3P8RD | Refund of IDR 1,605,000 recorded |
| T5W1LC | Rebooked to NA 729 with a new booking code |
| B9H4ZN | Review: passenger asked for a human agent |
| R2D6YU | Review: no one answered |

Expected, for `npm run demo:requests`:

| Booking | Result |
| --- | --- |
| L6F2KM | Agreed a move on the CALL-E call, airline desk reissued the ticket |
| C5V8EJ | Agreed a move, airline desk refused, so it needs a person |
| W4N7QS | Accepted a refund, airline desk approved it |
| K7Q2XA | Kept the booking, nothing changed |
| B9H4ZN | Asked for a person |
| H8J3PV | Not eligible (the named flight is on another route) |

## 5. The dashboard

```bash
npm start
```

Open http://127.0.0.1:4310. Start it with `CALLE_PLAN_PHONE` set if you want the **Check with CALL-E** buttons. The header shows **DRY RUN** and a **demo clock** (19 September 2026, the day before the fictional flights). Use **Reset demo** at any time to start over.

### Scenario A: a delayed flight

1. On the departure board, choose **+4h 00m** for **NA 721** and click **Report**.
2. Select **Daniel Wijaya (M3P8RD)**. His ticket went through two distributors. In the price tables, Samudra Travel Wholesale still charges IDR 35,000 on this airline-caused delay, so his "move" costs money while Alya's is free.
3. Click **Simulate call**. A call pop-up opens: it rings, then plays the conversation, then shows **Done automatically: refund of IDR 1,605,000**. Close it. The refund table is marked "Chosen on the call".
4. Select **Sari Pratiwi (T5W1LC)** and simulate the call. She is rebooked to NA 729 with a new booking code, and NA 729 loses a seat on the board.
5. Select **Kevin Tan (B9H4ZN)** and simulate the call. He asks for a person, so the result is **Needs a person** and his booking does not change. Use **Resolve as a person** to close it or apply an offered option.
6. **Maya Lestari (R2D6YU)** does not answer; the call also goes to a person.
7. Try calling the same passenger twice: the desk refuses, because each booking is called at most once per disruption.

### Scenario B: a passenger asks to change a booking

1. In **Passenger requests**, choose booking **L6F2KM (Nadia Kusuma)**, **A change (picks on the call)**, and **Chat**, then click **Check and price**. Every option is priced.
2. Click **Simulate passenger call**. The pop-up shows CALL-E offering the options; Nadia picks NA 729 at 19:45 and agrees to IDR 30,000. Result: **Agreed on the call**.
3. Click **Simulate CALL-E calling the airline desk**. The desk reissues the ticket. Result: **Done**, with the new booking code and ticket.
4. Optional: **Simulate result call** tells Nadia the outcome.
5. Log **C5V8EJ (Dewi Halim)** as a reschedule to NA 729. She agrees on the call, but the airline desk refuses, so the request goes to **Needs a person**.
6. The airline desk button only appears after the passenger has agreed on the call.

### Optional: the signed integrations

With the dashboard running, in a second terminal:

```bash
npm run send-event -- delay NA812-2026-09-20 150      # the airline pushes a delay
npm run send-channel -- submit L6F2KM Kusuma          # the passenger asks through chat
```

The delay appears on the board and in the airline ops feed. The chat request appears in Passenger requests, ready for CALL-E to call. Run `send-channel` on a fresh desk or after **Reset demo**, since one booking can only have one open request.

## 6. Safety checks you can verify

- **Dry run by default:** with no `.env`, the header says DRY RUN and nothing leaves the machine.
- **Local only:** starting with `HOST=0.0.0.0 npm start` is refused unless `OPERATOR_TOKEN` is set.
- **Live consent required:** `CALLE_MODE=cli LIVE_DEMO_PHONE=+6591234567 npm start` is refused until `LIVE_DEMO_PHONE_CONSENT=yes` is also set.
- **Indonesian numbers refused:** a `LIVE_DEMO_PHONE` starting with `+62` is refused before any request, because CALL-E currently rejects them.
- **Phone numbers masked:** phone numbers are masked everywhere, including CALL-E's summaries and transcripts.

## 7. Live calls (optional, places real calls)

Live mode uses CALL-E call credits and rings a real phone. Copy `.env.example` to `.env` and set:

```bash
CALLE_MODE=sdk                   # recommended; needs CALLE_API_KEY from dashboard.heycall-e.com
CALLE_API_KEY=...
LIVE_DEMO_PHONE=+65...           # one number in a CALL-E supported region; every live call goes here
LIVE_DEMO_PHONE_CONSENT=yes      # the owner of that number agreed to test calls
LIVE_CALL_BUDGET=3
```

Restart with `npm start`. The header turns red. Each call needs the last four digits of `LIVE_DEMO_PHONE` typed before it dials. For passenger requests, the same phone receives the passenger call and then the airline desk call, so whoever answers plays both roles.

`CALLE_MODE=cli` also works after `calle auth login`, but the CLI returns no structured result, so every live call goes to **Needs a person** and the airline desk step never unlocks.
