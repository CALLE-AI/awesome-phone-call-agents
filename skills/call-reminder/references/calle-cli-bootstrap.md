# CALL-E CLI Bootstrap

Use this reference when `call-reminder` needs a CALL-E CLI route for either setup-time checks or a future scheduled run.

The CLI is one possible CALL-E route. If the current client exposes a safer native CALL-E skill, app, or MCP plan/run flow, prefer that route. When the scheduler payload needs a command, resolve the CLI explicitly and embed the resolved command or resolver instructions in the runtime prompt.

## Resolver Order

Use the first working command.

### 1. Repository-Local

Use this when the scheduled run executes from a repository that contains the CALL-E CLI package:

```bash
env CALLE_SOURCE=<client> CALLE_INTEGRATION=<integration> CALLE_INTEGRATION_VERSION=<version> \
  node packages/cli/bin/calle.js --help
```

If this works, embed the same `env ... node packages/cli/bin/calle.js` command shape in the runtime prompt. Prefer an absolute working directory or scheduler `cwd` when the scheduler supports it.

### 2. Global

Use this when the host already has a stable `calle` binary on `PATH`:

```bash
env CALLE_SOURCE=<client> CALLE_INTEGRATION=<integration> CALLE_INTEGRATION_VERSION=<version> \
  calle --help
```

Do not silently install a global binary. A global install can be recommended only when the user explicitly wants a persistent command and understands where it will be installed.

### 3. Pinned Npx Fallback

Use this when ordinary interactive usage needs a no-install fallback:

```bash
env CALLE_SOURCE=<client> CALLE_INTEGRATION=<integration> CALLE_INTEGRATION_VERSION=<version> \
  npx -y @call-e/cli@<repo-current-version> --help
```

Do not replace `<repo-current-version>` with `latest`. Use the current version from the active CALL-E package, lockfile, installed skill metadata, or repository-local package when one is available. If no current version can be determined, ask for the version or use a non-CLI CALL-E route instead of guessing.

## Scheduled-Run Rules

- Do not require a global install for ordinary interactive usage.
- For persistent scheduled reminders, embed the exact resolved command in the runtime prompt.
- Runtime availability matters more than setup-time availability. The runtime prompt must include the same CLI resolver because a command that works during setup may not work later.
- If the scheduled environment cannot rely on network access, recommend a persistent install or repository-local command instead of `npx`.
- If no CLI route works and no CALL-E MCP or skill route is available, do not create or run the call.
- Do not expose tokens, callback URLs, confirmation tokens, or credentials in command output.

## OpenClaw Metadata Pattern

OpenClaw wrappers can declare that `node` is required and either `calle` or `npx` may satisfy the CLI route:

```yaml
metadata:
  openclaw:
    requires:
      bins: ["node"]
      anyBins: ["calle", "npx"]
    install:
      - id: call-e-cli
        kind: node
        package: "@call-e/cli"
        bins: ["calle"]
        label: Install CALL-E CLI
```

The metadata may describe an install option, but the skill must not silently install dependencies during setup.

## One-Off CALL-E Flow

After a CLI route is available, each scheduled run uses the existing one-off workflow:

```text
auth status -> call plan -> call run -> call status
```

The exact CLI subcommands depend on the installed CALL-E CLI version. Inspect `calle --help` and use only supported commands and flags. If the CLI requires an interactive confirmation that the scheduler cannot provide, skip the call and report the failure instead of bypassing confirmation.
