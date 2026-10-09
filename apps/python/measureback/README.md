# MeasureBack

An AI phone interview that asks what "two bowls" means, keeps the cook's correction and scales only the measurements supported by the conversation.

CALL E carries the interview. Python validates the source quotations and does the arithmetic. The browser shows the recipe beside the words it came from.

## Try it without a call

Requires Python 3.10 or newer. No third party Python packages, account or API key is needed for the example.

```sh
cd apps/python/measureback
python3 -m measureback serve --port 8793
```

Open http://127.0.0.1:8793. Live calling is disabled by default.

1. The first stage says two bowls of rice. The bowl size stays unresolved.
2. Choose **Ask the cook**. The authored conversation supplies a measured 250 ml bowl. At six servings, the rice becomes 750 ml.
3. Choose **Read it back**. The cook corrects water from 1000 ml to 900 ml. At six servings, that becomes 1350 ml. Click Water to inspect the correction.
4. Change the serving count. Salt stays to taste. The stated 18 minute simmer and 5 minute rest do not scale. Fractional pieces require a person's decision instead of silent rounding.
5. Save the recipe JSON, then import it locally. An invalid source quotation or incompatible calibration is rejected.

The entire example, including its transcript, is authored. It is not a recording of a real cook and does not establish recipe quality or live language performance.

## What makes this different

Voice recipe capture already exists. MeasureBack concentrates on the missing measurement: a household bowl or cup cannot be treated as a standard unit. The interview asks for a measured calibration, reads amounts back and preserves explicit corrections. If the cook does not know an amount, the application keeps a concrete question open.

The quantity engine uses exact fractions derived from finite decimals. It does not infer density, convert a volume to a weight, invent a bowl size, round indivisible ingredients or calculate cooking times. Evidence anchors must be exact quotations from cook turns. For CALL E results, those turns must also match the provider's actual transcript in speaker and order. An exact anchor establishes where text came from; it does not prove that a person measured correctly or that the extraction interpreted the words correctly. Review remains necessary.

## Live interview

Only call an adult who has agreed to receive this AI interview. Obtain permission to capture and share the recipe. Use an authorized phone number. The agent discloses its AI identity and asks for consent again during the call. The client requires capture and sharing quotations anchored in the provider transcript and blocks a result reporting refusal or withdrawal. Exact text matching does not establish the meaning of consent. Before opening a returned recipe, the UI requires you to review the full provider transcript for affirmative permission, uncertainty or later withdrawal.

Set `CALLE_API_KEY` in the server environment using your normal secret manager or shell. The `.env.example` file is documentation; this app does not automatically load `.env` files.

```sh
python3 -m measureback serve --port 8793 --live
```

In **Prepare a call**, enter the recipe, names and the cook's E.164 number. Select the initial language and fixed or adaptive instructions. Preview is a separate step and never creates a call. Review the masked recipient and the displayed 15 minute approval window, then explicitly approve the call task.

The current focused interface supports India with English, Hindi or Tamil as the initial locale. Adaptive mode asks the agent to follow the cook within provider supported languages. This is best effort, not a documented automatic language detection API. Original language quotations stay unchanged. Review any translation separately.

The key is read only by the local server and is not returned to the browser. The browser necessarily holds the number you type until the page is closed or refreshed. No phone numbers, transcripts or keys are sent to the public example. Keep private exports private.

### Side effects, retries and stopping

Approval submits one CALL E task for one recipient. The provider may manage its own dialing attempts; this app does not claim to control that behavior. There are no recurring schedules.

The local SQLite ledger at `.state/calls.sqlite3` reserves each request before submission. Repeating the same request does not submit another task. A timeout or interrupted submission stays reserved as uncertain. Do not delete the ledger or change the request ID to retry. Inspect the existing task in the CALL E account first.

The browser keeps only the pending request ID, task ID and state in local storage across reloads. It locks new interviews after an uncertain submission until you explicitly confirm that you checked the existing task. It does not store the recipient number or key there. Editing the form invalidates approval, including while a preview response is still in flight.

Before approval, close the page or edit the form to invalidate its approval. After provider acceptance, this client has no documented cancellation endpoint and cannot guarantee cancellation. Check the CALL E account. Stopping the local server does not stop an accepted provider task.

Use **Check call result** for the existing task. The application prepares a private result only after validating completion, reported consent with source evidence, one unambiguous attempt, the recipe structure and source transcript. It then requires your consent review before opening the recipe. Failed, ambiguous, multiple attempt or unsupported results need manual review. It does not make another call to repair them.

This is a local single user application. It binds loopback only. Do not expose the live server through a public tunnel or reverse proxy. The public static example has no calling endpoint.

## Verification

```sh
python3 -m unittest discover -s tests -v
python3 scripts/smoke_provider.py
python3 -m measureback example --stage corrected --servings 6
```

The HTTP tests and smoke command bind temporary loopback ports. A restricted sandbox may require permission for that. They never contact CALL E or use a real key.

The smoke command submits through an injected HTTP transport to a real local fake server, checks the provider shaped response, prevents a duplicate POST and verifies corrected water at 900 ml and scaled water at 1350 ml. This is transport seam verification, not a live CALL E call.

Tests cover malformed input, strict decimal bounds, cycles, unit compatibility, source quotes, corrections, consent refusal, approval changes, time windows, duplicate concurrency, ambiguous submissions, redirect refusal, provider transcript mismatch, private route restrictions and public export isolation.

The optional browser checks require Node.js, the `playwright` package and its Chromium browser. With the local server running, run `node scripts/browser_check.cjs` and `node scripts/browser_call_safety.cjs`. Set `MEASUREBACK_TEST_ORIGIN` if you selected a different loopback port. Both scripts block external requests; the call safety checks fulfil every call route with authored responses. Screenshots from the first script go to the ignored `artifacts/browser-check/` directory.

## Public example export

```sh
python3 -m measureback export --output artifacts/site
```

This exports the UI and three authored recipes at serving counts 1 through 12. Every displayed amount is calculated by the Python engine at export time; the browser selects the corresponding report. Arbitrary private imports and live calling remain local. Do not represent this static example as a hosted live calling service.

## Boundaries

MeasureBack does not provide food safety, allergy, nutrition or medical advice. Do not use it to establish safe cooking temperatures, preservation processes, medical diets or ingredient substitutions. A larger batch may need different technique or cooking time; the app preserves the cook's stated timing rather than predicting the answer. No nutritional facts, family testimonials or real usage metrics are claimed.

Original recipe capture, semantic interpretation, live language adaptation and provider structured result support still need controlled testing with consenting cooks. The shipped public walkthrough uses fixtures. No live cook interview is claimed for this contribution.

## Layout and license

`measureback/recipe.py` owns quantities and source validation. `measureback/calle.py` owns the CALL E contract and durable approval ledger. `measureback/server.py` owns the loopback UI boundary. `web/` contains the browser interface. `scripts/smoke_provider.py` is the fake HTTP provider exercise.

Application code is MIT licensed. Atkinson Hyperlegible Next is bundled under its SIL Open Font License in `web/fonts/OFL.txt`.
