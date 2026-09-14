import type { AwsSnapshot, Decision } from "./types.js";

export type FailureScenario = {
  id: string;
  title: string;
  summary: string;
  symptoms: string[];
  recommended: Decision;
  scaleTo: number | null;
  sayOnPhone: string;
  fixCommand: string;
  snapshot: AwsSnapshot;
};

function now() {
  return new Date().toISOString();
}

function base(partial: Partial<AwsSnapshot> & Pick<AwsSnapshot, "service" | "cluster" | "alarm">): AwsSnapshot {
  return {
    gatheredAt: now(),
    accountId: "playbook",
    callerArn: "failure-catalog",
    region: "ap-southeast-1",
    serviceStatus: "ACTIVE",
    runningCount: 2,
    desiredCount: 2,
    pendingCount: 0,
    currentTaskDefinition: "arn:aws:ecs:ap-southeast-1:123456789012:task-definition/checkout-api:8",
    currentRevision: 8,
    previousTaskDefinition: "arn:aws:ecs:ap-southeast-1:123456789012:task-definition/checkout-api:7",
    previousRevision: 7,
    events: [],
    cpuPercent: null,
    target5xx: null,
    unhealthyTargets: null,
    securityGroup: null,
    recentLogs: [],
    ...partial
  };
}

export const FAILURE_SCENARIOS: FailureScenario[] = [
  {
    id: "easy-scale",
    title: "Easy demo: scale four",
    summary: "Checkout desired count is 0. Say two short words. Best case for the video.",
    symptoms: ["running 0 / desired 0", "Checkout dark"],
    recommended: "scale",
    scaleTo: 4,
    sayOnPhone: "Scale four. Confirm go.",
    fixCommand: "aws ecs update-service --cluster prod --service checkout-api --desired-count 4",
    snapshot: base({
      cluster: "prod",
      service: "checkout-api",
      runningCount: 0,
      desiredCount: 0,
      pendingCount: 0,
      target5xx: 940,
      unhealthyTargets: 0,
      alarm: {
        name: "checkout-api-no-tasks",
        state: "ALARM",
        reason: "RunningTaskCount = 0",
        updatedAt: now()
      },
      events: ["service checkout-api has reached a steady state with 0 running tasks"]
    })
  },
  {
    id: "bad-deploy-5xx",
    title: "Bad deploy - checkout 5xx",
    summary: "checkout-api task:8 started 02:41 SGT. 5xx jumped to 11%. Last healthy was task:7.",
    symptoms: ["ALB 5xx 148 in 15m", "Unhealthy targets 3/4", "Deploy checkout-api:8 at 02:41"],
    recommended: "rollback",
    scaleTo: null,
    sayOnPhone: "Rollback. Confirm go.",
    fixCommand:
      "aws ecs update-service --cluster prod --service checkout-api --task-definition checkout-api:7 --force-new-deployment",
    snapshot: base({
      cluster: "prod",
      service: "checkout-api",
      runningCount: 1,
      desiredCount: 4,
      pendingCount: 3,
      target5xx: 148,
      unhealthyTargets: 3,
      cpuPercent: 22,
      alarm: {
        name: "checkout-api-5xx",
        state: "ALARM",
        reason: "HTTPCode_Target_5XX_Count >= 50 for 5 minutes",
        updatedAt: now()
      },
      events: [
        "service checkout-api has started 1 tasks: task:8",
        "service checkout-api: deployment failed: tasks failed to pass health checks"
      ],
      recentLogs: [
        "ERROR payment_client timeout after 3000ms",
        "ERROR NullPointerException at PricingController.java:88"
      ]
    })
  },
  {
    id: "scaled-to-zero",
    title: "Desired count dropped to 0",
    summary: "Someone or a bad autoscaler set desired count to 0. No tasks running. Checkout is dark.",
    symptoms: ["running 0 / desired 0", "ALB 5xx 900+", "No healthy targets"],
    recommended: "scale",
    scaleTo: 4,
    sayOnPhone: "Scale four. Confirm go.",
    fixCommand: "aws ecs update-service --cluster prod --service checkout-api --desired-count 4",
    snapshot: base({
      cluster: "prod",
      service: "checkout-api",
      runningCount: 0,
      desiredCount: 0,
      pendingCount: 0,
      target5xx: 940,
      unhealthyTargets: 0,
      alarm: {
        name: "checkout-api-no-tasks",
        state: "ALARM",
        reason: "RunningTaskCount = 0",
        updatedAt: now()
      },
      events: ["service checkout-api has reached a steady state with 0 running tasks"]
    })
  },
  {
    id: "cpu-saturation",
    title: "CPU saturation - flash sale",
    summary: "CPU 94% for 12 minutes. Tasks healthy but latency p99 is 4.8s. Need more capacity, not a rollback.",
    symptoms: ["CPU 94%", "p99 4.8s", "5xx low (12)", "Current revision otherwise healthy"],
    recommended: "scale",
    scaleTo: 8,
    sayOnPhone: "Scale eight. Confirm go.",
    fixCommand: "aws ecs update-service --cluster prod --service checkout-api --desired-count 8",
    snapshot: base({
      cluster: "prod",
      service: "checkout-api",
      runningCount: 2,
      desiredCount: 2,
      cpuPercent: 94,
      target5xx: 12,
      unhealthyTargets: 0,
      alarm: {
        name: "checkout-api-cpu",
        state: "ALARM",
        reason: "CPUUtilization > 85 for 10 minutes",
        updatedAt: now()
      },
      events: ["service checkout-api has reached a steady state"]
    })
  },
  {
    id: "oom-unhealthy",
    title: "OOM kills after memory bump",
    summary: "New revision raised JVM heap. Tasks restart in a crash loop. Health checks fail.",
    symptoms: ["Exit 137 OOMKilled", "Unhealthy 4/4", "Revision 8 vs healthy 7"],
    recommended: "rollback",
    scaleTo: null,
    sayOnPhone: "Rollback. Confirm go.",
    fixCommand:
      "aws ecs update-service --cluster prod --service checkout-api --task-definition checkout-api:7 --force-new-deployment",
    snapshot: base({
      cluster: "prod",
      service: "checkout-api",
      runningCount: 0,
      desiredCount: 4,
      pendingCount: 4,
      unhealthyTargets: 4,
      target5xx: 220,
      alarm: {
        name: "checkout-api-unhealthy",
        state: "ALARM",
        reason: "UnHealthyHostCount >= 3",
        updatedAt: now()
      },
      events: ["(service checkout-api) was unable to place a task", "task failed: Essential container exited 137"],
      recentLogs: ["java.lang.OutOfMemoryError: Java heap space"]
    })
  },
  {
    id: "sg-blocks-rds",
    title: "Security group blocks RDS",
    summary: "App SG no longer allows 5432 to the database SG. Tasks are up; every request is 500.",
    symptoms: ["Tasks running 4/4", "Connection timed out jdbc:postgresql", "SG ingress missing 5432"],
    recommended: "escalate",
    scaleTo: null,
    sayOnPhone: "Escalate. Confirm go.",
    fixCommand:
      "aws ec2 authorize-security-group-ingress --group-id sg-db-prod --protocol tcp --port 5432 --source-group sg-checkout-api",
    snapshot: base({
      cluster: "prod",
      service: "checkout-api",
      runningCount: 4,
      desiredCount: 4,
      target5xx: 410,
      unhealthyTargets: 0,
      cpuPercent: 8,
      alarm: {
        name: "checkout-api-5xx",
        state: "ALARM",
        reason: "HTTPCode_Target_5XX_Count >= 50",
        updatedAt: now()
      },
      securityGroup: {
        id: "sg-checkout-api",
        ingress: ["tcp 443-443 from 0.0.0.0/0", "tcp 80-80 from 0.0.0.0/0"]
      },
      recentLogs: [
        "org.postgresql.util.PSQLException: Connection timed out",
        "HikariPool-1 - Connection is not available, request timed out after 30000ms"
      ],
      events: ["service checkout-api has reached a steady state"]
    })
  },
  {
    id: "stuck-deployment",
    title: "Stuck ECS deployment",
    summary: "Circuit breaker did not kick in. Primary and active deployments both hanging. Force rollback.",
    symptoms: ["Two deployments IN_PROGRESS for 38m", "pending 6", "running 1"],
    recommended: "rollback",
    scaleTo: null,
    sayOnPhone: "Rollback. Confirm go.",
    fixCommand:
      "aws ecs update-service --cluster prod --service checkout-api --task-definition checkout-api:7 --force-new-deployment",
    snapshot: base({
      cluster: "prod",
      service: "checkout-api",
      runningCount: 1,
      desiredCount: 4,
      pendingCount: 6,
      target5xx: 77,
      unhealthyTargets: 2,
      alarm: {
        name: "checkout-api-deploy-stuck",
        state: "ALARM",
        reason: "Deployment running longer than 30 minutes",
        updatedAt: now()
      },
      events: [
        "deployment d-old PRIMARY 1 running",
        "deployment d-new ACTIVE 0 running 6 pending — no progress 38 minutes"
      ]
    })
  },
  {
    id: "cache-stampede",
    title: "Redis timeout stampede",
    summary: "Redis p99 800ms. App retries hammer origin. Scale buys time; this is not a bad deploy.",
    symptoms: ["Redis timeouts", "CPU 71%", "5xx 60", "Revision unchanged for 6 days"],
    recommended: "scale",
    scaleTo: 6,
    sayOnPhone: "Scale six. Confirm go.",
    fixCommand: "aws ecs update-service --cluster prod --service checkout-api --desired-count 6",
    snapshot: base({
      cluster: "prod",
      service: "checkout-api",
      runningCount: 3,
      desiredCount: 3,
      currentRevision: 7,
      currentTaskDefinition: "arn:aws:ecs:ap-southeast-1:123456789012:task-definition/checkout-api:7",
      previousRevision: 6,
      previousTaskDefinition: "arn:aws:ecs:ap-southeast-1:123456789012:task-definition/checkout-api:6",
      cpuPercent: 71,
      target5xx: 60,
      alarm: {
        name: "checkout-api-latency",
        state: "ALARM",
        reason: "TargetResponseTime > 2s",
        updatedAt: now()
      },
      recentLogs: ["WARN redis: Get cart timeout after 200ms", "ERROR origin fallback overloaded"]
    })
  },
  {
    id: "false-alarm-ack",
    title: "Flapping alarm - no user impact",
    summary: "Alarm flapped once. p99 and 5xx are normal. Correct move is ack, not a change.",
    symptoms: ["5xx 2", "CPU 18%", "Unhealthy 0", "One brief ALARM then recovering"],
    recommended: "ack",
    scaleTo: null,
    sayOnPhone: "Acknowledge. Confirm go.",
    fixCommand: "No AWS write. Record ack in the incident timeline.",
    snapshot: base({
      cluster: "prod",
      service: "checkout-api",
      cpuPercent: 18,
      target5xx: 2,
      unhealthyTargets: 0,
      alarm: {
        name: "checkout-api-5xx",
        state: "ALARM",
        reason: "Brief spike then recovered; still in ALARM cooldown",
        updatedAt: now()
      },
      events: ["service checkout-api has reached a steady state"]
    })
  }
];

export function getScenario(id: string | undefined | null): FailureScenario | undefined {
  if (!id) return undefined;
  return FAILURE_SCENARIOS.find((item) => item.id === id);
}

export function scenarioCatalog() {
  return FAILURE_SCENARIOS.map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    symptoms: item.symptoms,
    recommended: item.recommended,
    scaleTo: item.scaleTo,
    sayOnPhone: item.sayOnPhone,
    fixCommand: item.fixCommand
  }));
}
