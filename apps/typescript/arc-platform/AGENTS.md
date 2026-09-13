<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Prisma: null on a nullable column does not mean what it looks like

Three times now a filter has silently matched **zero rows** instead of erroring,
and each time it read as correct code:

- `rateConfirmed: { not: true }` on a nullable Boolean — `NOT(NULL = true)` is
  `NULL` in SQL, so every unconfirmed row was dropped. Use
  `OR: [{ f: false }, { f: null }]`.
- `transcript: { equals: null }` on a `Json` column — that means "the JSON value
  `null`", not "no value". Use `equals: Prisma.DbNull` (and `Prisma.JsonNull`
  when you really do mean a stored JSON null).
- Same shape either way: the query returns `[]`, nothing throws, and the report
  reads "0 rows affected" as if that were the answer.

**Always check a zero-row result against a raw count before believing it.**
