# CallProof web

This Rails application is the control plane and product interface for
CallProof. It uses AgentKit Rails for orchestration, memory, HITL, audit,
telemetry, and continuous improvement.

Development defaults must not place real phone calls. Live CALL-E execution
will require an explicit environment switch and credentials.

## Setup

```bash
rvm use 3.4.1
bundle install
bin/rails db:prepare
bin/rails test
```

The dependency always resolves to the public revision pinned in the Gemfile so
the lockfile stays portable and contains no workstation paths.
