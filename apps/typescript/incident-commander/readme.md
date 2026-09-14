# 3 AM Incident Commander

Voice-driven SRE for the CALL-E hackathon. A real CloudWatch/ECS incident pages the on-call engineer with **CALL-E**, briefs them from **live AWS APIs**, captures a spoken decision, then runs an allowlisted `UpdateService` (rollback or scale). No mock AWS. No fake transcripts.

## What it does

1. Trigger from the console, `POST /hooks/alert`, CloudWatch SNS (`POST /hooks/sns`), or a CloudWatch alarm poller.
2. `GetCallerIdentity`, `DescribeServices`, previous task definition, CloudWatch alarm/metrics, optional ALB target health, security group, and log tail.
3. CALL-E Developer API (`@call-e/calle`) places an outbound call to `ONCALL_PHONE` with that briefing and a confirmation phrase.
4. After the call, structured result + webhook/poll: `rollback` | `scale` | `ack` | `escalate`.
5. If the engineer says the confirmation phrase, the app calls ECS `UpdateService` for real.
6. Optional second CALL-E call with the post-change live snapshot. Escalate places a real call to `ESCALATE_PHONE`.

## Setup

```bash
cp .env.example .env
```

Fill:

| Variable | Purpose |
| --- | --- |
| `CALLE_API_KEY` | CALL-E dashboard API key |
| `ONCALL_PHONE` | E.164 number CALL-E will dial |
| `ESCALATE_PHONE` | Secondary E.164 number |
| `ONCALL_REGION` / `ONCALL_LOCALE` | CALL-E recipient region, e.g. `SG` / `en-US` |
| `PUBLIC_BASE_URL` | HTTPS origin for `/calle/webhook` (ngrok). Polling still works without it. |
| `AWS_REGION`, `ECS_CLUSTER`, `ECS_SERVICE` | Live ECS target |
| `CW_ALARM_NAME` | Alarm the poller watches |
| `ALB_TARGET_GROUP_ARN` | Optional 5xx / unhealthy targets |
| `ECS_SECURITY_GROUP_ID` | Optional SG briefing |
| `ECS_LOG_GROUP` | Optional recent logs in the briefing |
| `ALLOW_AWS_WRITES` | `true` to run `UpdateService` after confirmation |

AWS credentials: default chain (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, shared config, or instance role). The IAM principal needs `ecs:Describe*`, `ecs:ListTaskDefinitions`, `ecs:UpdateService`, `cloudwatch:DescribeAlarms`, `cloudwatch:GetMetricData`, `sts:GetCallerIdentity`, plus `elasticloadbalancing:DescribeTargetHealth`, `ec2:DescribeSecurityGroups`, and `logs:DescribeLogStreams` / `logs:GetLogEvents` if those resources are set.

```bash
npm install
npm run dev
```

Open [http://localhost:8787](http://localhost:8787). Click **Page on-call with live AWS snapshot**.

## Safety

- Writes are only `ecs:UpdateService` on the configured cluster/service.
- Rollback uses the previous **existing** task definition revision.
- Scale is clamped to `MAX_DESIRED_COUNT`.
- Mutating actions require the spoken confirmation phrase CALL-E is instructed to collect.
- `ack` does not mutate AWS. `escalate` only places another CALL-E call.

## Webhooks

- `POST /calle/webhook` — CALL-E terminal events (`CALL-E-Event-Id` must match body `id`).
- `POST /hooks/sns` — CloudWatch via SNS (confirms `SubscribeURL`).
- `POST /hooks/alert` — generic `{ "alarmName", "reason", "source" }`.

Point a CloudWatch alarm SNS topic at `https://<PUBLIC_BASE_URL>/hooks/sns`.

## Hackathon notes

CALL-E is used at runtime through the TypeScript SDK (`calls.create`, `waitForResult`, optional `webhookUrl`). AWS MCP is not used for phone calls; CALL-E MCP is for placing calls, not for running the AWS CLI. This app is the commander: CALL-E is the phone, ECS APIs are the hands.
