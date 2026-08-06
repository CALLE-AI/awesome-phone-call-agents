const baseUrl = process.env.CARECALL_PUBLIC_BASE_URL;
const cronSecret = process.env.CRON_SECRET;

if (!baseUrl || !cronSecret) {
  console.error("Set CARECALL_PUBLIC_BASE_URL and CRON_SECRET before running the deployment preflight.");
  process.exit(1);
}

let endpoint;
try {
  endpoint = new URL("/api/carecall/readiness", baseUrl);
  if (endpoint.protocol !== "https:") throw new Error("insecure");
} catch {
  console.error("CARECALL_PUBLIC_BASE_URL must be a valid HTTPS deployment URL.");
  process.exit(1);
}

try {
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${cronSecret}` } });
  const body = await response.json();
  console.log(JSON.stringify(body, null, 2));
  if (!response.ok || !body.ready) process.exitCode = 1;
  else if (!body.healthy) console.warn("Deployment configuration is ready, but operational alerts require review before a live call.");
} catch {
  console.error("The CareCall readiness endpoint could not be reached or returned an invalid response.");
  process.exitCode = 1;
}
