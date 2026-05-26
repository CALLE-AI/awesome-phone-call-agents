# Apps

Use this directory for runnable phone-call workflow apps that are broader than a narrow example and are not installable Agent Skills.

Apps should directly help AI agents schedule, monitor, administer, or safely operate phone-call workflows.

Suggested grouping:

```text
apps/
├── python/
│   ├── call-monitor-cli/
│   └── reminder-admin/
└── web/
    ├── call-scheduler-ui/
    └── skill-gallery/
```

Every app should include its own README with setup, usage, side effects, credential handling, dry-run or preview behavior, and cancellation or rollback instructions when it can create calls or recurring jobs.
