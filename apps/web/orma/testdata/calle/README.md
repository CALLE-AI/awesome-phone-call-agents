# CALL-E fixtures

These files hold the response shapes CALL-E returned during T1.4. Dry-run dispatch and the Deno tests replay them.

**The conversation is synthetic.** The transcript turns in `transcript.json`, `call-completed.json` and `call-completed-events.json` were rewritten on 14 September. They keep the original speakers, turn count and offsets, so every offset the tests assert still holds. No turn is a real person's words.

The same synthetic turns appear in the inline fixture in `supabase/functions/_shared/dispatch-mode.ts`. Change both together.

The `summary`, `evidence` and task text fields are still the provider's output from the T1.4 run, and they name the operator. Anything published outside this repository replaces them with synthetic text first. T8.5 owns that step.

Phone numbers in these files are masked.
