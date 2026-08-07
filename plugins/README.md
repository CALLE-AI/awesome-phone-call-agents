# Plugins

Use this directory for no-code and low-code workflow-platform plugins that connect business events to phone-call agent workflows.

Plugins may be nodes, actions, connectors, templates, or recipes. They should help workflow builders trigger, configure, monitor, or review phone-call agent workflows without building a full standalone app.

Recommended structure:

```text
plugins/
└── plugin-name/
    ├── README.md
    ├── manifest-or-config-file
    └── examples/
```

Each plugin should document:

- supported triggers, actions, or workflow entry points
- required inputs and expected outputs
- setup and credential handling
- outbound call or recurring-job side effects
- preview, dry-run, or confirmation behavior when possible
- cancellation, rollback, or disable instructions when relevant
- tests, examples, or a manual verification path

## Available plugins

| Plugin | Platform | Purpose |
| --- | --- | --- |
| [`dify-template`](dify-template/) | Dify | Importable CALL-E workflow DSL for one-shot outbound calls with dry-run preview, E.164 validation, resilient polling, and a masked status and summary report. |
| [`n8n-calle-api`](n8n-calle-api/) | n8n | Importable CALL-E API workflow template for one-by-one outbound calls, metadata round trips, call status signals, transcripts, summaries, and structured results. |
| [`@call-e/n8n-nodes-calle`](n8n-nodes-calle/) | n8n | Community node package for creating, waiting on, retrieving, and listing events for CALL-E AI-agent phone-call tasks. |
| [`hubspot-calle`](hubspot-calle/) | HubSpot | Private static app with a direct-call workflow action and two explicitly confirmed CRM record App Cards; it does not write CALL-E state back to HubSpot. |
| [`shopify-flow-cod-confirm`](shopify-flow-cod-confirm/) | Shopify | Cash-on-delivery confirmation gate for Shopify Flow and `orders/create`; polls the call to a terminal state, applies an explicit ship-or-hold decision table, and writes tags and a timeline note back onto the order. |
