import type { Provider } from "./types";
import type { CallRepository } from "./repository";

export async function reconcileOpenCalls(
  provider: Provider,
  repo: CallRepository,
  ids: string[],
) {
  const results: Array<{ id: string; ok: boolean; status?: string; error?: string }> = [];
  for (const id of ids) {
    try {
      const remote = await provider.getCall(id);
      await repo.putCall(remote);
      results.push({ id, status: remote.status, ok: true });
    } catch (error) {
      results.push({ id, ok: false, error: String(error) });
    }
  }
  return results;
}
