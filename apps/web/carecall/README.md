# CareCall

> **Patients leave the hospital. Their risks don't.**

CareCall is a .NET 10 Blazor application that uses CALL-E-powered telephone conversations and a deterministic clinical AI pipeline to support post-discharge follow-up.

It schedules patient follow-up calls, stores call outcomes, analyses clinical evolution, produces structured clinical summaries, highlights potential risk for professional review, and determines when additional follow-up may be required.

**CALL-E provides the real telephone interaction that powers CareCall's end-to-end follow-up workflow.**

## Links

- **Live demo:** `https://carecall20260912022815-b9hvd4hvcwa4brfu.francecentral-01.azurewebsites.net/`
- **Submission video:** `https://youtu.be/RUDHqpsEvu0`
- **DevPost submission:** `https://devpost.com/software/carecall-tbaipw`

## Key capabilities

- Manual patient registration
- Automatic follow-up plan creation
- Guided demo registration with fictional defaults
- Scheduled and on-demand follow-up calls
- Safe simulation mode enabled by default
- Explicitly enabled real CALL-E calls
- Duplicate patient and call prevention
- Symptom extraction and risk classification
- Historical deterioration detection
- Structured SBAR clinical handoff
- Conditional safety review
- Adaptive follow-up scheduling
- Persistent assessments and alerts
- AgentTrace audit records
- Blazor monitoring dashboard

## Requirements

- .NET 10 SDK
- A CALL-E API key, required only when explicitly enabling real calls
- Optional Azure OpenAI or OpenAI credentials for Semantic Kernel
- No AI provider credentials are required for the local deterministic fallback path

Without external AI credentials, CareCall uses its local heuristic fallback where supported.

## Project structure

```plaintext
CareCall/
├── CareCall.Core/
│   ├── Abstractions/
│   ├── Agents/
│   ├── Data/
│   ├── Domain/
│   └── Services/
├── CareCall.Tests/
└── CareCall.Web/
    ├── Components/
    ├── Endpoints/
    ├── Services/
    ├── wwwroot/
    └── Program.cs
```

`CareCall.Core` contains the domain model, application services, AI agents, data access, and external-service abstractions.

`CareCall.Web` contains the Blazor user interface, HTTP endpoints, hosted services, configuration, and application startup.

`CareCall.Tests` contains focused automated validation of safety controls, pipeline behaviour, CALL-E integration boundaries, scheduling, dashboard behaviour, and patient workflows.

## Run locally

Restore and build the solution:

```powershell
dotnet restore
dotnet build
```

Run the web application:

```powershell
dotnet run --project CareCall.Web/CareCall.Web.csproj
```

Open the local URL shown by ASP.NET Core.

CareCall starts in **simulation mode** by default.

## Run the tests

```powershell
dotnet test
```

Latest successful full validation:

```text
Build succeeded.
130 tests passed.
0 tests failed.
```

The test suite validates both application behaviour and safety boundaries, including simulation isolation, protected actions, duplicate prevention, follow-up cancellation, clinical review safeguards, and agent traceability.

The test suite includes focused validation for:

- Simulated calls never contacting the CALL-E provider
- Agent pipeline and AgentTrace behaviour
- Incremental agent trace presentation
- Duplicate phone-number rejection
- Judge-access protection
- Follow-up cancellation
- CALL-E API client behaviour
- Call status polling
- Assessment parsing
- Alert rules
- Monitoring dashboard behaviour
- Patient safety controls
- Devil's Advocate risk guardrails

The Devil's Advocate safety tests verify that the safety reviewer cannot reduce the risk level produced by the clinical assessment.

## Configuration and credentials

Do not commit:

- API keys
- Access tokens
- Passwords
- Private telephone numbers
- Real patient data
- Call recordings
- Real patient transcripts
- Session cookies
- OAuth or bearer tokens
- Azure publication profiles

Use .NET User Secrets for local development or application settings and environment variables in hosted environments.

### CALL-E configuration

```plaintext
CallE:ApiKey
CallE:SimulateCalls
```

`CallE:ApiKey` is required only for real calls.

`CallE:SimulateCalls` defaults to `true`.

### Clinical AI configuration

```plaintext
ClinicalAi:Provider
ClinicalAi:ApiKey
ClinicalAi:Endpoint
ClinicalAi:Model
```

These settings are optional when using the local fallback path.

### Judge access

```plaintext
JudgeAccess:PasswordHash
```

Protected demo operations require a PBKDF2-SHA256 salted password hash.

Judge access remains disabled unless `JudgeAccess:PasswordHash` is configured.

The supported value format is:

```plaintext
iterations:base64-salt:base64-hash
```

The configured value must use:

- A 16-byte salt
- A 32-byte hash
- At least 100,000 iterations

Store the generated value locally with:

```powershell
dotnet user-secrets --project CareCall.Web/CareCall.Web.csproj set "JudgeAccess:PasswordHash" "100000:base64-salt:base64-hash"
```

Never commit the plain-text judge password or the configured password hash to the public repository. Store the hash using .NET User Secrets locally or environment variables in hosted deployments.

## Call modes

### Simulation mode

Simulation mode is enabled by default.

In simulation mode:

- No request is sent to CALL-E.
- No real telephone call is placed.
- Scheduled and manual calls remain available for demonstration.
- The Question Planner prepares personalised follow-up questions.
- CareCall creates a clearly labelled synthetic transcript.
- Clinical AI generates the synthetic scenario when configured.
- A deterministic fallback remains available.
- The complete assessment pipeline is executed.
- Risk, symptoms, summaries, alerts, scheduling results, and AgentTrace entries are persisted.

Simulation mode provides a safe and reproducible evaluation path without CALL-E credentials or external telephone side effects.

### Real-call mode

Real calls require all of the following:

- A configured CALL-E API key
- Explicit activation in the user interface
- An operator confirmation
- A valid and authorised E.164 destination

When enabled, CALL-E can place a real telephone call to the registered destination.

Real-call mode applies consistently to:

- Manual calls
- Scheduled calls
- Guided trials

Call creation uses the stable CareCall session identifier as the CALL-E idempotency key. This prevents repeated submissions of the same call when a request is retried.

The CALL-E result poller only retrieves results for already submitted calls. It never creates or starts calls.

## Patient workflow

1. An operator registers a fictional patient.
2. CareCall creates a follow-up plan.
3. Follow-up calls are scheduled for the relevant recovery dates.
4. The Question Planner prepares personalised questions and potential red flags.
5. CALL-E conducts the telephone conversation, or CareCall executes a synthetic simulation.
6. The transcript enters the clinical AI pipeline.
7. CareCall extracts symptoms and assesses clinical evolution.
8. The system generates a risk classification and clinical summary.
9. A conditional safety reviewer checks potentially uncertain assessments.
10. A structured SBAR handoff is generated.
11. An alert is created when professional review may be required.
12. The Adaptive Scheduler determines the next follow-up action.
13. Results and AgentTrace records appear in the dashboard.

## AI pipeline

CareCall uses a deterministic and auditable pipeline of specialised AI agents.

It is not an autonomous multi-agent chat.

### Question Planner Agent

Prepares personalised follow-up questions using:

- Diagnosis
- Previous follow-up history
- Pending questions
- Current risk
- Potential red flags

### Trend Analyst Agent

Compares the current interaction with previous calls and detects progressive deterioration that may not be visible in a single conversation.

### Clinical Analyst Agent

Produces:

- Extracted symptoms
- Current clinical summary
- Risk classification
- Supporting observations

### Devil's Advocate Agent

Provides a conditional safety review when an assessment is uncertain or potentially dangerous.

The reviewer:

- Searches for underestimated risk
- Requires supporting transcript evidence
- Can elevate the assessed risk
- Can never reduce the assessed risk

### Clinical Handoff Agent

Generates an SBAR summary containing:

- Situation
- Background
- Assessment
- Recommendation

The summary is intended for professional review.

### Adaptive Scheduler Agent

Determines:

- When the next follow-up should occur
- Whether follow-up frequency should change
- Whether monitoring may be closed

## AgentTrace

CareCall persists AgentTrace records so that the execution of the AI pipeline remains visible and reviewable.

Agent activity is displayed in the patient view and may include:

- Agent name
- Execution order
- Status
- Input context
- Output
- Risk evolution
- Supporting evidence
- Error or fallback information

AgentTrace supports technical and clinical review, but it does not replace professional judgement.

## Scheduling

The host-owned `FollowUpScheduler` checks active follow-up plans every 30 seconds.

CALL-E executes telephone calls. CALL-E does not own CareCall's recurring scheduling.

### Standard follow-up

Standard patient registration creates follow-up dates for:

- Day 1 after discharge
- Day 3 after discharge
- Day 7 after discharge

### Guided trial

A guided trial:

- Uses randomised fictional defaults
- Allows a configurable call delay
- Creates one planned follow-up
- Requires judge access
- Follows the selected simulation or real-call mode

### Scheduled activity

Upcoming calls appear in Call Activity as blue **Scheduled** entries.

When a simulated scheduled call becomes due, the existing item transitions into simulation processing instead of disappearing or being replaced by an unrelated record.

## Cancellation and deletion

### Cancel follow-up

Cancelling follow-up:

- Requires judge access
- Deactivates the active follow-up plan
- Prevents future scheduled calls from being submitted
- Preserves the patient
- Preserves completed and historical calls
- Preserves assessments, alerts, and AgentTrace records

A call already accepted by CALL-E cannot be cancelled locally.

Disabling real-call mode prevents future provider submissions, but it does not recall or undo an already accepted provider request.

### Delete patient

Deleting a patient:

- Requires judge access
- Requires a second confirmation
- Permanently removes the patient
- Removes related application records

Deletion is intended only for fictional demonstration data.

## Duplicate prevention

CareCall prevents duplicate activity through:

- Rejection of duplicate patient registrations by telephone number
- Stable CALL-E idempotency keys
- Persistent call-session identifiers
- Separation between call creation and result polling
- Reuse of existing scheduled-call records during processing

The poller cannot accidentally initiate a second call because it is only responsible for retrieving the status and result of an existing CALL-E request.

## Operator-protected actions

The following actions require judge access:

- Creating a guided trial
- Resolving an alert
- Cancelling follow-up
- Deleting a patient

Judge access is a demonstration control for the public hackathon environment. It is not presented as a production healthcare authentication or authorisation system.

## External side effects

### Simulation mode

Simulation mode:

- Never contacts CALL-E
- Never places a real telephone call
- Creates only synthetic application records

### Real-call mode

Real-call mode may:

- Submit an outbound telephone call to CALL-E
- Contact the registered telephone number
- Persist the provider call identifier
- Retrieve and store the call result
- Store the resulting transcript
- Generate assessments and alerts
- Schedule later follow-up activity

Use real-call mode only with an explicitly authorised destination.

## Safety and clinical boundary

CareCall supports professional clinical review.

CareCall does not:

- Diagnose patients
- Prescribe treatment
- Recommend medication dosage
- Recommend medication timing
- Replace professional medical judgement
- Make autonomous treatment decisions
- Act as the sole path for urgent or emergency assistance

Urgent symptoms must be escalated through the appropriate local emergency and clinical-care channels.

All assessments, summaries, risk classifications, and alerts generated by CareCall require review by a qualified healthcare professional.

## Privacy

Do not load real patient data into:

- The public demo
- The public repository
- Test fixtures
- Screenshots
- Videos
- Example transcripts

Do not commit:

- Call recordings
- Private transcripts
- Telephone credentials
- Provider identifiers
- Session cookies
- OAuth tokens
- Bearer tokens
- Production connection strings

Public demonstrations must use fictional or appropriately anonymised data.

All patients, telephone numbers, transcripts, assessments, and alerts included with the repository are fictional demonstration data.

## SQLite files

The repository includes `carecall.db` only with exclusively fictional demonstration data.

Do not commit SQLite runtime files:

```plaintext
carecall.db-shm
carecall.db-wal
```

These files are generated dynamically by SQLite and should be excluded through `.gitignore`.

## Public demo

Replace the links at the top of this README before submitting.

### Video

The submission video includes a demonstrated CALL-E telephone interaction.

### Demo access

The access code for protected judge actions is provided in the private testing instructions of the hackathon submission.

It is not stored in this repository.

## Validation

From the CareCall directory, run:

```powershell
dotnet restore
dotnet build --no-restore
dotnet test --no-build
```

Repository validation must also be run from the root of the Awesome Phone Call Agents repository:

```bash
python3 scripts/validate_repository.py
```

The automated tests cover:

- No-provider-contact behaviour in simulation mode
- AgentTrace generation and presentation
- Duplicate patient rejection
- Judge-access protection
- Follow-up cancellation
- CALL-E client and polling behaviour
- Assessment parsing and alert rules
- Dashboard behaviour
- Patient safety controls
- Devil's Advocate risk monotonicity

## Manual verification flow

A reviewer can validate CareCall without placing a real telephone call:

1. Start CareCall with the default configuration.
2. Confirm that simulation mode is active.
3. Register a fictional patient or create a guided trial.
4. Allow the simulated follow-up to run.
5. Open the patient details.
6. Review the synthetic transcript.
7. Review the symptom assessment.
8. Inspect the risk evolution.
9. Open any generated alert.
10. Review the SBAR summary.
11. Inspect AgentTrace.
12. Cancel the follow-up and confirm that historical records remain available.

## Hackathon

CareCall was created for the **CALL-E: Your Code Is Calling Hackathon**.

The project demonstrates how real telephone conversations can support scalable, AI-assisted post-discharge follow-up while retaining explicit operator control, safe simulation, professional review, and auditable execution.

## Disclaimer

CareCall is a hackathon prototype created for demonstration and evaluation purposes.

It is not a medical device, has not undergone clinical validation, and must not be used for real-world diagnosis, treatment, or autonomous clinical decision-making.

## Final message

> **Patients leave the hospital. Their risks don't.**

CareCall turns a follow-up telephone conversation into an early-warning workflow for patient recovery.

**Powered by CALL-E. Built for real-world impact.**