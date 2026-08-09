# AGENTS.md

## Project: QuoteWake

QuoteWake is a CALL-E hackathon project that automatically follows up commercial quotes by phone.

The current architecture is **Salesforce-first**:

* Salesforce is the system of record.
* Commercial data must be read from Salesforce objects.
* CALL-E is responsible for executing outbound phone calls.
* Structured call results must be written back to Salesforce.
* QuoteWake should not introduce a separate database unless there is a clear technical requirement.
* Google Sheets and Google Calendar are no longer part of the primary architecture.

## Main Use Case

QuoteWake identifies quotes that require follow-up, calls the associated customer through CALL-E, captures the outcome of the conversation, and updates Salesforce.

Typical flow:

1. Read Salesforce Quotes that are eligible for follow-up.
2. Resolve the related Opportunity, Account and Contact.
3. Build the CALL-E call context.
4. Execute or dry-run the outbound call.
5. Parse the structured CALL-E result.
6. Store the outcome in Salesforce.
7. Update the related commercial workflow when appropriate.

The first implementation should remain simple and demonstrable.

## Salesforce Domain Model

Prefer Salesforce standard objects whenever they fit the use case.

Initial objects:

* `Account`: customer or company.
* `Contact`: person to call.
* `Opportunity`: commercial opportunity.
* `Quote`: proposal being followed up.
* `Task`: completed or planned follow-up activity.
* `Event`: appointment or agreed work date when relevant.

QuoteWake-specific fields may be added to `Quote`, for example:

* `QuoteWake_Enabled__c`
* `Follow_Up_Date__c`
* `Follow_Up_Status__c`
* `Last_Follow_Up_Result__c`

A custom object such as `QuoteWake_Call__c` may be introduced later if call history requires a one-to-many model.

Do not create custom Salesforce objects when a standard object provides an adequate model.

## Architecture Principles

Keep the initial architecture minimal:

```text
Salesforce
    |
    | REST / SOQL
    v
QuoteWake Python
    |
    v
CALL-E
    |
    v
Customer
    |
    v
Structured call result
    |
    v
QuoteWake Python
    |
    | REST
    v
Salesforce
```

For the MVP:

* Prefer Salesforce REST API and SOQL.
* Prefer synchronous, understandable workflows.
* Do not introduce Platform Events, Change Data Capture, Apex or Agentforce unless required by the current feature.
* Design the code so those capabilities can be added later without rewriting the core domain logic.

Potential future evolution:

1. Salesforce Flow for business-trigger automation.
2. Platform Events or Change Data Capture for event-driven integration.
3. Agentforce actions for user-driven or agent-driven quote follow-up.
4. Apex only where Salesforce-native logic provides clear value.

## Development Goals

This project has two goals:

1. Build a strong CALL-E hackathon submission.
2. Use the project to learn practical Salesforce development and integration patterns.

Favor solutions that teach transferable Salesforce concepts while remaining appropriate for a small production-style application.

Relevant concepts include:

* Salesforce object model
* SOQL
* REST API
* OAuth
* External Client Apps
* Salesforce CLI
* custom fields and objects
* Activities
* Flow
* Apex
* Platform Events / CDC
* Agentforce

Do not add a Salesforce technology merely to demonstrate that technology.

## Python Guidelines

Python is the primary implementation language.

Keep Salesforce-specific code isolated from CALL-E-specific code.

Preferred structure:

```text
apps/python/quotewake/
├── quotewake_salesforce/
│   ├── salesforce/
│   │   ├── client.py
│   │   └── quotes.py
│   ├── domain/
│   ├── cli.py
│   └── __main__.py
├── tests/
├── .env.example
└── README.md
```

The exact structure may adapt to repository conventions.

Before creating new abstractions, inspect the existing CALL-E repository and reuse existing implementations, utilities and conventions whenever practical.

Avoid reinventing functionality already available in the repository.

## Salesforce Integration Guidelines

Treat Salesforce as the authoritative source of commercial state.

Do not duplicate Salesforce records into local persistence unless technically necessary.

Keep Salesforce API access behind a small integration layer.

Business logic should not depend directly on raw Salesforce JSON responses.

Prefer typed/domain models between Salesforce and CALL-E.

Example conceptual boundary:

```python
quotes = salesforce.get_quotes_to_follow_up()
result = calle.follow_up(quote)
salesforce.record_follow_up(quote, result)
```

SOQL queries should:

* request only required fields;
* be easy to understand;
* avoid unnecessary API calls;
* respect Salesforce relationships instead of reproducing joins in Python where possible.

Never hard-code Salesforce record IDs.

## CALL-E Integration Guidelines

Follow the patterns already established by the CALL-E repository.

Support dry-run development wherever possible.

Separate:

* call planning;
* call execution;
* result parsing;
* Salesforce persistence.

CALL-E responses should be converted into a stable internal result model before updating Salesforce.

Example outcome fields may include:

* outcome
* interest level
* preferred date
* summary
* next action
* CALL-E call identifier

Do not store raw implementation details in Salesforce unless they provide diagnostic or business value.

## Security and Configuration

Never commit:

* Salesforce passwords
* access tokens
* refresh tokens
* client secrets
* CALL-E credentials
* private keys

Use environment variables and provide placeholders in `.env.example`.

Production-style authentication should use an appropriate OAuth flow.

CLI authentication may be used during development and experimentation.

## Scope Control

Optimize for a working end-to-end demo.

Prefer:

```text
Salesforce → QuoteWake → CALL-E → Salesforce
```

over a larger architecture with incomplete integrations.

When choosing between a sophisticated design and a simpler implementation that proves the use case, prefer the simpler implementation unless the sophisticated design solves an actual requirement.

## Repository Conventions

Always inspect and follow the repository's existing `AGENTS.md`, contribution guidelines and local conventions.

Code, source comments, commit messages and project documentation should be written in English.

Interaction with the project owner may be in Spanish.

Do not modify unrelated applications or shared components unless necessary.

Keep changes scoped to QuoteWake whenever possible.

Before implementing a new solution:

1. Search the repository for an existing equivalent.
2. Reuse existing CALL-E patterns where appropriate.
3. Prefer small, reviewable changes.
4. Add or update tests for meaningful logic.
5. Keep dry-run functionality working during development.

## Current Implementation Priority

Unless explicitly instructed otherwise, work in this order:

1. Salesforce data model.
2. Salesforce CLI connectivity.
3. Read pending Quotes using SOQL.
4. Map Salesforce data into QuoteWake domain models.
5. Integrate CALL-E dry-run.
6. Execute real CALL-E calls when available.
7. Persist call results as Salesforce activities/data.
8. Add Salesforce automation.
9. Explore Agentforce integration.

The immediate objective is an end-to-end Salesforce + CALL-E MVP, not a complete enterprise Salesforce architecture.
