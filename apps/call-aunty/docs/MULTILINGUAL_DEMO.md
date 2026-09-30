# Multilingual Demo Guide

## Quick judge path

1. **Settings → Language** (`/language`) — switch English → Bangla → Hindi → Urdu (RTL)
2. **Settings → Plans & pricing** — localized billing copy
3. **CHW → Call command center** — Bangla UI + Bangla call preference shows honest CALL-E fallback banner
4. **Hero demo** — synthetic call workflow (dry-run safe)

## Scenarios

| UI | Call pref | Expected |
|----|-----------|----------|
| Bangla | `bn` | Bangla UI; CALL-E falls back to `en` with banner |
| English | `bn` | English UI; same call fallback |
| Urdu | `en` | RTL layout; English spoken call supported |
| Hindi | `en` | Hindi UI partial; English reports default |

## Personas (synthetic)

Demo beneficiaries should reflect Bangla, Hindi, Urdu, Tamil, Telugu, and English-speaking CHWs — all fictional identities.

## Commands

```bash
pnpm run test:i18n
pnpm run i18n:check
pnpm run test:calle
```
