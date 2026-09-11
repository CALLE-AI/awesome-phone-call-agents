# QuoteWake Agent Instructions

## Scope

These instructions apply to all files under `apps/python/quotewake/`.

QuoteWake is a Python application developed for the CALL-E hackathon. Its goal is to automate outbound follow-up calls for commercial Salesforce Quotes for small businesses.

## Repository Instructions

Always read and follow the root `AGENTS.md` located at the repository root.

The root `AGENTS.md` defines the general development, repository, testing, security, and contribution rules for `awesome-phone-call-agents`.

This file only adds QuoteWake-specific instructions.

If these instructions conflict with the root `AGENTS.md`, follow the root repository instructions unless explicitly told otherwise by the user.

## Language

Interaction with the user may be in Spanish.

However, all project artifacts must be written in English, including:

* Source code
* Variable and function names
* Comments
* Docstrings
* README files
* Technical documentation
* Configuration descriptions
* Commit messages
* Test names and descriptions
* User-facing application text, unless localization is explicitly required

Explain decisions and discuss implementation with the user in Spanish unless requested otherwise.

## Project Goal

The initial QuoteWake workflow is:

1. Read eligible Quotes from Salesforce.
2. Resolve the related Opportunity, Account, and Contact.
3. Trigger an outbound phone call using CALL-E.
4. Provide the voice agent with the relevant quote and customer context.
5. Obtain a structured result from the call.
6. Write the outcome back to Salesforce.

Salesforce Tasks and Events may be added later for activity and callback tracking.

## Development Principles

Keep the application small and aligned with the existing Python apps in this repository.

Prefer simple, explicit implementations over unnecessary abstractions.

Do not introduce additional directory layers, frameworks, infrastructure, or architectural patterns unless the complexity of the application requires them.

Follow existing repository conventions before introducing new ones.

Reuse existing CALL-E examples, utilities, patterns, and dependencies whenever appropriate.

## Reuse Before Implementation

Do not reinvent functionality that already exists.

Before implementing any non-trivial feature, first inspect:

1. Existing code in `awesome-phone-call-agents`.
2. Existing Python apps under `apps/python/`.
3. Existing CALL-E examples, helpers, scripts, and integrations.
4. Dependencies already used by the repository.
5. Well-maintained standard or third-party libraries that solve the problem cleanly.

Prefer reuse, composition, or adaptation over writing custom infrastructure.

In particular, do not create custom implementations for common concerns such as:

* HTTP clients
* OAuth flows
* Salesforce API access
* Configuration loading
* Environment variable handling
* Data validation
* Retry logic
* Logging
* Scheduling
* CLI parsing
* Serialization
* Date and time handling

unless an existing solution is clearly unsuitable.

Before writing new infrastructure or utility code, explicitly check whether an equivalent implementation already exists in the repository.

When a suitable existing solution is found, reuse it unless there is a concrete technical reason not to.

If multiple existing approaches are available, prefer the one already used elsewhere in this repository.

For substantial implementation tasks, briefly state which existing components, examples, or libraries were inspected before introducing new code.

## Architecture

Keep business logic separate from external integrations when practical.

In particular, avoid tightly coupling Quote follow-up logic to:

* CALL-E APIs
* Salesforce REST and SOQL APIs

External integrations should have clear boundaries so they can be tested or replaced independently.

Do not over-engineer this separation while the project remains small.

## Python

Follow the Python version, dependency management, formatting, linting, and testing conventions defined by the repository.

Use:

* Type hints for public functions and important data structures.
* Clear and descriptive names.
* Small functions with explicit responsibilities.
* Structured models when they improve clarity.
* Tests for meaningful business logic and integration boundaries.

Avoid adding dependencies unless they provide clear value.

## Security

Never commit:

* API keys
* OAuth tokens
* CALL-E credentials
* Phone numbers or customer data used for real tests
* Other secrets or personally identifiable production data

Use environment variables or repository-approved mechanisms for configuration and secrets.

Provide safe example values when documentation requires configuration examples.

## Documentation

Keep documentation concise and practical.

The README must remain current as capabilities evolve and must communicate
QuoteWake's business and product value clearly for external hackathon
reviewers. Describe the Salesforce-first workflow, user-visible outcomes, and
current boundaries truthfully. Do not mention private project goals or internal
competitive objectives.

The README should explain at minimum:

* What QuoteWake does.
* How the workflow works.
* Requirements.
* Configuration.
* How to run it.
* How to test it.

Update documentation whenever a change affects installation, configuration, architecture, or usage.

## Testing

Prefer automated tests for deterministic logic.

External APIs should not be called from normal unit tests.

Use mocks, fixtures, or test doubles where appropriate.

Real CALL-E or Salesforce API calls should only be performed when explicitly requested.

## Git

The current development branch is `feat/quotewake`.

Do not commit, push, create branches, open pull requests, or modify repository history unless explicitly requested by the user.

Before considering a task complete, review the resulting diff and run the relevant repository tests or checks whenever possible.

## Working Style

Before implementing a substantial change:

1. Inspect relevant existing code in the repository.
2. Search for reusable implementations before writing new code.
3. Reuse established patterns where appropriate.
4. Prefer the smallest change that satisfies the requirement.
5. Avoid unrelated refactoring.
6. Keep the project runnable throughout development.

When requirements are ambiguous, prefer the simplest implementation compatible with the stated QuoteWake MVP.
