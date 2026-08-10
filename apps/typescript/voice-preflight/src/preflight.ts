/**
 * Run the preflight: optionally synthesise, then check, then decide.
 *
 * The order is deliberate. Offline checks run whether or not anything was
 * rendered, so a missing locked line is caught without spending a character of
 * anybody's quota. Rendering only adds the one finding that needs real audio,
 * which is the measured spoken length.
 */

import { blocks, checkAll } from "./checks.js";
import { render } from "./gateway.js";
import { probeSeconds } from "./probe.js";
import type { PreflightResult, ProviderDescriptor, Render, Script } from "./types.js";

export interface PreflightOptions {
  script: Script;
  descriptor: ProviderDescriptor;
  /** Where rendered audio is cached. One file per provider, voice and text. */
  cacheDir: string;
  allowedHosts: Iterable<string>;
  /** False keeps the run entirely offline, which is the default. */
  doRender: boolean;
  fetchImpl?: typeof fetch;
  env?: Readonly<Record<string, string | undefined>>;
}

export async function preflight(options: PreflightOptions): Promise<PreflightResult> {
  const { script, descriptor } = options;
  let rendered: Render | null = null;

  if (options.doRender) {
    const first = await render({
      descriptor,
      voiceId: script.voiceId,
      text: script.task,
      cacheDir: options.cacheDir,
      allowedHosts: options.allowedHosts,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    // Measured from the file that was just written, never derived from the text.
    rendered = { ...first, seconds: probeSeconds(first.path) };
  }

  const findings = checkAll(script, descriptor, rendered);
  return {
    scriptId: script.id,
    render: rendered,
    findings,
    ok: !blocks(findings),
  };
}
