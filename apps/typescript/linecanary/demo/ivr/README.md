# Sample Dental — the demo IVR

A real, reachable phone menu that LineCanary monitors in the demo: greeting
announces the ownership-verification code (`LC-7391`), three menu options,
and a switchable "silent breakage" on the billing branch for the regression
story.

## One-time Twilio setup (~10 minutes, ~$21 once + ~$1.15/month)

1. Sign up at twilio.com, then **upgrade** with the minimum deposit (~$20).
   Upgrading matters: trial accounts prepend "You have a trial account…" to
   every call, which would pollute the demo audio.
2. Buy a US local number (Console → Phone Numbers → Buy, ~$1.15/mo). Voice
   capability only is fine.
3. Console → Functions & Assets → Services → **Create service** named
   `sample-dental` → **Add Function** with path `/ivr` → paste
   [`handler.js`](handler.js) → **Deploy All**.
4. Phone Numbers → your number → Voice Configuration → **A call comes in**:
   select Function → service `sample-dental` → `/ivr` → Save.
5. Call the number yourself once: you should hear the greeting, the
   verification code, and the menu.

## Wire it into LineCanary

Add the line + checks to your config (see
[`linecanary.demo-ivr.example.json`](linecanary.demo-ivr.example.json)),
then:

```bash
npx tsx src/cli.ts verify dental-ivr --live --config <config>   # hears LC-7391 in the greeting
npx tsx src/cli.ts run --config <config> --live
```

## The regression demo

Deploy with the variable set (environment variables persist across
deploys until explicitly overridden, so heal with an explicit `false`, not
by omitting the flag):

```bash
cd demo/ivr
echo "BREAK_BILLING=true"  > .env.broken  && npx twilio-run deploy --service-name sample-dental --env .env.broken   # break
echo "BREAK_BILLING=false" > .env.healthy && npx twilio-run deploy --service-name sample-dental --env .env.healthy  # heal
```

Option 3 now answers with six seconds of dead air and hangs up — exactly
the kind of silent breakage nobody notices. The next `linecanary run
--live` turns it into a paged regression (`new_failure` +
`assertion_regressed`), stays `still_failing` until truly healed, and
reports `recovered` after the fix.
