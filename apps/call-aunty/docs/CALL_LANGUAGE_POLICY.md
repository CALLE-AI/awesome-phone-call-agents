# Call Language Policy

## UI ≠ phone language

A CHW may use **English UI** while placing a **Bangla-preference** call. UI strings come from `preferences.ui`; CALL-E uses `preferences.call`.

## Capability resolver

`server/calle/call-language-capability.ts` + tRPC `calle.resolveCallLanguage`:

1. If requested language is provider-supported → use it
2. Else try backup → organization default → `en`
3. Always `preservePreference: true` (preference stored even when unsupported)
4. Surface honest limitation in call preparation UI

## Fallback chain (visible)

```
requested → backup → organization default → supported English → human handoff
```

## Supported spoken languages

See `server/calle/capabilities.ts`: `en`, `en-us`, `en-gb`, `es`, `fr`.

Bangla (`bn`) is explicitly listed in `unsupportedClaims`.

## Client

- `app/chw/calls.tsx` shows unsupported call-language banner
- Call prompt packs remain separate from UI namespaces (server-side, ongoing)
