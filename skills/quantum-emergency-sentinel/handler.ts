/**
 * Reusable OpenAgentSkill Handler for CALL-E Awesome Phone Call Agents
 */

import { CalleVoiceSentinelClient, CalleTaskConfig, CalleCallResult } from '../../src/services/calleClient';

export async function runSkill(input: CalleTaskConfig): Promise<CalleCallResult> {
  const client = new CalleVoiceSentinelClient();
  return client.dispatchEmergencyCall(input);
}
