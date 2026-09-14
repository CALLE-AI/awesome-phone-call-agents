# CALL-E Platform & SDK Developer Feedback Report
## Author: SmartRent Maintenance Team
### Target Award: Best CALL-E Feedback ($200 Prize)
### Project: SmartRent — Autonomous Multi-Call Property Maintenance Coordinator

---

## 🌟 Executive Summary
Building **SmartRent** on CALL-E was a breath of fresh air compared to traditional CPaaS providers (Twilio, Vonage) coupled with raw LLMs. The ability to pass a high-level `task` string alongside a strict `result_schema` and receive a completed call with extracted JSON, confidence scores, and verbatim evidence eliminates thousands of lines of fragile STT + prompt + TTS orchestration.

During our intensive implementation (handling multi-call state machines, multi-vendor cascade fallbacks, and real-time frontend synchronization), we identified **4 high-impact opportunities** that would make CALL-E the indisputable industry standard for conversational voice agents.

---

## 1. SDK Ergonomics: Async/Await & Streaming Event Streams
### The Observation
Currently, `client.calls.create_and_wait()` blocks synchronously until the call finishes. In modern asynchronous web frameworks (FastAPI, asyncio, Node.js), this requires developers to push calls onto background worker threads (like `asyncio.to_thread`) to avoid blocking the event loop:
```python
# Current workaround required in async servers:
result = await asyncio.to_thread(
    self._client.calls.create_and_wait,
    **call_params
)
```

### The Recommendation
1. **First-class Async Client**: Provide `AsyncCalleClient` where `await client.calls.create_and_wait(...)` uses non-blocking polling or long-polling under the hood.
2. **Server-Sent Events (SSE) / WebSocket Streaming**: Provide an event stream generator for live transcript turns:
```python
async for event in client.calls.stream(task=task, phone=phone):
    if event.type == "transcript_turn":
        await broadcast_to_frontend(event.speaker, event.text)
    elif event.type == "call_completed":
        save_structured_result(event.structured_result)
```
*Impact*: Enables real-time animated speech bubbles on client dashboards while the call is still happening, without having to configure an external public ngrok webhook during local development.

---

## 2. Schema Validation & Dynamic Extraction Hints
### The Observation
CALL-E's `result_schema` is one of its most powerful differentiators. However, when the callee provides ambiguous or contradictory answers (e.g. *"I might be able to make it around 3, but let me check... actually maybe tomorrow morning"*), the model occasionally returns `None` or an empty string if the schema doesn't allow nullable types.

### The Recommendation
1. **Extraction Confidence Per Field**: Currently, `completion_confidence` provides a top-level `score` and `label` for the overall call. Providing per-field confidence would allow fine-grained state machines to trigger targeted follow-ups:
```json
"structured_result": {
  "available": "yes",
  "eta": "2 hours"
},
"field_confidence": {
  "available": {"score": 0.98, "evidence": "I can be there within 2 hours."},
  "eta": {"score": 0.88, "evidence": "within 2 hours"}
}
```
2. **Native Pydantic / Typebox Integration**: Allow passing Python Pydantic classes or TypeScript Zod schemas directly into the SDK instead of manual dict conversion:
```python
class IntakeResult(BaseModel):
    issue_type: Literal["plumbing", "electrical", "hvac"]
    urgency: Literal["emergency", "urgent", "routine"]

client.calls.create(..., schema=IntakeResult)
```

---

## 3. Native Waterfall / Multi-Recipient Cascade Policies
### The Observation
In service dispatch workflows (maintenance, medical on-call, courier dispatch), dialing a primary contact who doesn't answer or declines is the most common real-world scenario. Currently, the developer must implement the outer retry/waterfall loop, tracking who was called, managing cooldowns, and initiating new calls.

### The Recommendation
Introduce a native `recipients_cascade` policy in CALL-E:
```json
{
  "cascade_recipients": [
    {"phone": "+15550100001", "name": "Primary Vendor"},
    {"phone": "+15550100011", "name": "Secondary Backup"}
  ],
  "cascade_condition": {
    "stop_when": "structured_result.available == 'yes'",
    "max_attempts": 3
  }
}
```
If Contractor #1 declines or misses the call, the CALL-E orchestration engine automatically cascades to Contractor #2 and returns the combined cascade trace.

---

## 4. Audio Recording Artifact URLs in SDK Response
### The Observation
The `CallResult` dictionary returns detailed `transcript_turns` with millisecond offsets, which is fantastic for text synchronization. However, retrieving the actual stereo call recording (.mp3 or .wav) to play back alongside the transcript requires manual recording webhook management or out-of-band dashboard downloads.

### The Recommendation
Expose a signed audio recording URL directly in the `CallResult` object:
```json
{
  "id": "call_98234",
  "status": "completed",
  "recording_url": "https://api.heycall-e.com/v1/recordings/rec_98234.mp3?token=...",
  "transcript": [...]
}
```
This allows customer-facing apps, CRM integrations, and audit dashboards to provide instant 1-click audio playback alongside the visual transcript.

---

## 🏆 Overall Platform Rating: 9.6 / 10
CALL-E is significantly ahead of raw LLM + telephony stacks in developer velocity. The schema-driven execution and transcript evidence parsing make building production-grade enterprise agents feasible in hours rather than months. We are thrilled to be part of the early developer ecosystem and look forward to deploying CALL-E in commercial property tech!
