#!/usr/bin/env node
/**
 * place-call.mjs — place a consumer call through the CALL-E Developer API using
 * a task + strict result schema produced by build-task.mjs.
 *
 * SAFETY: dry-run by DEFAULT. Without --execute this NEVER dials — it prints the
 * plan (masked recipients, the task, the schema, and the exact request) so a
 * human can review and consent first. Placing a real call requires BOTH
 * --execute AND a CALLE_API_KEY in the environment.
 *
 * Why the API (not the `calle call ... --goal` CLI): only the API's create body
 * accepts a custom strict `result_schema` / `recipient_result_schema`, which is
 * the whole point of this skill. For a quick goal-only call with no schema, the
 * `calle call start --to-phone <E164> --goal "<task>"` CLI is a fine alternative.
 *
 * Usage:
 *   node place-call.mjs --body plan.json --to-phone +14155550123               # dry-run preview
 *   node place-call.mjs --body plan.json --to-phone +14155550123 --execute     # place the call
 *   node place-call.mjs --body plan.json --to-phone +1... --to-phone +1... --execute --poll   # batch + wait
 *
 * --body is the JSON emitted by build-task.mjs ({ task, result_schema, recipient_result_schema? }).
 * Env: CALLE_API_KEY (required for --execute), CALLE_BASE_URL (default https://api.heycall-e.com).
 */

import { readFileSync } from 'node:fs'

const TERMINAL = new Set(['completed', 'failed', 'canceled'])

function parseArgs(argv) {
  const out = { toPhones: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--execute') out.execute = true
    else if (a === '--poll') out.poll = true
    else if (a === '--body') out.body = argv[++i]
    else if (a === '--to-phone') out.toPhones.push(argv[++i])
    else if (a === '--region') out.region = argv[++i]
    else if (a === '--locale') out.locale = argv[++i]
  }
  return out
}

function maskPhone(p) {
  if (!p) return '(none)'
  const digits = p.replace(/[^\d+]/g, '')
  if (digits.length <= 4) return digits
  return `${digits.slice(0, 3)}${'•'.repeat(Math.max(0, digits.length - 5))}${digits.slice(-2)}`
}

function die(msg) {
  process.stderr.write(`${msg}\n`)
  process.exit(1)
}

async function poll(baseUrl, apiKey, id) {
  process.stderr.write(`Polling ${id} (every 10s)…\n`)
  for (;;) {
    const r = await fetch(`${baseUrl}/v1/calls/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const call = await r.json()
    if (!r.ok) die(`Status check failed: ${call?.error?.message ?? r.status}`)
    if (TERMINAL.has(call.status)) return call
    await new Promise((res) => setTimeout(res, 10_000))
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.body) die('Provide --body <plan.json> (output of build-task.mjs).')
  if (args.toPhones.length === 0) die('Provide at least one --to-phone <E164>.')
  for (const p of args.toPhones) {
    if (!/^\+[1-9]\d{6,14}$/.test(p)) die(`"${p}" is not an E.164 phone (e.g. +14155550123). Not guessing.`)
  }

  let plan
  try {
    plan = JSON.parse(readFileSync(args.body, 'utf8'))
  } catch (e) {
    die(`Could not read --body: ${e.message}`)
  }
  if (!plan?.task) die('The --body file has no `task`. Run build-task.mjs first.')
  if (Array.isArray(plan.missing_required) && plan.missing_required.length) {
    die(`Refusing: build-task reported missing required fields: ${plan.missing_required.join(', ')}.`)
  }

  const region = args.region || 'US'
  const locale = args.locale || 'en-US'
  const batch = args.toPhones.length > 1

  const requestBody = {
    task: plan.task,
    recipients: args.toPhones.map((phone) => ({ phones: [phone], region, locale })),
    result_schema: plan.result_schema ?? undefined,
    recipient_result_schema: batch ? plan.recipient_result_schema ?? undefined : undefined,
  }

  // ---- Dry-run preview (default) --------------------------------------
  if (!args.execute) {
    process.stdout.write(
      [
        'DRY RUN — no call placed. Review, get consent, then re-run with --execute.',
        '',
        `Playbook:   ${plan.label ?? plan.playbook ?? 'custom'}`,
        `Recipients: ${args.toPhones.map(maskPhone).join(', ')}  (${region} / ${locale})`,
        batch ? 'Mode:       batch (per-recipient + aggregate schemas)' : 'Mode:       single call',
        '',
        'Task the agent will follow:',
        plan.task.split('\n').map((l) => `  ${l}`).join('\n'),
        '',
        'Structured result contract (result_schema keys): ' +
          Object.keys(plan.result_schema?.properties ?? {}).join(', '),
        '',
        'This will POST to CALL-E:',
        JSON.stringify({ ...requestBody, recipients: requestBody.recipients.map((r) => ({ ...r, phones: r.phones.map(maskPhone) })) }, null, 2),
      ].join('\n') + '\n',
    )
    return
  }

  // ---- Execute --------------------------------------------------------
  const apiKey = process.env.CALLE_API_KEY
  if (!apiKey) die('--execute requires CALLE_API_KEY in the environment.')
  const baseUrl = (process.env.CALLE_BASE_URL || 'https://api.heycall-e.com').replace(/\/$/, '')

  process.stderr.write(`Placing ${batch ? `${args.toPhones.length} calls` : 'call'} → ${args.toPhones.map(maskPhone).join(', ')}\n`)
  const r = await fetch(`${baseUrl}/v1/calls`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })
  const created = await r.json()
  if (!r.ok) die(`CALL-E rejected the call: ${created?.error?.code ?? r.status} — ${created?.error?.message ?? ''}`)

  const id = created.id
  process.stdout.write(JSON.stringify({ id, status: created.status ?? 'queued' }, null, 2) + '\n')

  if (args.poll) {
    const final = await poll(baseUrl, apiKey, id)
    process.stdout.write(
      JSON.stringify(
        {
          id: final.id,
          status: final.status,
          task_completed: final.task_completed,
          completion_confidence: final.completion_confidence,
          structured_result: final.structured_result,
          recipients: (final.recipients ?? []).map((rec) => ({
            phone: maskPhone(rec.phones?.[0]),
            status: rec.status,
            structured_result: rec.structured_result,
          })),
        },
        null,
        2,
      ) + '\n',
    )
  }
}

main().catch((e) => die(e.message))
