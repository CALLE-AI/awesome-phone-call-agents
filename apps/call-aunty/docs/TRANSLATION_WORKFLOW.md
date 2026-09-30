# Translation Workflow

## Statuses

| Status | Meaning |
|--------|---------|
| `machine draft` | Auto-generated, not reviewed |
| `human reviewed` | Reviewed by native speaker |
| `approved` | Safe for production |
| `retired` | Do not use |

Critical safety strings (`emergency`, `consent`, `urgent`, `medication`) require **approved** status before release.

## Process

1. Add English key to `lib/i18n/locales/en.ts`
2. Mirror key in all locale files (`bn`, `hi`, `ur`, `ta`, `te`)
3. Preserve `{placeholders}` exactly
4. Run `pnpm run i18n:check`
5. Update glossary in `lib/i18n/glossary.ts` for product terms

## Do not

- Use English phrases as key IDs
- Machine-translate emergency copy without review
- Concatenate translated fragments for notifications
