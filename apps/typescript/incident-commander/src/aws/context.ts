import {
  CloudWatchClient,
  DescribeAlarmsCommand,
  GetMetricDataCommand
} from "@aws-sdk/client-cloudwatch";
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand
} from "@aws-sdk/client-cloudwatch-logs";
import { DescribeSecurityGroupsCommand, EC2Client } from "@aws-sdk/client-ec2";
import {
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  ECSClient,
  ListTaskDefinitionsCommand
} from "@aws-sdk/client-ecs";
import {
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import type { AppConfig } from "../config.js";
import type { AwsSnapshot } from "../types.js";

function parseRevision(arn: string | undefined | null): { family: string; revision: number } | null {
  if (!arn) return null;
  const match = arn.match(/task-definition\/(.+):(\d+)$/);
  if (!match) return null;
  return { family: match[1], revision: Number(match[2]) };
}

export function createAwsClients(config: AppConfig) {
  const region = config.AWS_REGION;
  return {
    sts: new STSClient({ region }),
    ecs: new ECSClient({ region }),
    cw: new CloudWatchClient({ region }),
    logs: new CloudWatchLogsClient({ region }),
    ec2: new EC2Client({ region }),
    elbv2: new ElasticLoadBalancingV2Client({ region })
  };
}

export type AwsClients = ReturnType<typeof createAwsClients>;

export async function identity(clients: AwsClients) {
  const result = await clients.sts.send(new GetCallerIdentityCommand({}));
  if (!result.Account || !result.Arn) {
    throw new Error("STS GetCallerIdentity returned an incomplete response");
  }
  return { accountId: result.Account, arn: result.Arn };
}

export async function gatherAwsSnapshot(
  config: AppConfig,
  clients: AwsClients,
  alarmNameHint?: string | null
): Promise<AwsSnapshot> {
  if (!config.ECS_CLUSTER || !config.ECS_SERVICE) {
    throw new Error("ECS_CLUSTER and ECS_SERVICE must be set to gather live AWS context");
  }

  const { accountId, arn } = await identity(clients);
  const cluster = config.ECS_CLUSTER;
  const service = config.ECS_SERVICE;
  const alarmName = alarmNameHint ?? config.CW_ALARM_NAME ?? null;

  const serviceRes = await clients.ecs.send(
    new DescribeServicesCommand({ cluster, services: [service] })
  );
  const ecsService = serviceRes.services?.[0];
  if (!ecsService) {
    throw new Error(`ECS service ${service} not found in cluster ${cluster}`);
  }

  const currentTd = ecsService.taskDefinition ?? null;
  const parsed = parseRevision(currentTd);
  let previousTaskDefinition: string | null = null;
  let previousRevision: number | null = null;

  if (parsed) {
    const listed = await clients.ecs.send(
      new ListTaskDefinitionsCommand({
        familyPrefix: parsed.family,
        sort: "DESC",
        status: "ACTIVE",
        maxResults: 10
      })
    );
    const previousArn = listed.taskDefinitionArns?.find((item) => item !== currentTd);
    if (previousArn) {
      const described = await clients.ecs.send(
        new DescribeTaskDefinitionCommand({ taskDefinition: previousArn })
      );
      previousTaskDefinition = described.taskDefinition?.taskDefinitionArn ?? previousArn;
      previousRevision = described.taskDefinition?.revision ?? parseRevision(previousArn)?.revision ?? null;
    }
  }

  const events =
    ecsService.events?.slice(0, 6).map((event) => {
      const when = event.createdAt ? event.createdAt.toISOString() : "";
      return `${when} ${event.message ?? ""}`.trim();
    }) ?? [];

  let alarm = {
    name: alarmName,
    state: null as string | null,
    reason: null as string | null,
    updatedAt: null as string | null
  };
  if (alarmName) {
    const alarms = await clients.cw.send(new DescribeAlarmsCommand({ AlarmNames: [alarmName] }));
    const metricAlarm = alarms.MetricAlarms?.[0];
    if (metricAlarm) {
      alarm = {
        name: metricAlarm.AlarmName ?? alarmName,
        state: metricAlarm.StateValue ?? null,
        reason: metricAlarm.StateReason ?? null,
        updatedAt: metricAlarm.StateUpdatedTimestamp?.toISOString() ?? null
      };
    }
  }

  const now = new Date();
  const start = new Date(now.getTime() - 15 * 60 * 1000);
  let cpuPercent: number | null = null;
  let target5xx: number | null = null;

  const metricQueries = [
    {
      Id: "cpu",
      MetricStat: {
        Metric: {
          Namespace: "AWS/ECS",
          MetricName: "CPUUtilization",
          Dimensions: [
            { Name: "ClusterName", Value: cluster },
            { Name: "ServiceName", Value: service }
          ]
        },
        Period: 60,
        Stat: "Average"
      },
      ReturnData: true
    }
  ];

  const metrics = await clients.cw.send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: now,
      MetricDataQueries: metricQueries
    })
  );
  const cpuValues = metrics.MetricDataResults?.find((item) => item.Id === "cpu")?.Values;
  if (cpuValues && cpuValues.length > 0) {
    cpuPercent = Math.round(cpuValues[0] * 10) / 10;
  }

  let unhealthyTargets: number | null = null;
  if (config.ALB_TARGET_GROUP_ARN) {
    const health = await clients.elbv2.send(
      new DescribeTargetHealthCommand({ TargetGroupArn: config.ALB_TARGET_GROUP_ARN })
    );
    const descriptions = health.TargetHealthDescriptions ?? [];
    unhealthyTargets = descriptions.filter((item) => item.TargetHealth?.State !== "healthy").length;

    const albMetrics = await clients.cw.send(
      new GetMetricDataCommand({
        StartTime: start,
        EndTime: now,
        MetricDataQueries: [
          {
            Id: "e5xx",
            MetricStat: {
              Metric: {
                Namespace: "AWS/ApplicationELB",
                MetricName: "HTTPCode_Target_5XX_Count",
                Dimensions: [{ Name: "TargetGroup", Value: targetGroupDimension(config.ALB_TARGET_GROUP_ARN) }]
              },
              Period: 60,
              Stat: "Sum"
            },
            ReturnData: true
          }
        ]
      })
    );
    const values = albMetrics.MetricDataResults?.[0]?.Values;
    if (values && values.length > 0) {
      target5xx = values.reduce((sum, n) => sum + n, 0);
    }
  }

  let securityGroup: AwsSnapshot["securityGroup"] = null;
  if (config.ECS_SECURITY_GROUP_ID) {
    const sg = await clients.ec2.send(
      new DescribeSecurityGroupsCommand({ GroupIds: [config.ECS_SECURITY_GROUP_ID] })
    );
    const group = sg.SecurityGroups?.[0];
    if (group) {
      securityGroup = {
        id: group.GroupId ?? config.ECS_SECURITY_GROUP_ID,
        ingress: (group.IpPermissions ?? []).map((rule) => {
          const proto = rule.IpProtocol ?? "-";
          const from = rule.FromPort ?? "all";
          const to = rule.ToPort ?? "all";
          const cidrs = [
            ...(rule.IpRanges ?? []).map((range) => range.CidrIp ?? ""),
            ...(rule.UserIdGroupPairs ?? []).map((pair) => pair.GroupId ?? "")
          ]
            .filter(Boolean)
            .join(",");
          return `${proto} ${from}-${to} from ${cidrs || "none"}`;
        })
      };
    }
  }

  const recentLogs: string[] = [];
  if (config.ECS_LOG_GROUP) {
    const streams = await clients.logs.send(
      new DescribeLogStreamsCommand({
        logGroupName: config.ECS_LOG_GROUP,
        orderBy: "LastEventTime",
        descending: true,
        limit: 1
      })
    );
    const stream = streams.logStreams?.[0]?.logStreamName;
    if (stream) {
      const eventsRes = await clients.logs.send(
        new GetLogEventsCommand({
          logGroupName: config.ECS_LOG_GROUP,
          logStreamName: stream,
          limit: 15,
          startFromHead: false
        })
      );
      for (const event of eventsRes.events ?? []) {
        const text = (event.message ?? "").trim();
        if (text) recentLogs.push(text.slice(0, 400));
      }
    }
  }

  return {
    gatheredAt: now.toISOString(),
    accountId,
    callerArn: arn,
    region: config.AWS_REGION,
    cluster,
    service,
    serviceStatus: ecsService.status ?? null,
    runningCount: ecsService.runningCount ?? null,
    desiredCount: ecsService.desiredCount ?? null,
    pendingCount: ecsService.pendingCount ?? null,
    currentTaskDefinition: currentTd,
    currentRevision: parsed?.revision ?? null,
    previousTaskDefinition,
    previousRevision,
    events,
    alarm,
    cpuPercent,
    target5xx,
    unhealthyTargets,
    securityGroup,
    recentLogs
  };
}

function targetGroupDimension(arn: string): string {
  const parts = arn.split(":");
  const last = parts[parts.length - 1] ?? arn;
  return last.replace(/^targetgroup\//, "targetgroup/");
}

export async function describeAlarmState(clients: AwsClients, alarmName: string) {
  const alarms = await clients.cw.send(new DescribeAlarmsCommand({ AlarmNames: [alarmName] }));
  const metricAlarm = alarms.MetricAlarms?.[0];
  return {
    name: metricAlarm?.AlarmName ?? alarmName,
    state: metricAlarm?.StateValue ?? null,
    reason: metricAlarm?.StateReason ?? null
  };
}
