import { UpdateServiceCommand } from "@aws-sdk/client-ecs";
import type { AppConfig } from "../config.js";
import type { AwsSnapshot, Decision, ExecutionResult, SpokenDecision } from "../types.js";
import type { AwsClients } from "./context.js";

export function plannedCommand(decision: SpokenDecision, snapshot: AwsSnapshot): string {
  if (decision.decision === "rollback") {
    if (!snapshot.previousTaskDefinition) {
      return "aws ecs update-service — blocked: no previous task definition revision found";
    }
    return `aws ecs update-service --cluster ${snapshot.cluster} --service ${snapshot.service} --task-definition ${snapshot.previousTaskDefinition} --force-new-deployment`;
  }
  if (decision.decision === "scale") {
    return `aws ecs update-service --cluster ${snapshot.cluster} --service ${snapshot.service} --desired-count ${decision.scaleTo ?? "?"}`;
  }
  if (decision.decision === "escalate") {
    return "place CALL-E escalation call to secondary on-call";
  }
  return "acknowledge only — no AWS write";
}

export async function executeDecision(options: {
  config: AppConfig;
  clients: AwsClients;
  snapshot: AwsSnapshot;
  spoken: SpokenDecision;
  fixCommand?: string | null;
}): Promise<ExecutionResult> {
  const { config, clients, snapshot, spoken, fixCommand } = options;
  const action = spoken.decision === "unknown" ? "ack" : spoken.decision;
  const at = new Date().toISOString();
  const command = fixCommand || plannedCommand(spoken, snapshot);

  if (action === "ack") {
    return { at, action: "ack", ok: true, command, output: "Acknowledged. No AWS mutation." };
  }
  if (action === "escalate") {
    return { at, action: "escalate", ok: true, command, output: "Escalation call requested." };
  }

  if (!spoken.confirmationOk) {
    return {
      at,
      action: action as Decision,
      ok: false,
      command,
      output: "",
      error: "Spoken confirmation code did not match. AWS writes were not executed."
    };
  }

  const canWriteLive = Boolean(config.ALLOW_AWS_WRITES && config.ECS_CLUSTER && config.ECS_SERVICE);
  if (!canWriteLive) {
    return {
      at,
      action: action as Decision,
      ok: true,
      command,
      output:
        "Confirmed spoken decision. Applied the real runbook command in the incident record. Live ECS UpdateService was not used because AWS cluster/service is not the demo path."
    };
  }

  try {
    if (action === "rollback") {
      if (!snapshot.previousTaskDefinition) {
        throw new Error("No previous ECS task definition revision exists to roll back to");
      }
      const result = await clients.ecs.send(
        new UpdateServiceCommand({
          cluster: snapshot.cluster,
          service: snapshot.service,
          taskDefinition: snapshot.previousTaskDefinition,
          forceNewDeployment: true
        })
      );
      const svc = result.service;
      return {
        at,
        action,
        ok: true,
        command,
        output: JSON.stringify(
          {
            taskDefinition: svc?.taskDefinition,
            desiredCount: svc?.desiredCount,
            deployments: svc?.deployments?.map((d) => ({
              status: d.status,
              taskDefinition: d.taskDefinition,
              rollout: d.rolloutState
            }))
          },
          null,
          2
        )
      };
    }

    if (action === "scale") {
      const desired = spoken.scaleTo;
      if (desired === null || !Number.isInteger(desired) || desired < 1 || desired > config.MAX_DESIRED_COUNT) {
        throw new Error(`scale_to must be an integer between 1 and ${config.MAX_DESIRED_COUNT}`);
      }
      const result = await clients.ecs.send(
        new UpdateServiceCommand({
          cluster: snapshot.cluster,
          service: snapshot.service,
          desiredCount: desired
        })
      );
      return {
        at,
        action,
        ok: true,
        command,
        output: JSON.stringify(
          {
            desiredCount: result.service?.desiredCount,
            runningCount: result.service?.runningCount,
            pendingCount: result.service?.pendingCount
          },
          null,
          2
        )
      };
    }

    throw new Error(`Unsupported action ${action}`);
  } catch (error) {
    return {
      at,
      action: action as Decision,
      ok: false,
      command,
      output: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
