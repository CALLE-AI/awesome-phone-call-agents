#!/usr/bin/env node
/**
 * Pin F1 and F2. Login posts the widget with no Authorization.
 * Settings attach sends the user JWT as Bearer, never the anon key.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const login = readFileSync(join(root, 'src/routes/login/+page.svelte'), 'utf8')
const settings = readFileSync(join(root, 'src/routes/app/settings/+page.svelte'), 'utf8')
const supabase = readFileSync(join(root, 'src/lib/supabase.ts'), 'utf8')

function fail(message) {
	throw new Error(message)
}

if (/authorization:\s*`Bearer \$\{key\}`/.test(login)) {
	fail('login must not send the publishable key as Bearer')
}
if (/['"]authorization['"]\s*:/.test(login) || /authorization:\s*`Bearer/.test(login)) {
	fail('login Telegram POST must omit Authorization')
}
if (!/postAuthTelegram\(\s*user\s*\)/.test(login)) {
	fail('login must post the widget with no accessToken')
}

if (!/postAuthTelegram\(\s*user,\s*\{\s*accessToken/.test(settings)) {
	fail('settings widget must post with the user accessToken')
}
if (!/setSession\(tokens\)/.test(settings)) {
	fail('settings attach must setSession with returned tokens')
}

if (/Bearer \$\{getPublishableKey/.test(supabase) || /Bearer \$\{key\}/.test(supabase)) {
	fail('postAuthTelegram must never put the publishable key in Bearer')
}
if (!/headers\.authorization = `Bearer \$\{options\.accessToken\}`/.test(supabase)) {
	fail('signed-in attach must send Bearer options.accessToken')
}
if (!/if \(options\?\.accessToken\)/.test(supabase)) {
	fail('Authorization must be gated on a user accessToken')
}

console.log('auth-telegram header check passed')
