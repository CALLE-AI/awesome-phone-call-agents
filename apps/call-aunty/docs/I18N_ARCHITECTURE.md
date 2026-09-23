# I18N Architecture (V8)

Call Aunty V8 separates **UI language**, **call/phone language**, **AI response language**, **notification language**, and **report language**. These may differ per user, beneficiary, and organization policy.

## Layers

| Layer | Location | Purpose |
|-------|----------|---------|
| Language registry | `lib/i18n/language-registry.ts` | Canonical codes, locales, RTL, translation status, provider capabilities |
| Namespaces | `lib/i18n/locales/*.ts` | Domain keys: `common`, `errors`, `billing`, `calls`, `settings`, `onboarding` |
| Translator | `lib/i18n/translate.ts` | `t(key, { language, values })` with fallback → English |
| Preferences | `lib/i18n/preferences.ts` | Persisted UI / call / AI / notification / report prefs |
| React context | `contexts/language-context.tsx` | Instant UI switching + direction |
| Locale format | `lib/i18n/locale-format.ts` | Dates, numbers, currency, phone display |
| RTL | `lib/i18n/rtl.ts` | Direction, icon flip policy, dev RTL harness |
| Glossary | `lib/i18n/glossary.ts` | Protected safety terms |
| CALL-E resolver | `server/calle/call-language-capability.ts` | Honest spoken-language support |

## Key conventions

- Keys use dotted namespaces: `billing.title`, `calls.heroDemo`
- Structured enums stay language-independent; display layer translates
- English is the canonical key source; missing keys fall back to English
- Never show raw keys in production

## Legacy copy

Existing `lib/*-copy.ts` modules remain for woman/CHW flows. New surfaces use `lib/i18n`. Migration continues incrementally.

## Offline

Selected UI language pack is bundled (TypeScript locale modules). User preference persists in AsyncStorage.

## CI

```bash
pnpm run i18n:check
```
