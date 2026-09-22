<script lang="ts">
	import { onMount } from 'svelte'
	import { getOrmaApiUrl, getPublishableKey, getSupabase } from '$lib/supabase'
	import { Button, Field } from '$lib/ui'

	let { onverified }: { onverified: () => void | Promise<void> } = $props()

	let code = $state('')
	let expiresAt = $state<string | null>(null)
	let error = $state('')
	let message = $state('')
	let busy = $state(false)
	let now = $state(Date.now())

	const resendAt = $derived(expiresAt ? new Date(expiresAt).getTime() : 0)
	const canResend = $derived(!expiresAt || now >= resendAt)
	const resendLabel = $derived(
		!expiresAt
			? 'Call me with a code'
			: canResend
				? 'Resend call'
				: `Resend available ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(resendAt))}`
	)

	onMount(() => {
		const timer = window.setInterval(() => (now = Date.now()), 30_000)
		return () => window.clearInterval(timer)
	})

	function responseError(payload: unknown, fallback: string) {
		return payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
			? (payload as { error: string }).error
			: fallback
	}

	async function start() {
		error = ''
		message = ''
		busy = true
		try {
			const { data, error: sessionError } = await getSupabase().auth.getSession()
			if (sessionError) throw sessionError
			if (!data.session?.access_token) throw new Error('Sign in, then try again.')
			const response = await fetch(`${getOrmaApiUrl()}/functions/v1/confirm-phone`, {
				method: 'POST',
				headers: {
					apikey: getPublishableKey(),
					authorization: `Bearer ${data.session.access_token}`,
					'content-type': 'application/json'
				}
			})
			const payload = (await response.json().catch(() => null)) as { expires_at?: unknown } | null
			if (!response.ok) throw new Error(responseError(payload, 'Could not request a confirmation call.'))
			if (typeof payload?.expires_at !== 'string') throw new Error('The confirmation call returned no expiry time.')
			expiresAt = payload.expires_at
			now = Date.now()
			message = 'Orma is calling with a six-digit code. Enter it here after you hear it.'
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not request a confirmation call.'
		} finally {
			busy = false
		}
	}

	async function verify() {
		error = ''
		message = ''
		if (!/^\d{6}$/.test(code)) {
			error = 'Enter the six digits from the call.'
			return
		}
		busy = true
		try {
			const { data, error: rpcError } = await getSupabase().rpc('verify_phone_code', { code })
			if (rpcError) throw rpcError
			if (!data) throw new Error('That code could not confirm this number. Request another call if it expired.')
			message = 'Number confirmed.'
			await onverified()
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not confirm that code.'
		} finally {
			busy = false
		}
	}
</script>

<section class="confirm" aria-labelledby="confirmation-title">
	<h2 id="confirmation-title">Confirm your number</h2>
	<p>Orma calls once with a six-digit code. No daily call is placed until you enter it.</p>
	<div class="actions">
		<Button type="button" onclick={start} disabled={busy || !canResend}>{resendLabel}</Button>
	</div>
	{#if expiresAt}
		<p class="hint">The code expires at {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(expiresAt))}.</p>
		<div class="verify">
			<Field label="Six-digit code" error={error || undefined}>
				<input bind:value={code} inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void verify() } }} />
			</Field>
			<div class="actions"><Button type="button" onclick={verify} disabled={busy}>Confirm number</Button></div>
		</div>
	{:else if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	{#if message}<p class="message" aria-live="polite">{message}</p>{/if}
</section>

<style>
	.confirm { display: flex; flex-direction: column; gap: var(--space-3); }
	h2, p { margin: 0; }
	h2 { color: var(--text); font-size: var(--font-size-xl); }
	p { color: var(--text); font-size: var(--font-size-sm); line-height: var(--line-snug); }
	.hint { color: var(--text-muted); }
	.error { color: var(--danger); }
	.message { color: var(--success); }
	.verify { display: flex; flex-direction: column; gap: var(--space-3); }
	.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
