import { env } from "cloudflare:workers";
export function database(){
  if(!env.DB)throw new Error("Customer records are temporarily unavailable. Please try again.");
  return env.DB;
}
