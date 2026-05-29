# Community Roadmap

This roadmap is a living guide for the early `awesome-phone-call-agents`
community. It describes directions we are excited to explore, not a fixed
release plan, formal specification, or contribution gate.

Because the community is just getting started, small examples are welcome. A
useful README, a workflow sketch, a fake-server demo, a platform note, or a
single focused skill can all be valuable contributions.

## Community Focus

CALL-E SDKs, provider APIs, authentication, call execution, billing primitives,
and provider-side controls belong upstream with CALL-E itself. This repository
is for community artifacts around those primitives:

- Agent Skills for reusable phone-call workflows.
- Workflow plugins for business and automation platforms.
- Runnable, user-facing apps for trying, operating, reviewing, scheduling, or
  managing phone-call workflows without touching code.
- Fixtures, templates, and examples that make it easier for others to build.

Where possible, examples should be easy to try without placing a real call:
fake servers, dry-run modes, preview payloads, and fictional phone numbers are
all encouraged.

## Design Direction

These are preferences that help the ecosystem stay portable and easy to review:

- Keep phone-call workflows explicit and easy to inspect.
- Let the host or workflow platform handle scheduling when recurrence is needed.
- Keep CALL-E focused on the call execution path.
- Prefer small, reusable examples over large frameworks.
- Keep provider-specific details in references or example config.
- Include enough notes for another contributor to understand setup, expected
  behavior, and possible real-world side effects.

## Skills

Agent Skills package repeatable phone-call scenarios. A skill can be a complete
workflow, a template, a safety pattern, or a host-specific reference.

Current examples:

- [`call-reminder`](../skills/call-reminder/)
- [`google-form-callback`](../skills/google-form-callback/)

You do not need to contribute a full skill to help this area. Smaller pieces
such as examples, templates, scheduler notes, and safety notes are also useful.

### Skill Ideas

| Skill idea | Scenario |
| --- | --- |
| `customer-callback-request` | Call a customer from a support ticket or form. |
| `appointment-confirmation-call` | Confirm an appointment, consultation, meeting, service visit, or reschedule request. |
| `lead-qualification-call` | Qualify a high-intent lead by collecting needs, budget, timing, and interest level. |
| `order-exception-follow-up-call` | Follow up on an order exception. |
| `service-dispatch-confirmation-call` | Confirm installation, repair, delivery, or on-site service timing and notes. |
| `incident-escalation-call` | Notify an on-call engineer about a major incident and capture acknowledgement. |
| `deployment-approval-call` | Confirm whether an owner approves a high-risk deployment. |
| `candidate-availability-call` | Confirm candidate interview availability during recruiting. |

Useful skill contributions often include a clear goal, inputs, outputs, example
prompts, a preview or dry-run path, and a short note about when the skill should
not place a call.

## Plugins

Workflow plugins make CALL-E available where business events already happen. A
plugin might be a native action, workflow node, connector recipe, marketplace
app, UI extension, or template.

Concrete platform plugin examples are still open for community exploration.

Plugin contributions can be full platform integrations, workflow templates,
connector recipes, verification fixtures, or platform notes.

### Plugin Ideas

| Platform | Suggested contribution | What it could enable |
| --- | --- | --- |
| Dify | Plugin/tool and workflow template. | Start an outbound CALL-E call from an AI workflow and return structured results. |
| n8n | Community node package and workflow templates. | Provide `Start Call`, `Get Call Result`, and `Wait for Outcome` nodes. |
| Zapier | Zap app action and trigger examples. | Trigger calls from leads, rows, deals, tickets, or forms, then write back a disposition or summary. |
| HubSpot | Workflow action, Calling Extension, or UI card example. | Start calls from CRM records or workflows and write call logs or summaries back to HubSpot. |
| Feishu/Lark | Automation node, custom app, bot, or widget example. | Trigger calls from approvals, tables, docs, or group messages, then notify the group with results. |

### Platform Areas

| Area | Platforms | Contribution ideas |
| --- | --- | --- |
| CRM and sales | Salesforce, Pipedrive, HubSpot, Zoho Flow, monday.com | Contact/deal callbacks, record-page actions, workflow actions, and CRM writeback examples. |
| Support and service | Zendesk, Freshdesk/Freshworks, Intercom, Kustomer, ServiceNow | Ticket callback buttons, escalation workflows, support-note writeback, and survey calls. |
| AI and automation | Dify, n8n, Zapier, Make, Activepieces, Workato, Power Automate | Nodes, actions, tools, templates, webhook recipes, and callback fixtures. |
| Collaboration and knowledge | Feishu/Lark, Slack Workflow Builder, Notion, Google Workspace Apps Script, Airtable | Approval calls, table-row calls, group notifications, and database writeback recipes. |
| Ecommerce and operations | Shopify Flow, Odoo, Greenhouse | Order exception, candidate coordination, reservation, and operations follow-up workflows. |
| Developer and infrastructure | GitHub Actions, Jira Automation/Forge, AWS EventBridge | Incident escalation, release notification, and API destination recipes. |
| Enterprise integration | SAP Integration Suite, Oracle Integration, Boomi, Tray.ai | Project-driven connector notes and enterprise event-routing examples. |
| Contact center | Twilio Flex | Agent-console plugin ideas for callbacks, summaries, and call-assist workflows. |

Plugin examples can choose the result fields that fit their platform. Common
fields to consider include `status`, `outcome`, `summary`, `recording_url`,
`transcript_url`, `external_call_id`, `started_at`, `completed_at`,
`recipient_phone_e164`, `source_platform`, and `source_object_id`.

## Apps

Apps are runnable, user-facing tools that help people try, operate, review,
schedule, or manage phone-call workflows without touching code. They are not a
replacement for the CALL-E SDK or provider API.

Current examples:

- [`python/batch-runner`](../apps/python/batch-runner/)
- [`python/broker-login-client`](../apps/python/broker-login-client/)
- [`python/oauth-login-client`](../apps/python/oauth-login-client/)

App contributions can start small: a focused call creation flow, a scenario app,
a review screen, or a scheduling experience.

### App Ideas

The suggested starting point is the simplest loop: create a phone-call task, run
the call, and view the result.

| App idea | Purpose |
| --- | --- |
| `apps/web/calle-call-chat` | Create a phone-call task in a chat interface, confirm the goal, contact, and context, run the call, and view the result. |
| `apps/web/call-review-console` | Review call results, summaries, recordings, transcripts, and follow-up status. |
| `apps/web/call-scheduler-ui` | Create, preview, update, and stop scheduled phone-call workflows. |
| `apps/web/customer-callback-app` | Manage customer callback requests from forms, tickets, chat, or support follow-up. |
| `apps/web/business-call-workbench` | Run focused workflows such as appointment confirmation, lead follow-up, order exception handling, and service dispatch. |

Useful app contributions often include a README, example inputs and outputs, a
dry-run or fake-server path, and tests that do not need live credentials.

## Open Questions

These are good topics for issues or discussions:

- Which skill scenarios are most useful as first community examples?
- Which plugin platforms need full packages, and which only need lightweight
  connector recipes?
- What should the first `calle-call-chat` experience include?
- Which scenario app should come first after the basic call loop works?
- Which result fields are worth sharing across skills, plugins, and apps?
- Which platform review or listing notes would be helpful to document?
- Which sample workflows best represent real demand: sales follow-up, support
  callback, approval confirmation, recruiting coordination, ecommerce recovery,
  incident escalation, or reminders?
