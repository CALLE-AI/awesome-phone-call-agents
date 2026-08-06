import { envFromProcess } from "../_lib/calls";
import { handleReadiness } from "../_lib/readiness";

export const config = { runtime: "edge" };

export default function handler(request: Request): Promise<Response> {
  return handleReadiness(request, envFromProcess());
}
