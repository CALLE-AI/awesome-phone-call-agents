# AI Language Policy

## Separation

| Context | Source | Notes |
|---------|--------|-------|
| User UI | `preferences.ui` | Drives in-app copy |
| Beneficiary | Profile / care record | Communication preference |
| AI responses | `preferences.ai` | System prompts localized per language pack (incremental) |
| Structured facts | Language-independent enums | e.g. `appointment_confirmed` |

## Rules

1. AI must not infer language from a single user utterance alone when a preference exists.
2. Structured extraction stays language-independent; summaries may be localized separately.
3. Protected glossary terms must not be silently rewritten by AI translation.
4. Safety-critical content uses approved templates, not blind MT.

## Implementation

- Client: `contexts/language-context.tsx` exposes `preferences.ai`
- Server: extend `server/ai/prompts/registry.ts` with language-specific templates (ongoing)
- Glossary enforcement: `lib/i18n/glossary.ts`
