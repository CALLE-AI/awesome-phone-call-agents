# Localization Release Audit (V8)

## Completed in this pass

- [x] Language registry with six UI languages
- [x] Namespace architecture + `t()` with English fallback
- [x] Separate UI / call / AI / notification / report preference model
- [x] Language selection screen with search and native names
- [x] `LanguageProvider` for instant switching
- [x] RTL direction for Urdu + icon flip policy
- [x] Locale formatting utilities (date, number, currency, digits)
- [x] CALL-E language capability resolver (honest Bangla unsupported)
- [x] Billing + calls + settings migrated off inline bn/en ternaries
- [x] Protected glossary for safety terms
- [x] CI: `pnpm run i18n:check`
- [x] Documentation set

## Remaining (incremental)

- [ ] Migrate all `lib/*-copy.ts` into unified namespaces
- [ ] Full Tamil/Telugu human-reviewed translations
- [ ] First-launch language modal wired to root navigator
- [ ] Server-side localized error catalog for all tRPC codes
- [ ] Multilingual demo personas in mock data
- [ ] PDF/export/report language selection
- [ ] Push/SMS/email template localization (server)
- [ ] AI prompt packs per language
- [ ] Translation quality dashboard (internal)

## Verification

```bash
pnpm check
pnpm run test:i18n
pnpm run test:billing
pnpm run test:calle
pnpm run i18n:check
```

## Release gate

Do not declare V8 complete until remaining items are addressed and a full QA pass covers RTL, offline, billing, and CALL-E mock workflows in all six UI languages.
