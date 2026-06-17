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
| [`n8n-calle-api`](n8n-calle-api/) | n8n | Importable CALL-E API workflow template for one-by-one outbound calls, metadata round trips, call status signals, transcripts, summaries, and structured results. |
