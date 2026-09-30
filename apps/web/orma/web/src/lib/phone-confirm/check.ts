function fail(message: string): never {
	throw new Error(`phone confirmation boundary check failed: ${message}`)
}

// svelte-check carries no Node types, so load fs with a local shape.
const fsModule = 'node:' + 'fs'
const { readFileSync } = (await import(fsModule)) as {
	readFileSync: (path: URL, encoding: 'utf8') => string
}
const component = readFileSync(new URL('./PhoneConfirm.svelte', import.meta.url), 'utf8')
const onboarding = readFileSync(new URL('../../routes/app/onboarding/+page.svelte', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../../routes/app/settings/+page.svelte', import.meta.url), 'utf8')
const verifierCalls = component.match(/\.rpc\('verify_phone_code'/g) ?? []

if (verifierCalls.length !== 1) fail(`expected one verifier RPC, found ${verifierCalls.length}`)
if (/<form\b|onsubmit=/.test(component)) fail('the verifier must not create a form inside its host form')
if (!/<Button type="button" onclick=\{verify\}/.test(component)) {
	fail('the verifier control must be a button, not a submit control')
}
for (const [name, host, submit] of [
	['onboarding', onboarding, 'onsubmit={startCalls}'],
	['Settings', settings, 'onsubmit={saveProfile}']
] as const) {
	if (!host.includes('<PhoneConfirm') || !host.includes(submit)) {
		fail(`${name} does not mount the verifier inside its profile form`)
	}
}

// Both hosts use forms for profile setup. A form-free verifier can only issue its
// own RPC. It cannot submit either host form and therefore cannot write profiles
// or slots while a code is being checked.
console.log('phone confirmation boundary check passed')
