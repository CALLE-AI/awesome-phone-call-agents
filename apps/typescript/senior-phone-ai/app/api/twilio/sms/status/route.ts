import { getRuntimeMode } from "@/lib/config/server";
import { createSupabaseAdminClient } from "@/lib/db/server";
import { SupabaseSmsStore } from "@/lib/db/supabase-sms-store";
import { readTwilioSmsConfig } from "@/lib/tools/twilio-sms";
import { createTwilioStatusHandler } from "@/lib/tools/twilio-status-handler";
import { createCalleFollowups, calleFollowupsEnabled } from "@/lib/calle/followup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createTwilioStatusHandler(
  () => getRuntimeMode() === "live" && process.env.SMS_ENABLED === "true" ? readTwilioSmsConfig(process.env) : undefined,
  () => ({
    async applyDelivery(event) {
      if (calleFollowupsEnabled()) {
        const local = await createCalleFollowups().applyDelivery(event);
        if (local) return local;
      }
      if (process.env.SUPABASE_SECRET_KEY) return new SupabaseSmsStore(createSupabaseAdminClient()).applyDelivery(event);
      return undefined;
    },
  }),
);
