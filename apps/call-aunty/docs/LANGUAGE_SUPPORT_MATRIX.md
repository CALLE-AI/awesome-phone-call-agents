# Language Support Matrix

| Code | UI | RTL | Translation status | CALL-E spoken | Voice UI | Offline pack |
|------|----|-----|-------------------|---------------|----------|--------------|
| `en` | ✅ | LTR | complete | ✅ (`en`, `en-us`, `en-gb`) | ✅ | ✅ |
| `bn` | ✅ | LTR | complete (core V8 namespaces) | ❌ (UI only) | ✅ | ✅ |
| `hi` | ✅ | LTR | partial | ❌ | ✅ | ✅ |
| `ur` | ✅ | RTL | partial | ❌ | ✅ | ✅ |
| `ta` | ✅ | LTR | partial (fallback to English for gaps) | ❌ | ✅ | ✅ |
| `te` | ✅ | LTR | partial (fallback to English for gaps) | ❌ | ✅ | ✅ |

## CALL-E provider truth

Supported spoken languages (from `@call-e/calle` capabilities): **English, Spanish, French**.

Bangla/Hindi/Urdu/Tamil/Telugu UI does **not** imply spoken CALL-E support. The app surfaces fallback via `calle.resolveCallLanguage`.

## Adding a language

1. Add code to `lib/language.ts` (`AppLanguage`)
2. Register in `lib/i18n/language-registry.ts`
3. Add locale pack under `lib/i18n/locales/`
4. Run `pnpm run i18n:check`
