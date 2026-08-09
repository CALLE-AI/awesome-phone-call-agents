# QuoteWake

QuoteWake is a Salesforce-first MVP for selecting commercial Quotes for a later phone follow-up. This milestone is strictly read-only: it reads Salesforce, evaluates eligibility, resolves a callable Contact, and reports `READY` or `SKIP` with a machine-readable reason. It does not call CALL-E or modify Salesforce records.

## Workflow

1. Read Salesforce `Quote` records and their related open `Opportunity`.
2. Evaluate QuoteWake enabled/status/due/attempt/expiration/commercial-status rules in Python.
3. Resolve the primary `OpportunityContactRole` only.
4. Validate opt-out and phone availability.
5. Print the selection result and write a local JSONL report.

The retry policy is application configuration for the MVP: `MAX_ATTEMPTS = 3`. No external database or `Max_Attempts__c` field is used.

## Requirements

- Python 3.11 or newer.
- Salesforce CLI (`sf`) in WSL.
- An authenticated Salesforce Developer Org with the QuoteWake fields already deployed.

## Salesforce setup

From this directory, authenticate the Developer Org if needed:

```bash
sf org login web --alias quotewake-dev --set-default
```

Deploy QuoteWake metadata to the authenticated org:

```bash
./scripts/setup-salesforce.sh --target-org quotewake-dev
```

To also create four reusable fictional Spanish electrical-services demo scenarios:

```bash
./scripts/setup-salesforce.sh \
  --target-org quotewake-dev \
  --seed-data
```

The script is safe to run repeatedly. It enables standard Quotes through `QuoteSettings`, deploys six fields on `Quote`, deploys the minimal `QuoteWake_User` permission set, and validates the result. Permission-set assignment is explicit:

```bash
./scripts/setup-salesforce.sh \
  --target-org quotewake-dev \
  --assign-permissions
```

The optional seed command discovers required standard fields and the standard Price Book dynamically. It identifies demo records by stable names and updates them instead of creating duplicates. It also creates fictional `Product2`, `PricebookEntry`, and `QuoteLineItem` records so each demo Quote has visible concepts, quantities, unit prices, and calculated totals. Salesforce uses `Presented` as the standard quote status equivalent to sent; the kitchen and EV demos use that status and are due for QuoteWake follow-up.

## Salesforce dry-run

Run the read-only quote selection layer:

```bash
python3 -m quotewake_salesforce --dry-run --target-org quotewake-dev
```

The command verifies the target org, describes the required objects, runs the
Quote and `OpportunityContactRole` SOQL queries, and evaluates the rules in
Python. It writes one JSON object per line to
`results/quotewake_salesforce_dry_run.jsonl` by default.

The default allowed commercial status is `Presented`, based on the status
picklist discovered in the current Developer Org. Configure a different policy
without changing code, for example:

```bash
python3 -m quotewake_salesforce \
  --dry-run \
  --target-org quotewake-dev \
  --allowed-quote-status Presented \
  --allowed-quote-status Approved
```

`READY` means the Quote is enabled, has a blank, `Pending`, or `Retry`
`Follow_Up_Status__c`, is due now, below `MAX_ATTEMPTS = 3`, unexpired, linked
to an open Opportunity, in an allowed commercial status, and has exactly one
primary Opportunity Contact Role with permission to call and a valid phone
number. A blank follow-up status represents the initial follow-up; the field
can be used later to track completed or scheduled follow-ups. Other results are
`SKIP` with a machine-readable reason such as `NOT_DUE`, `MAX_ATTEMPTS`,
`NO_PRIMARY_CONTACT`, `DO_NOT_CALL`, or `NO_PHONE`.

Contact opt-out filtering is optional because Salesforce orgs may not expose a
standard `Contact.DoNotCall` field. Without `--do-not-call-field`, QuoteWake
does not query an opt-out field, continues normal Contact validation, and emits
a warning that opt-out filtering is disabled. If the org uses a customer-specific
boolean field, pass its API name; QuoteWake verifies that it exists before
querying it:

```bash
python3 -m quotewake_salesforce \
  --dry-run \
  --target-org quotewake-dev \
  --do-not-call-field Do_Not_Call__c
```

Verify the field first with `sf sobject describe --sobject Contact`.

## Verify Quotes

After setup, the full demo query can be run directly with Salesforce CLI:

```bash
sf data query \
  --target-org quotewake-dev \
  --query "SELECT Id, Name, OpportunityId, QuoteWake_Enabled__c, Follow_Up_Status__c, Next_Follow_Up_At__c, Attempt_Count__c, Last_Follow_Up_At__c, Last_Follow_Up_Result__c FROM Quote ORDER BY CreatedDate DESC"
```

The future QuoteWake application query is:

```sql
SELECT Id, Name, OpportunityId, QuoteWake_Enabled__c,
       Follow_Up_Status__c, Next_Follow_Up_At__c,
       Attempt_Count__c, Last_Follow_Up_At__c,
       Last_Follow_Up_Result__c
FROM Quote
WHERE QuoteWake_Enabled__c = true
  AND Follow_Up_Status__c IN ('Pending', 'Scheduled', 'Retry')
  AND Next_Follow_Up_At__c <= TODAY
  AND Attempt_Count__c < 3
ORDER BY Next_Follow_Up_At__c ASC
```

## Tests

The pure selection tests do not require Salesforce or CALL-E:

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

The Salesforce client is intentionally read-only in this milestone. It uses
the authenticated `sf` session and never invokes data create/update/delete
commands.
