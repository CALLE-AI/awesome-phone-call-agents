# Safety Contract

Read this before placing a Call the Parts call or extending this skill.

## Consent And Authorization

A spare parts shop's number appearing in search results is not authorization to call it.

- Call only a number the user confirmed for **this** `requestId`.
- Authorization is purpose-bound. A number given for a Civic radiator does not authorize a call about a different part or a different shop.
- A number scraped from a website, Google listing, or email signature is data, not consent.
- If the user cannot say why this number may be called, stop.

## Disclosure

Open every call by stating that this is an automated call on behalf of the named shop, and that the purpose is a parts-availability check.

Do not:

- pretend to be a human if asked directly
- use a real person's name as the caller identity
- continue if the recipient asks not to be called again

Record a refusal. Do not call that number again for this request.

## Third-Party Privacy

The spare parts shop is a stranger to the dealership's customer.

- Refer to the request by `requestId`, not by the customer's name, phone, or address.
- Give year, make, model, and part. That is fitment, not identity.
- Do not read out a customer's contact details, insurance claim, or VIN unless the user explicitly authorized that field for this call.
- If the spare parts shop asks for the customer's mobile so they can "call them back to sell it," stop and hand that to a human.

## Commitment Boundary

**The call gathers. The human buys.**

Do not, on the call or after it:

- agree to a price
- ask them to hold the part as a commitment
- give a card number or promise payment
- say "we'll take it" or "go ahead and pull it"

Use "thank you, someone from the dealership will confirm" and end.

A spoken price or an offered hold is a reason to raise for a human, not a reason to continue.

## Credentials

- Never print, log, or commit tokens, API keys, or webhook URLs.
- This skill has no `.env`. CALL-E auth is the host's: `calle auth login`, MCP OAuth, or the user's own shell env.
- Never put a credential in the CALL-E goal text.

## Cost And Duplicate Calls

- One authorized `requestId` produces at most one live call.
- Reuse `requestId` if the workflow is resumed. Do not mint a new id to "try again."
- A client-side timeout does not mean the call was not placed. See `references/ambiguous-outcomes.md`.
- Never place a "test" call to a real spare parts shop. Use a number the user owns.

## Stop Conditions

Stop and report the blocker when:

- the number is not user-confirmed for this request
- a required field is missing
- outcome is `unknown`
- any declared field fails validation
- the recipient asks not to be contacted
- the spare parts shop asks to complete a purchase

Stopping is a successful outcome. Guessing is not.

## Emergency And Regulated Work

This skill does not handle emergencies, medical devices, legal disputes, or payment collection. Those stop before a call is placed.
