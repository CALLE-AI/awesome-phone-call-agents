# Examples

## Dry-run demo (no real call)

```bash
python3 scripts/run_dual_fly.py \
  --number "+1 555 010 0100" \
  --org "Example Bank"
```

The fixture makes the suspect fly detect `asks_for_otp` and `demands_secrecy`,
so the verdict is `likely_scam`. Output is printed to stdout and written to
`results/`.

## Plan only (no dial)

```bash
python3 scripts/run_dual_fly.py \
  --number "+1 555 010 0100" \
  --org "Example Bank" \
  --plan
```

`--plan` drafts both fly plans through the real CALL-E service and prints
`plan_id`, `ready_to_run`, and any clarifying questions without placing a call.

## Override the official number

```bash
python3 scripts/run_dual_fly.py \
  --number "+1 555 010 0100" \
  --org "Example Bank" \
  --official "+1 800 555 0100"
```

## Live run (CLI)

Install the CLI and authorize once:

```bash
cd scripts
npm install
./node_modules/.bin/calle auth login   # opens a browser; approve once
./node_modules/.bin/calle mcp tools
cd ..
```

Then run the dual-fly flow:

```bash
python3 scripts/run_dual_fly.py \
  --number "<real E.164 suspect number>" \
  --org "Example Bank" \
  --region "US" \
  --live
```

`--live` plans and starts two real outbound calls through the CALL-E CLI
(`--backend cli`). Use `--backend rest` with `CALLE_API_KEY` for the Developer
API path. Replace the whitelist placeholder with a real published official line
first.

## Sample output (abbreviated)

```json
{
  "verdict": "likely_scam",
  "confidence": 0.83,
  "signals": [
    "asked for a one-time passcode or verification code",
    "demanded secrecy from family or authorities",
    "detected 2 high-risk request(s)"
  ],
  "official_fly": {
    "number_called": "+1 800 555 0100",
    "reached": true,
    "summary": "The official line confirmed Example Bank does not operate an 'account frozen' callback flow...",
    "content_hash": "sha256..."
  },
  "suspect_fly": {
    "number_called": "+1 555 010 0100",
    "reached": true,
    "red_flags": ["asks_for_otp", "demands_secrecy"],
    "content_hash": "sha256..."
  },
  "flies": [
    {
      "id": "A",
      "generation": 1,
      "ttl_hours": 1,
      "persona_id": "giant-fiber",
      "persona": { "cell_type": "DNp01", "body_id": 10001, "vfb_id": "VFB_jrmc30my" }
    },
    {
      "id": "B",
      "generation": 1,
      "ttl_hours": 1,
      "persona_id": "da1-olfactory-pn",
      "persona": { "cell_type": "DA1_lPN", "body_id": 10075, "vfb_id": "VFB_jrmc37gy" }
    }
  ]
}
```
