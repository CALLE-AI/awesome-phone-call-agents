# Realtime boundary

This directory owns the OpenAI Realtime session lifecycle, instructions, access checks and latency measurements. The developer microphone harness is available at `/realtime`; its only tool is read-only server-side web search, and it cannot place calls or create other side effects.

The implementation uses the official OpenAI Agents SDK with `gpt-realtime-2.1` over browser WebRTC. OpenAI recommends WebRTC for browser voice agents because it handles live microphone and speaker media over a peer connection. The browser receives a 60-second Realtime client secret from the server and never receives `OPENAI_API_KEY`.

Session creation is disabled unless `SENIOR_PHONE_AI_MODE=live`. A live request must target `localhost` or `127.0.0.1`, have an exact same-origin browser header and remain under the process-local developer rate limit. LAN and public hostnames are rejected, and the development command binds only to `127.0.0.1`. The harness must not be deployed as a public route.

The session uses semantic VAD with automatic responses and interruption enabled. Closing the session or page calls the SDK's `close()` method; because the SDK owns the microphone stream in this harness, that also stops its tracks. The UI also exposes mute, explicit interruption and session end controls, and a 15-minute limit closes forgotten developer sessions.

The browser measures request-to-connection time and the interval from `input_audio_buffer.speech_stopped` to `output_audio_buffer.started` for each WebRTC turn. It also supports the first `response.output_audio.delta` used by transports that deliver audio bytes through events. These are observed client timings, not targets or service guarantees. Audio and transcripts are not persisted.

The `search_web` function tool is executed in the browser session and calls a loopback-only Next.js route, keeping the long-lived API key and Responses API request on the server. The server validates a bounded query and UUID v4 correlation ID, uses `gpt-5.5` with the built-in `web_search` tool, and returns at most 2,000 characters and five HTTP(S) sources. The UI renders all provider text as plain React text. Retrieved content is explicitly treated as untrusted data: it can support a factual answer but cannot grant consent, trigger an action or override agent instructions. The provider request has a 25-second timeout and the browser allows three additional seconds for transport; timeouts and provider failures return a failure result that instructs the voice agent to acknowledge the missing fresh information instead of guessing.

Official references verified on 2026-09-10:

- [Voice agents guide](https://developers.openai.com/api/docs/guides/voice-agents)
- [Realtime WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [Create a Realtime client secret](https://developers.openai.com/api/reference/typescript/resources/realtime/subresources/client_secrets/methods/create)
- [Realtime conversations and audio events](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [`gpt-realtime-2.1` model](https://developers.openai.com/api/docs/models/gpt-realtime-2.1)
- [Web search guide](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Agents SDK function tools](https://openai.github.io/openai-agents-js/guides/tools/)
- [Agents SDK voice agents](https://openai.github.io/openai-agents-js/guides/voice-agents/build/)

The safety layer follows the SDK's documented authorization boundary: conditional tool availability does not replace argument- or resource-level authorization. Future side-effect tools must perform the checks in `lib/safety/` during execution. Realtime output guardrails may later help interrupt unsafe spoken output, but asynchronous transcript checks do not replace deterministic action authorization.
