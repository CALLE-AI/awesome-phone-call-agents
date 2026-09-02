import * as core from '@actions/core';
import * as github from '@actions/github';
import { CalleClient } from '@call-e/calle';

// Helper to redact phone-like sequences from the LLM summary
function redactPhoneLike(text: string): string {
  if (!text) return '';
  const phoneLikeRegex = /(?:\+?\d[\d\s\-\.\(\)]{5,}\d)/g;
  return text.replace(phoneLikeRegex, '[phone-redacted]');
}

async function run() {
  try {
    const apiKey = core.getInput('calle_api_key', { required: true });
    const phone = core.getInput('phone_number', { required: true });
    const token = core.getInput('github_token', { required: true });
    const mode = core.getInput('mode') || 'preview';
    const authorizeLiveCallTo = core.getInput('authorize_live_call_to');

    // DO NOT ECHO MALFORMED INPUT
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw new Error('Invalid phone number format provided. Must be strict E.164 (e.g., +12025550123). +0 is not allowed.');
    }

    const maskedPhone = `${phone.substring(0, 3)}******${phone.substring(phone.length - 4)}`;

    // EXPLICIT LIVE GATE
    if (mode === 'live') {
      if (phone !== authorizeLiveCallTo) {
        throw new Error('Refusing to dial: authorize_live_call_to must exactly match phone_number when in live mode.');
      }
    }

    const prNumber = github.context.payload.pull_request?.number || github.context.issue?.number;
    const runId = github.context.runId || 'local-preview';

    const taskPrompt = `You are CallAction, a DevOps escalation assistant. Call ${phone}. Disclose that you are an AI immediately. Tell the engineer that GitHub Action run ${runId} just failed. Ask if they acknowledge the error, and what the next step should be: revert the commit, escalate to management, or they will fix it. Do not ask for passwords or secrets.`;
    
    // MASKED PREVIEW (Blocker 2 Fix)
    const maskedTaskPrompt = taskPrompt.replace(phone, maskedPhone);

    // NO-CALL/DRY-RUN DEFAULT
    if (mode !== 'live') {
      core.info(`PREVIEW MODE: No call will be placed. To execute, set mode: 'live' and pass authorize_live_call_to.`);
      core.info(`Would call: ${maskedPhone}`);
      // Only log the MASKED version of the prompt!
      core.info(`Task preview:\n${maskedTaskPrompt}`);
      return; 
    }

    core.info(`Starting LIVE CallAction escalation to ${maskedPhone}...`);
    const client = new CalleClient({ apiKey });

    const call = await client.calls.createAndWait(
      {
        task: taskPrompt,
        recipients: [{ phones: [phone], locale: "en-US" }],
        resultSchema: {
          type: "object",
          required: ["action_decision", "engineer_notes"],
          properties: {
            action_decision: { type: "string", enum: ["revert", "escalate", "will_fix", "unknown"] },
            engineer_notes: { type: "string", description: "Short summary. Do not include phone numbers or sensitive data." }
          },
          additionalProperties: false
        }
      },
      {
        idempotencyKey: `callaction-escalate-${runId}`
      }
    );

    let finalDecision = "needs_human";
    const result = (call.structuredResult as any) || {};
    
    if (call.status === 'completed' && result.action_decision && result.action_decision !== 'unknown') {
      finalDecision = result.action_decision;
    }

    // CONSTRAIN AND REDACT PROVIDER NOTES (Blocker 3 Fix)
    // We aggressively sanitize the raw LLM output before it hits the markdown report.
    let safeNotes = "No notes captured or call failed.";
    const rawNotes = result.engineer_notes;
    
    if (typeof rawNotes === 'string' && rawNotes.trim().length > 0) {
      // 1. Truncate to a safe maximum length
      const truncated = rawNotes.substring(0, 300);
      // 2. Run through phone redaction
      const redacted = redactPhoneLike(truncated);
      // 3. Remove markdown injection attempts (e.g., links, images)
      safeNotes = redacted.replace(/\[.*\]\(.*\)/g, '[link-removed]');
    }

    const report = `
🚨 **CallAction Escalation Report** 🚨
- **Contacted:** \`${maskedPhone}\`
- **Call Status:** \`${call.status}\`
- **Engineer Decision:** \`${finalDecision.toUpperCase()}\`
- **Notes:** ${safeNotes}
    `.trim();

    core.info(`Call Status: ${call.status}`);
    core.info(`Decision: ${finalDecision}`);

    if (prNumber) {
      const octokit = github.getOctokit(token);
      await octokit.rest.issues.createComment({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: prNumber,
        body: report
      });
      core.info(`Successfully posted comment to PR #${prNumber}`);
    } else {
      core.warning("Not running in a Pull Request context. Skipping GitHub comment posting.");
    }

    if (finalDecision === "needs_human" || finalDecision === "escalate") {
      core.setFailed(`Escalation required or call failed to reach resolution. Status: ${finalDecision}`);
    }

  } catch (error: any) {
    core.setFailed(`CallAction failed: ${error.message}`);
  }
}

run();