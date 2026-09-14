# Yard Search (Optional)

Search is a helper, not a call. It produces candidates. The user picks a yard and confirms the number.

Use the **current harness's native web search**. Do not add Firecrawl, Browserbase, Exa, a crawl API, or a `.env` to this skill. Claude Code, Cursor, Codex, Hermes, and other Agent Skills hosts already search the web. Use that tool. If the host has no web search, skip crawl and ask the user for a yard and number.

## When To Search

- The user has a part but no yard
- The user wants two or three local candidates before authorizing a call

## When Not To Search

- You already have an authorized yard and number
- The user asked only to preview or dial
- You would have to guess a city
- The host has no native web search

## Build Queries

```bash
node scripts/search-query.mjs --year 2016 --make Honda --model Civic --part radiator --city Accra
```

Then pass those strings to the host web-search tool. Do not fetch or scrape pages from this skill.

Typical queries:

```text
2016 Honda Civic used radiator salvage yard Accra
Honda Civic radiator junkyard near Accra phone
```

Prefer yards with a published phone number. Still wait for the user to confirm that number.

## After Search

1. Show at most five candidates: name, locality, masked phone if present.
2. Ask which yard to use, or ask the user to paste an E.164 number.
3. Run `scripts/preview-yard-call.mjs`.
4. Call only after an explicit "call them."

Do not chain search → dial in one step. Do not call the first result.
