# Salesforce integration

## How QuoteWake selects Quotes

The Salesforce query provides a stable `LastModifiedDate ASC, Id ASC` stream.
Before applying `--max-calls`,
READY Quotes are ordered by the oldest actionable follow-up timestamp: a due
`Retry` uses `Next_Follow_Up_At__c`, while an initial follow-up uses
`LastModifiedDate`. Ties use `LastModifiedDate` and Quote ID. It does not score
or rank candidates by account value, Quote amount, engagement, or any other
priority signal. `--max-calls` takes the first READY candidates in this
follow-up-age order (default: `10`) in both dry-run and execute modes. It is a
throughput limit, not a concurrency lock.

By default, a Quote is READY when it is enabled, has status `Presented`, belongs
to an open Opportunity, is not expired, is below the configured maximum of three
accepted call attempts, and has either a blank follow-up status or a due `Retry`
status. The initial timing policy uses `LastModifiedDate`; a `Retry` uses
`Next_Follow_Up_At__c`. The candidate must also have exactly one primary
`OpportunityContactRole`, a valid phone (MobilePhone is preferred over Phone),
and must not match a configured opt-out field. `Completed`, `Stopped`, invalid,
and otherwise non-actionable states are skipped.

The default `quotewake.toml` sets initial delays to zero for a demonstrable
dataset. Set non-zero values for a real operating cadence. Allowed Quote
statuses can be repeated with `--allowed-quote-status` or configured with the
`QUOTEWAKE_ALLOWED_QUOTE_STATUSES` environment variable.

## Salesforce model

Salesforce standard objects are used wherever possible:

| Object | How QuoteWake uses it |
| --- | --- |
| `Quote` | Reads commercial state and writes follow-up state. Standard fields include `Name`, `Status`, `ExpirationDate`, `LastModifiedDate`, amount/currency, and `OpportunityId`. |
| `Opportunity` | Resolves the related opportunity and checks `IsClosed`. |
| `Account` | Supplies the account name and `BillingCountryCode` for call context. |
| `Contact` | Supplies the callable person, `MobilePhone`/`Phone`, and call locale. |
| `OpportunityContactRole` | Requires exactly one primary contact for the opportunity. |
| `QuoteLineItem` / `Product2` | Supplies concise product, quantity, and line-total context. |
| `Organization` | Supplies `TimeZoneSidKey` and `DefaultLocaleSidKey` for regional formatting. |
| `Task` | Stores each persisted follow-up result, linked to the Quote (`WhatId`) and Contact (`WhoId`), with the commercial outcome in the subject and a multiline description. |

The deployed QuoteWake custom fields are:

On `Quote`:

- `QuoteWake_Enabled__c`: opt a Quote into automation.
- `Follow_Up_Status__c`: `Retry`, `Completed`, or `Stopped` after processing;
  blank means the initial follow-up is pending. `In Progress` is reserved in
  the Salesforce picklist and treated as non-actionable by the current worker.
- `Next_Follow_Up_At__c`: persisted retry time, or the UTC reset-generation
  marker when `Follow_Up_Status__c` is blank; stored by Salesforce as a
  DateTime.
- `Attempt_Count__c`: accepted CALL-E attempts. Failures before CALL-E returns a
  `call_id` do not consume one; every accepted call consumes one. Reliable
  terminal non-connection states use retryable `call_not_established`, while
  wait/parse errors without a reliable terminal state use `unknown`.

On `Contact`:

- `QuoteWake_Call_Locale__c`: call locale stored in Salesforce form (for
  example `en_US`) and normalized to CALL-E's BCP-47 form (`en-US`) at the
  provider boundary.

An opt-out field is optional because Salesforce orgs differ: configure a
Contact checkbox API name with `SALESFORCE_DO_NOT_CALL_FIELD` or
`--do-not-call-field`. If it is not configured, QuoteWake cannot apply that
field-level opt-out filter.

No custom call-history object is required today. The standard Task is the
Salesforce activity record. QuoteWake writes the three follow-up fields above;
it does not overwrite commercial Quote amount, status, expiration, or other
business fields.

Task subjects use `QuoteWake call outcome: <outcome>`; `unknown` adds
`(human review)`. The description keeps the summary and next action on separate
lines and includes the CALL-E call ID. A Task is created whenever QuoteWake
has an accepted call that it can safely persist. Reliable terminal provider
failures create a retryable `call_not_established` Task without a human-review
marker; wait/parse errors without a reliable terminal state create an `unknown`
human-review Task. Create failures without a confirmed `call_id` do not update
Salesforce or create a Task.
