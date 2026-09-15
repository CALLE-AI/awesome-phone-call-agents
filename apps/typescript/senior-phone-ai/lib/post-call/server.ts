import "server-only";
import { createSupabaseAdminClient } from "../db/server";
import { SupabaseActionAuthorizationStore } from "../db/supabase-action-authorizations";
import { SupabasePostCallStore } from "../db/supabase-post-call-store";
import { SupabaseSmsStore } from "../db/supabase-sms-store";
import { SmsService } from "../tools/sms-service";
import { createSmsAdapter } from "../tools/twilio-sms";
import { PostCallFinalizer } from "./finalizer";

/** For trusted workers after call ownership verification; never expose service-role access to clients. */
export function createPostCallFinalizer() {
  const adapter = createSmsAdapter(process.env);
  const client = createSupabaseAdminClient();
  return new PostCallFinalizer(new SupabasePostCallStore(client), new SmsService(
    adapter, new SupabaseActionAuthorizationStore(client), new SupabaseSmsStore(client),
  ));
}
