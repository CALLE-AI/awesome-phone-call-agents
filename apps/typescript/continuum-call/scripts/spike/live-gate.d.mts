export type NamedLiveGateDecision = {
  ok: boolean;
  failures: string[];
  experiment_id: string;
  expected_confirmation: string;
};

export function checkNamedLiveGate(args: {
  experimentId: string;
  base: string;
  phone: string;
  apiKey: string;
}): NamedLiveGateDecision;
