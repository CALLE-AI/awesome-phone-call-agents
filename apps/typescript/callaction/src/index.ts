import * as core from '@actions/core';
import * as github from '@actions/github';
import { CalleClient } from '@call-e/calle';

async function run() {
  try {
    // Fetch Inputs
    const apiKey = core.getInput('calle_api_key', { required: true });
    const phone = core.getInput('phone_number', { required: true });
    const token = core.getInput('github_token', { required: true });

    // SAFETY: Strict E.164 Validation & Phone Masking
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw new Error(`Invalid phone number: ${phone}. Must be strict E.164 (e.g., +12025550123). +0 is not allowed.`);
    }
    const maskedPhone = `${phone.substring(0, 3)}******${phone.substring(phone.length - 4)}`;
    core.info(`Starting CallAction escalation to ${maskedPhone}...`);

    // Initialize SDK and GitHub Context
    const client = new CalleClient({ apiKey });
    const prNumber = github.context.payload.pull_request?.number || github.context.issue.number;
    const runId = github.context.runId;

    if (!prNumber) {
      core.warning("Not running in a Pull Request context. Skipping GitHub comment posting.");
    }

    // LIVE CALL & IDEMPOTENCY
    // FIX: Using camelCase for TypeScript and passing idempotencyKey as the second argument
    const call = await client.calls.createAndWait(
      {
        task: `You are CallAction, a DevOps escalation assistant. Call ${phone}. Disclose that you are an AI immediately. Tell the engineer that GitHub Action run ${runId} just failed. Ask if they acknowledge the error, and what the next step should be: revert the commit, escalate to management, or they will fix it. Do not ask for passwords or secrets.`,
        recipients: [{ phones: [phone], locale: "en-US" }],
        resultSchema: {
          type: "object",
          required: ["action_decision", "engineer_notes"],
          properties: {
            action_decision: { type: "string", enum: ["revert", "escalate", "will_fix", "unknown"] },
            engineer_notes: { type: "string" }
          },
          additionalProperties: false
        }
      },
      {
        idempotencyKey: `callaction-escalate-${runId}`
      }
    );

    // FAIL-CLOSED DISPOSITION
    let finalDecision = "needs_human";
    const result = (call.structuredResult as any) || {};
    
    if (call.status === 'completed' && result.action_decision && result.action_decision !== 'unknown') {
      finalDecision = result.action_decision;
    }

    const report = `
🚨 **CallAction Escalation Report** 🚨
- **Contacted:** \`${maskedPhone}\`
- **Call Status:** \`${call.status}\`
- **Engineer Decision:** \`${finalDecision.toUpperCase()}\`
- **Notes:** ${result.engineer_notes || "No notes captured or call failed."}
    `;

    core.info(`Call Status: ${call.status}`);
    core.info(`Decision: ${finalDecision}`);

    // POST TO GITHUB PR
    if (prNumber) {
      const octokit = github.getOctokit(token);
      await octokit.rest.issues.createComment({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: prNumber,
        body: report
      });
      core.info(`Successfully posted comment to PR #${prNumber}`);
    }

    // ENFORCE CI PIPELINE FAILURE IF ESCALATION FAILED
    if (finalDecision === "needs_human" || finalDecision === "escalate") {
      core.setFailed(`Escalation required or call failed to reach resolution. Status: ${finalDecision}`);
    }

  } catch (error: any) {
    core.setFailed(`CallAction failed: ${error.message}`);
  }
}

run();