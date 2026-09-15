# CALL-E Odoo 19 Integration (`call_e`)

An Odoo 19 module to stage draft outbound AI phone calls using the CALL-E SDK inside Odoo Server Actions and Automation Rules. When a rule or action executes, a To-Do activity (`mail.activity`) is created to notify the user to review and manually trigger the phone call.

Example Use Cases (Works with any Odoo model & workflow):
- **Reminding Overdue Invoices**: Stage reminder call requests for past-due balances, speaking exact invoice amounts and capturing payment promises.
- **Notifying Delivery Status**: Stage call notifications when a package is out for delivery to confirm drop-off availability.
- **Confirming Service Appointments**: Stage call requests 24 hours in advance to confirm technician visits or consultations.
- **Screening Job Applicants**: Stage initial screening calls with candidates to check start dates, location, and salary expectations.
- **Collecting Customer Feedback**: Stage CSAT feedback call requests post-purchase or post-support ticket resolution to gather satisfaction ratings and log responses in Odoo.
- **Qualifying CRM Leads**: Stage screening calls for new web leads to ask screening questions and move qualified leads to the next pipeline stage.
- **Confirming Sales Orders**: Stage call requests to confirm high-value or cash-on-delivery orders before shipping.

---

## 1. Directory & Module Layout

```text
plugins/odoo-calle/
├── README.md
├── call_e/                # Main Odoo 19 Addon Module package
│   ├── __init__.py
│   ├── __manifest__.py
│   ├── hooks.py           # Pre-init hook for calle-ai library check
│   ├── data/              # Module data XMLs (partner_call_example, crm_lead, sale_order)

│   ├── models/            # Odoo models (calle.call, ir.actions.server, res.config.settings)
│   ├── security/          # Odoo ACL access rules (ir.model.access.csv)
│   ├── static/            # Frontend JS/SCSS/XML widgets (calle_prompt_preview)
│   ├── tests/             # Odoo TransactionCase unit tests (test_calle_call.py)
│   └── views/             # Form views, backend menus, settings
└── examples/              # Workflow XML templates & documentation
    ├── README.md
    ├── partner_call_example.xml
    ├── crm_lead_qualification.xml
    └── sales_order_confirmation.xml


```

---

## 2. Supported Host and Provider

- **Supported Platform / Host**: Odoo 19 (Community & Enterprise Editions)
- **Voice AI Provider**: CALL-E AI Voice Platform (`https://www.heycall-e.com/`)
- **Required Python SDK**: `calle-ai` (`pip install calle-ai`)

---

## 3. Supported Triggers, Actions & Entry Points

| Entry Point / Component | Supported Trigger / Target | Description |
| --- | --- | --- |
| **Server Action** (`ir.actions.server`) | `state = 'calle_call'` | Adds a native action type "Trigger CALL-E Phone Call" selectable on any Odoo model. |
| **Automation Rules** (`base.automation`) | `on_create`, `on_write`, `on_time` | Executes the CALL-E server action when model records are created, updated, or on cron schedules. |
| **Compatible Models** | All Odoo Models (`res.partner`, `sale.order`, `account.move`, `crm.lead`, `hr.applicant`, custom models) | Works with any model containing a phone field or relational path to a partner/contact. |

---

## 4. Required Inputs and Expected Outputs

### Configuration Inputs

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `calle_phone_field_chain` | `Char` | Yes | Field name or dot-separated field chain (e.g. `phone`, `partner_id.phone`) evaluated dynamically on the record. |
| `calle_section_ids` | `One2many` | Yes | Tree of dialogue prompt sections (`calle.section`) with expected answer choices (`calle.section.response`). |
| `calle_ai.api_key` | `Char` | Yes | CALL-E API key configured in Odoo Settings under **Settings -> General Settings -> CALL-E Configuration**. |
| `locale` | `Char` | No | Language locale code (e.g., `en-US`, `es-ES`). Defaults to `en-US`. |

### Generated Outputs (`calle.call`)

| Output Field | Type | Description |
| --- | --- | --- |
| `phone_number` | `Char` | E.164 normalized phone number (`+15555550100`). |
| `status` | `Selection` | Call execution state (`draft`, `pending`, `completed`, `failed`, `skipped`). |
| `task_description` | `Text` | Rendered dialogue prompt text, including post-call response Python code execution notices if configured. |
| `result_text` | `Text` | Raw result text returned by the CALL-E engine. |
| `structured_result` | `Text` | Extracted JSON key-value key decisions from the call conversation. |
| `evidence` | `Text` | Verifiable caller responses and evidence points captured during the call. |
| `display_result` | `Text` | Computed formatted result summary displayed on the Odoo call log form. |
| `display_structured_result` | `Text` | Pretty-printed formatted JSON structured key-value outcome. |
| `display_evidence` | `Text` | Bulleted formatted evidence text displayed on the Odoo call log form. |
| Post-Call Action Code | Python Script | Custom Python code (`action_code`) defined on matching responses dispatched automatically upon call completion. |

---

## 5. Credential Handling & Security

- **System Parameter Storage**: API Keys are stored in Odoo System Parameters (`ir.config_parameter`), restricted to system administrators.
- **Odoo Access Control**: Access to call logs and configuration is strictly limited by Odoo Security Groups (`ir.model.access.csv`).
- **No Hardcoded Secrets**: Secrets are never stored in source code or export files.

---

## 6. Side Effects & Safety Rules

When a **Trigger CALL-E Phone Call** action runs, it causes the following side effects:

1. **Draft Call Staging**: Server actions create `calle.call` records in `draft` state and schedule a To-Do activity (`mail.activity`) assigned to the user instead of automatically placing calls.
2. **Explicit User Confirmation & Manual Trigger**: Outbound calls are triggered manually by the user clicking **Trigger Call** on draft or failed records, which prompts a safety confirmation dialog ("Are you authorized to call this destination?") to verify intent. If the destination phone number is unauthorized or an active call is already pending, the record status is set to `failed` and can be re-triggered once authorization or concurrency issues are resolved.
3. **Places a Real Phone Call**: Upon user trigger, initiates an outbound voice call to the recipient's phone number via telephony carriers.
4. **E.164 & Strict ASCII Normalization**: Automatically validates raw phone input strings against strict ASCII E.164 standard (`+` followed by country code and 6 to 14 ASCII digits). Non-ASCII digits, confusable unicode characters, or non-compliant phone numbers are logged and safely skipped without contacting telephony carriers.
5. **Background Execution**: Call dispatching and status polling run asynchronously in background worker threads to avoid blocking Odoo UI response times.
6. **Saves Call Logs in Odoo**: Creates a `calle.call` audit log record storing call status, structured results, evidence, and timing.
7. **Emergency & Safety Boundaries**: Phone calls must never be configured for medical emergency, high-risk financial transfers, or legal notices without explicit human review.

---

## 7. Preview & Dry-Run Behavior

- **Prompt Preview Tab**: On any Server Action form configured for `calle_call`, open the **Generated Prompt** (`calle_prompt_preview`) tab to preview rendered Jinja2 dialogue prompts before running the action.
- **E.164 & Strict ASCII Pre-flight Validation**: Phone numbers are strictly pre-validated for ASCII compliance and E.164 formatting before call creation. Non-ASCII or invalid phone numbers log a `skipped` call record without contacting telephony endpoints.

---

## 8. Installation & Setup Instructions

### Prerequisites
- Odoo 19 environment running on Python 3.10+
- `calle-ai` Python package installed in the Odoo environment:

```bash
pip install calle-ai
```

### Module Installation
1. Copy the `call_e` folder into your Odoo `custom_addons` directory:
   ```text
   custom_addons/
   └── call_e/
   ```
2. Restart your Odoo server instance.
3. Activate Developer Mode in Odoo (`Settings -> General Settings -> Developer Tools`).
4. Go to **Apps**, click **Update Apps List**, search for `CALL-E Integration`, and click **Activate**.

### API Key Configuration
1. Navigate to **Settings -> General Settings -> CALL-E Configuration**.
2. Enter your CALL-E API Key obtained from your CALL-E dashboard.
3. Configure default locale (e.g., `en-US`) and pending timeout settings.
4. Click **Save**.

---

## 9. Usage & Configuration

### Creating a CALL-E Server Action
1. Go to **Settings -> Technical -> Actions -> Server Actions**.
2. Create a new record:
   - **Action Name**: `Confirm Order via CALL-E`
   - **Model**: `Sales Order` (`sale.order`)
   - **Action To Do**: `Trigger CALL-E Phone Call`
   - **Phone Field**: `partner_id.phone`
3. Add dialogue sections using the **CALL-E Sections** tab:
   - **Section 1**: `Hello {{ record.partner_id.name }}, we are calling to confirm order {{ record.name }} for {{ record.amount_total }} USD.`
   - **Expected Answers**: `Confirmed`, `Reschedule`

### Linking to Automation Rules
1. Go to **Settings -> Technical -> Automation Rules**.
2. Create a rule triggered on record creation or field update (e.g., when a Sale Order state changes to `sale`).
3. Under **Server Actions**, add your CALL-E server action.

---

## 10. Cancellation, Rollback & Deactivation Behavior

### Deactivating Automation Rules
To immediately halt future call staging:
1. Navigate to **Settings -> Technical -> Automation Rules**.
2. Open the rule linked to CALL-E.
3. Uncheck **Active** (or click **Archive**).

### Module Deactivation
Uninstalling the `call_e` module removes CALL-E server actions and menu items while preserving previously generated `calle.call` audit log data.

---

## 11. Tests & Manual Verification Path

### Automated Unit Tests

Run the built-in Odoo test suite for `call_e`:

```bash
python3 odoo-bin -c /path/to/odoo.conf -i call_e --test-enable --test-tags /call_e
```

The automated test suite (`call_e/tests/test_calle_call.py`) validates:
- E.164 phone string normalization and validation rules.
- Exact destination authorization allowlist filtering.
- Jinja2 prompt template rendering with record parameters and post-call response code execution notices.
- Draft call log (`calle.call`) creation and To-Do activity (`mail.activity`) scheduling upon server action trigger.
- Manual call trigger (`action_trigger_call`) flow, safety dialog confirmation, and activity completion.
- Call log display field computation (`result_text`, `structured_result`, `evidence`).
- Cron cleanup of stale pending calls.

### Manual Verification Path

1. **Verify Draft Call & Activity Creation**:
   - Execute a CALL-E server action on a record (`res.partner` or `sale.order`).
   - Verify a new `calle.call` record is created in `draft` status with a To-Do activity scheduled for review.
2. **Verify Manual Trigger & Safety Confirmation**:
   - Open the draft `calle.call` record and click **Trigger Call**.
   - Verify the pop-up confirmation dialog ("Are you authorized to call this destination?") appears before call execution.
3. **Verify Task Prompt & Code Execution Display**:
   - Inspect the **Task Prompt** tab on the call record and verify that any expected answer choices configured with Python action code are clearly displayed under `Post-Call Response Code Execution`.

