import { NextResponse } from "next/server";
import { config, getConfigHealth } from "@/lib/config";
import { pingRedis } from "@/lib/redis";

async function checkBroker(): Promise<boolean> {
  try {
    const res = await fetch(`${config.brokerBaseUrl}/.well-known/oauth-protected-resource`, {
      method: "GET",
      signal: AbortSignal.timeout(Math.min(config.timeoutMs, 8_000)),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function GET() {
  const health = getConfigHealth();

  const checks = {
    redis: false,
    broker: false,
  };

  if (health.ok) {
    checks.redis = await pingRedis();
    checks.broker = await checkBroker();
  }

  const dependencyOk = checks.redis && checks.broker;

  if (!health.ok || !dependencyOk) {
    return NextResponse.json({ status: "not_ready" }, { status: 503 });
  }

  return NextResponse.json({ status: "ready" });
}
