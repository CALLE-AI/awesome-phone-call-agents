import assert from "node:assert/strict";
import test from "node:test";

import {
  calleWebhookUrl,
  campaignNameFromGoal,
  CampaignInputError,
  createSafeDraftFromCompiled,
  parseCampaignCompileInput,
} from "../lib/campaigns/compile";
import type { CalleCallRequest, Contact } from "../types/campaign";

const compiled: CalleCallRequest = {
  task: "Identify yourself as an AI assistant, ask permission, and stop if declined.",
  result_schema: {
    type: "object",
    properties: { consented: { type: "boolean" } },
    required: ["consented"],
    additionalProperties: false,
  },
  metadata: { campaignId: "campaign-1", contactId: "contact-1" },
  webhook_url: "http://localhost:3000/api/calle/webhook",
};

const contact: Contact = {
  id: "contact-1",
  name: "Marta Reyes",
  phoneNumber: "+14155550100",
  metadata: { source: "inbound" },
};

async function withAppUrl(
  value: string | undefined,
  callback: () => void | Promise<void>,
): Promise<void> {
  const previous = process.env.APP_URL;
  try {
    if (value === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = value;
    await callback();
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
}

test("campaign compile input is strict, trimmed, and E.164-only", () => {
  const parsed = parseCampaignCompileInput({
    name: "  Wealth inbound  ",
    contact: {
      name: "  Marta Reyes ",
      phoneNumber: "+14155550100",
      metadata: { source: " inbound " },
    },
  });
  assert.deepEqual(parsed, {
    name: "Wealth inbound",
    contact: {
      name: "Marta Reyes",
      phoneNumber: "+14155550100",
      metadata: { source: "inbound" },
    },
  });

  assert.throws(
    () =>
      parseCampaignCompileInput({
        name: "Campaign",
        contact: { name: "Marta", phoneNumber: "+1 415 555 0100" },
      }),
    CampaignInputError,
  );
  assert.throws(
    () =>
      parseCampaignCompileInput({
        name: "Campaign",
        contact: { name: "Marta", phoneNumber: "+14155550100" },
        launch: true,
      }),
    CampaignInputError,
  );
});

test("compiled engine output becomes a Phase 1 draft with durable correlation", () => {
  const draft = createSafeDraftFromCompiled(compiled, "Wealth inbound", contact, "en-IN");
  assert.equal(draft.phone, contact.phoneNumber);
  assert.equal(draft.locale, "en-IN");
  assert.equal(draft.task, compiled.task);
  assert.deepEqual(draft.resultSchema, compiled.result_schema);
  assert.deepEqual(draft.metadata, {
    campaignId: "campaign-1",
    contactId: "contact-1",
    campaignName: "Wealth inbound",
    contactName: "Marta Reyes",
  });
});

test("invalid compiler schemas are stopped before preview or CALL-E", () => {
  assert.throws(
    () =>
      createSafeDraftFromCompiled(
        {
          ...compiled,
          result_schema: { ...compiled.result_schema, oneOf: [] },
        },
        "Wealth inbound",
        contact,
        "en-IN",
      ),
    /CALL-E compatible/,
  );
});

test("derived campaign names stay inside the persistence boundary", () => {
  const name = campaignNameFromGoal(`  ${"A".repeat(300)}  `);
  assert.equal(name.length, 48);
  assert.equal(name.endsWith("…"), true);
  assert.equal(campaignNameFromGoal("  Qualify   wealth leads  "), "Qualify wealth leads");
  assert.equal(campaignNameFromGoal("  "), "Generated campaign");
});

test("webhook URL is normalized and rejects non-http origins", async () => {
  await withAppUrl("https://veyra.example/base?ignored=yes", () => {
    assert.equal(calleWebhookUrl(), "https://veyra.example/api/calle/webhook");
  });
  await withAppUrl("file:///tmp/veyra", () => {
    assert.throws(() => calleWebhookUrl(), CampaignInputError);
  });
});
