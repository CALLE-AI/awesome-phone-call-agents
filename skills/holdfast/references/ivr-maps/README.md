# IVR Map Library

An IVR map is a JSON file describing one organization's phone tree as observed
by completed HoldFast calls. Maps let the next call skip exploratory
navigation and go straight down a known path.

One file per organization: `<organization-slug>.json`. Committed sample maps
must use fictional reserved numbers (`+1-202-555-01xx`).

## Schema

```json
{
  "schema_version": "1.0",
  "organization": "example-airlines",
  "display_name": "Example Airlines",
  "numbers": ["+12025550123"],
  "locale": "en-US",
  "languages": ["en"],
  "known_paths": [
    {
      "goal": "claim status",
      "path": [
        {"level": 1, "prompt_summary": "main menu", "keypress": "2", "meaning": "existing claim"},
        {"level": 2, "prompt_summary": "claim menu", "keypress": "1", "meaning": "claim status"},
        {"level": 3, "prompt_summary": "agent option", "keypress": "0", "meaning": "human agent"}
      ],
      "confidence": "observed",
      "observations": 1,
      "last_observed": "2026-09-11"
    }
  ],
  "hold_profile": {
    "typical_seconds": 210,
    "max_observed_seconds": 210,
    "best_time_local": null
  },
  "operator_fallback": {"keypress": "0", "authorized": true},
  "notes": [],
  "last_verified": "2026-09-11",
  "contributions": [{"date": "2026-09-11", "source": "holdfast-skill"}]
}
```

## Rules

- Maps describe phone trees, never callers. No names, account numbers,
  reference numbers, or transcript content in a map.
- Committed maps may carry only publicly listed organizational numbers
  (government information lines, published business switchboards) or
  fictional reserved samples; never personal or private numbers.
- `confidence` is one of `observed` (a call walked this path), `reported`
  (a human told us), or `stale` (contradicted by a later call).
- `operator_fallback.authorized` reflects what the user authorized for calls
  to this organization, not what the IVR happens to offer.
- Update via `scripts/map_update.py`; do not hand-edit observed counts.
