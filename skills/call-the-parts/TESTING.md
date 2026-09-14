# Testing instructions for application

Install the `call-the-parts` folder into Cursor or Codex and run `calle auth login` if you are not already signed in.

Preview with no call:

```bash
node skills/call-the-parts/scripts/preview-shop-call.mjs \
  --input skills/call-the-parts/references/fixtures/sample-request.json
```

Check a sample quote:

```bash
node skills/call-the-parts/scripts/validate-quote.mjs \
  --input skills/call-the-parts/references/fixtures/sample-quote.json
```

In the agent, load `$call-the-parts` and give it a car, a used part, a spare parts shop, and an E.164 number you are allowed to call. It shows the preview first. A live CALL-E call starts only after you say to call that shop.
