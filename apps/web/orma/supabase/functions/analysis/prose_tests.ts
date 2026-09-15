/**
 * T7.2 Deno tests for pattern prose generation in prose.ts.
 * Every model call runs against an injected fetch and the synthetic
 * service-account key, so the suite never touches the network or a real key.
 * Pin with:
 * `deno test --allow-read --allow-env supabase/functions/analysis/prose.ts supabase/functions/analysis/prose_tests.ts`
 */
import { testServiceAccountJson, vertexGenerateContentUrl } from "../_shared/vertex.ts";
import {
  generatePatternProse,
  numbersOutsideFacts,
  patternProseDepsFromEnv,
  type PatternProseDeps,
} from "./prose.ts";

const testFn = (Deno as { test?: (name: string, fn: () => Promise<void>) => void }).test;
if (typeof testFn === "function" && !import.meta.main) {
  type RecordedCall = {
    url: string;
    method: string;
    headers: Headers;
    body: string;
  };

  const tokenUrl = "https://oauth2.googleapis.com/token";
  const generateUrl = vertexGenerateContentUrl("nryn-personal", "us-central1", "gemini-3.8-flash");

  // A transcript snippet that must never leave the facts stage.
  const transcriptText = "Tuesday transcript: she said the dentist office called twice";

  // The real T7.1 facts shape for one week. One item carries a digit run in
  // its text, so the text-run allowlist rule stays distinguishable from the
  // numeric fact values. The retired average mirrors the T7.1 fixture.
  const fixtureFacts = {
    period_start: "2026-09-01",
    period_end: "2026-09-07",
    period_days: 7,
    observed_days: 7,
    completed_runs: 11,
    answered_runs: 10,
    required_days: 3,
    sufficient_history: true,
    mentions: [
      { item_id: "33333333-3333-3333-3333-000000000771", text: "dentist", mention_count: 4 },
      { item_id: "33333333-3333-3333-3333-000000000773", text: "physio", mention_count: 3 },
      { item_id: "33333333-3333-3333-3333-000000000772", text: "email Amma", mention_count: 2 },
      {
        item_id: "33333333-3333-3333-3333-000000000774",
        text: "renew 12 month pass",
        mention_count: 1,
      },
    ],
    ages: [
      { item_id: "33333333-3333-3333-3333-000000000771", text: "dentist", age_days: 29 },
      { item_id: "33333333-3333-3333-3333-000000000772", text: "email Amma", age_days: 18 },
      { item_id: "33333333-3333-3333-3333-000000000774", text: "renew 12 month pass", age_days: 9 },
      { item_id: "33333333-3333-3333-3333-000000000776", text: "water plants", age_days: 10 },
      { item_id: "33333333-3333-3333-3333-000000000777", text: "book flight", age_days: 5 },
      { item_id: "33333333-3333-3333-3333-000000000778", text: "replace bulb", age_days: 1 },
    ],
    retirements: {
      retired_count: 1,
      avg_days_open: 31.0,
      items: [
        { item_id: "33333333-3333-3333-3333-000000000773", text: "physio", days_open: 31 },
      ],
    },
    longest_surviving: [
      { item_id: "33333333-3333-3333-3333-000000000771", text: "dentist", age_days: 29 },
      { item_id: "33333333-3333-3333-3333-000000000772", text: "email Amma", age_days: 18 },
      { item_id: "33333333-3333-3333-3333-000000000774", text: "renew 12 month pass", age_days: 9 },
      { item_id: "33333333-3333-3333-3333-000000000776", text: "water plants", age_days: 10 },
      { item_id: "33333333-3333-3333-3333-000000000777", text: "book flight", age_days: 5 },
    ],
    answer_rate_by_slot: [
      {
        slot_id: "22222222-2222-2222-2222-000000000771",
        part_of_day: "afternoon",
        local_time: "13:00",
        scheduled: 3,
        answered: 3,
        answer_rate: 1,
      },
      {
        slot_id: "11111111-1111-1111-1111-000000000771",
        part_of_day: "morning",
        local_time: "08:00",
        scheduled: 8,
        answered: 7,
        answer_rate: 0.88,
      },
    ],
    mood_distribution: [
      { mood: "ok", count: 5 },
      { mood: "low", count: 2 },
      { mood: "stressed", count: 2 },
      { mood: "energised", count: 1 },
    ],
  };

  // Every number traces to the fixture: the period boundaries, the morning
  // local time, counts, ages, the retirement average and the quoted item
  // text run.
  const validProse =
    "From 2026-09-01 to 2026-09-07 you completed 11 calls over 7 observed days. " +
    "The dentist item came up 4 times and has waited 29 days. " +
    "The physio item retired after 31 days. " +
    "Morning calls at 08:00 were answered at a rate of 0.88. " +
    "You also asked to renew 12 month pass.";

  function candidateBody(text: string): string {
    return JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
  }

  function depsWithResponses(
    candidateTexts: string[],
    calls: RecordedCall[],
    credentialsJson: string,
  ): PatternProseDeps {
    const queue = [...candidateTexts];
    return {
      project: "nryn-personal",
      location: "us-central1",
      model: "gemini-3.8-flash",
      credentialsJson,
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({
          url,
          method: init?.method ?? "GET",
          headers: new Headers(init?.headers),
          body: typeof init?.body === "string" ? init.body : "",
        });
        if (url === tokenUrl) {
          return new Response(JSON.stringify({ access_token: "ya29.prose-test" }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (url === generateUrl) {
          const text = queue.shift();
          if (text === undefined) throw new Error("no queued response must remain");
          return new Response(candidateBody(text), {
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error("network must not be reached");
      },
    };
  }

  function generateCalls(calls: RecordedCall[]): RecordedCall[] {
    return calls.filter((call) => call.url === generateUrl);
  }

  testFn("valid facts produce validated prose with facts in the request at temperature zero", async () => {
    const calls: RecordedCall[] = [];
    const credentialsJson = await testServiceAccountJson();
    const prose = await generatePatternProse(
      fixtureFacts,
      depsWithResponses([validProse], calls, credentialsJson),
    );
    if (prose !== validProse) throw new Error("must return the validated candidate text");
    if (numbersOutsideFacts(prose, fixtureFacts).length !== 0) {
      throw new Error("returned prose must pass the number validator");
    }
    const generate = generateCalls(calls);
    if (generate.length !== 1) throw new Error("a valid first response must end after one attempt");
    if (generate[0].headers.get("authorization") !== "Bearer ya29.prose-test") {
      throw new Error("must authorize with the exchanged bearer token");
    }
    const request = JSON.parse(generate[0].body) as {
      contents?: Array<{ parts?: Array<{ text?: string }> }>;
      generationConfig?: { temperature?: number };
    };
    if (request.generationConfig?.temperature !== 0) {
      throw new Error("must pin temperature zero for a stable request");
    }
    const prompt = request.contents?.[0]?.parts?.[0]?.text ?? "";
    if (!prompt.includes(JSON.stringify(fixtureFacts))) {
      throw new Error("the prompt must carry the serialized facts object");
    }
    if (calls.some((call) => call.body.includes(transcriptText))) {
      throw new Error("no transcript text may reach any request");
    }
  });

  testFn("an invented number is rejected and the next response is returned", async () => {
    const calls: RecordedCall[] = [];
    const credentialsJson = await testServiceAccountJson();
    const invented = "This week you answered 35 calls over 7 observed days.";
    const prose = await generatePatternProse(
      fixtureFacts,
      depsWithResponses([invented, validProse], calls, credentialsJson),
    );
    if (prose !== validProse) throw new Error("must return the second, valid response");
    if (generateCalls(calls).length !== 2) {
      throw new Error("must regenerate exactly once after one invalid response");
    }
  });

  testFn("three invalid responses throw and stop after three generation attempts", async () => {
    const calls: RecordedCall[] = [];
    const credentialsJson = await testServiceAccountJson();
    const invalid = [
      "This week you answered 35 calls.",
      "The morning answer rate reached 88 percent.",
      "You completed 6 calls across the week.",
    ];
    let failed = false;
    try {
      await generatePatternProse(fixtureFacts, depsWithResponses(invalid, calls, credentialsJson));
    } catch (error) {
      failed = error instanceof Error && error.message === "pattern prose failed number validation";
    }
    if (!failed) throw new Error("exhausted attempts must throw the number-validation failure");
    if (generateCalls(calls).length !== 3) {
      throw new Error("must stop after exactly three generation attempts");
    }
  });

  testFn("identical facts twice return identical prose", async () => {
    const firstCalls: RecordedCall[] = [];
    const secondCalls: RecordedCall[] = [];
    const credentialsJson = await testServiceAccountJson();
    const first = await generatePatternProse(
      fixtureFacts,
      depsWithResponses([validProse], firstCalls, credentialsJson),
    );
    const second = await generatePatternProse(
      fixtureFacts,
      depsWithResponses([validProse], secondCalls, credentialsJson),
    );
    if (first !== second) {
      throw new Error("identical facts with an identical response must return identical prose");
    }
    const firstBody = generateCalls(firstCalls)[0]?.body ?? "";
    const secondBody = generateCalls(secondCalls)[0]?.body ?? "";
    if (JSON.stringify(JSON.parse(firstBody)) !== JSON.stringify(JSON.parse(secondBody))) {
      throw new Error("the same facts must produce an identical request both times");
    }
  });

  testFn("the validator rejects a number absent from the facts even when it resembles a uuid", async () => {
    const uuidEcho = "Item 33333333-3333-3333-3333-000000000771 came up this week.";
    const outside = numbersOutsideFacts(uuidEcho, fixtureFacts);
    if (outside.length === 0) throw new Error("uuid digit runs must not join the allowlist");
    if (!outside.includes("33333333")) {
      throw new Error("the uuid digit run must be named as outside the facts");
    }
    const control = "The dentist item came up 4 times.";
    if (numbersOutsideFacts(control, fixtureFacts).length !== 0) {
      throw new Error("a control sentence carrying only fact numbers must pass");
    }
  });

  testFn("the validator accepts exact dates, times, decimals and integers from the fixture", async () => {
    const accepted =
      "From 2026-09-01 to 2026-09-07 the morning slot at 08:00 answered 7 of 8 calls, a rate of 0.88, and the physio item retired after 31 days.";
    const outside = numbersOutsideFacts(accepted, fixtureFacts);
    if (outside.length !== 0) {
      throw new Error(`exact fact tokens must pass: ${outside.join(", ")}`);
    }
  });

  testFn("a text digit run validates only while the source text appears in the prose", async () => {
    const quoted = "She wants to renew 12 month pass this week.";
    const quotedOutside = numbersOutsideFacts(quoted, fixtureFacts);
    if (quotedOutside.length !== 0) {
      throw new Error(`a quoted item text must validate its digit run: ${quotedOutside.join(", ")}`);
    }
    const caseFolded = "SHE WANTS TO RENEW 12  MONTH PASS this week.";
    if (numbersOutsideFacts(caseFolded, fixtureFacts).length !== 0) {
      throw new Error("matching must fold case and collapse whitespace around the quoted text");
    }
    const fabricated = "You completed 12 calls this week.";
    if (numbersOutsideFacts(fabricated, fixtureFacts).length === 0) {
      throw new Error("a text digit run must fail while its source text is absent");
    }
    const invented = "You asked to renew the 13 month pass once.";
    if (numbersOutsideFacts(invented, fixtureFacts).length === 0) {
      throw new Error("a digit run missing from item text must fail");
    }
  });

  testFn("empty prose is rejected and retried", async () => {
    const calls: RecordedCall[] = [];
    const credentialsJson = await testServiceAccountJson();
    const prose = await generatePatternProse(
      fixtureFacts,
      depsWithResponses(["", validProse], calls, credentialsJson),
    );
    if (prose !== validProse) throw new Error("must retry past an empty candidate and return the valid one");
    if (generateCalls(calls).length !== 2) {
      throw new Error("an empty candidate must consume exactly one attempt");
    }
  });

  testFn("patternProseDepsFromEnv fails on the first missing variable", async () => {
    const full = new Map<string, string>([
      ["GOOGLE_VERTEX_PROJECT", "nryn-personal"],
      ["GOOGLE_VERTEX_LOCATION", "us-central1"],
      ["GEMINI_MODEL", "gemini-3.8-flash"],
      ["GOOGLE_APPLICATION_CREDENTIALS_JSON", "injected-per-test"],
    ]);
    for (const missing of full.keys()) {
      const partial = new Map(full);
      partial.delete(missing);
      let failed = false;
      try {
        patternProseDepsFromEnv((name) => partial.get(name));
      } catch (error) {
        failed = error instanceof Error && error.message === `missing ${missing}`;
      }
      if (!failed) throw new Error(`a missing ${missing} must stop startup with its name`);
    }
    const deps = patternProseDepsFromEnv((name) => full.get(name));
    if (
      deps.project !== "nryn-personal" || deps.location !== "us-central1" ||
      deps.model !== "gemini-3.8-flash" || deps.credentialsJson !== "injected-per-test"
    ) {
      throw new Error("must map the four Vertex variables onto the shared deps");
    }
  });
}
