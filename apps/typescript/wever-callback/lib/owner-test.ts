import { env } from "cloudflare:workers";
import type { Inquiry } from "./domain";

// Configured only for the owner's explicitly requested test inquiry.
// Display names, source labels and browser flags cannot grant this exception.
export function ownerTestEligible(owner:string,inquiry:Pick<Inquiry,"id"|"phone"|"sample">):boolean{
  return !!env.CALLBACK_TEST_OWNER_ID && !!env.CALLBACK_TEST_INQUIRY_ID && !!env.CALLBACK_TEST_PHONE
    && !inquiry.sample && owner===env.CALLBACK_TEST_OWNER_ID
    && inquiry.id===env.CALLBACK_TEST_INQUIRY_ID && inquiry.phone===env.CALLBACK_TEST_PHONE;
}
