<script lang="ts">
	import { goto } from '$app/navigation'
	import { onMount } from 'svelte'
	import { TELEGRAM_BOT_USERNAME } from '$lib/telegram-link'
	import { Wordmark } from '$lib/shell'
	import {
		getOrmaApiUrl,
		getPublishableKey,
		getSupabase,
		LOGIN_CALLBACK_URL,
		postAuthTelegram,
		sessionTokensFromUnknown,
		type TelegramWidgetUser
	} from '$lib/supabase'
	import { Button, Field } from '$lib/ui'
	import { lookupProfileExists, postAuthPath } from '../app/onboarding/profile-gate'

	let email = $state('')
	let status = $state('')
	let error = $state('')
	let busy = $state(false)
	let widgetHost: HTMLDivElement | undefined = $state()

	async function sendLink(event: Event) {
		event.preventDefault()
		error = ''
		status = ''
		const address = email.trim()
		if (!address) {
			error = 'Enter an email address.'
			return
		}
		busy = true
		try {
			const { error: otpError } = await getSupabase().auth.signInWithOtp({
				email: address,
				options: {
					emailRedirectTo: LOGIN_CALLBACK_URL,
					shouldCreateUser: true
				}
			})
			if (otpError) throw otpError
			status = 'Check your email for the sign-in link.'
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not send the sign-in link'
		} finally {
			busy = false
		}
	}

	async function completeTelegram(user: TelegramWidgetUser) {
		error = ''
		status = ''
		busy = true
		try {
			const payload = await postAuthTelegram(user)
			const tokens = sessionTokensFromUnknown(payload)
			if (!tokens) {
				throw new Error('Telegram sign-in returned no session')
			}
			const { error: setError } = await getSupabase().auth.setSession(tokens)
			if (setError) throw setError
			const { data: userData } = await getSupabase().auth.getUser()
			const userId = userData.user?.id
			if (!userId) throw new Error('Telegram sign-in returned no user')
			const hasProfile = await lookupProfileExists({
				apiUrl: getOrmaApiUrl(),
				anonKey: getPublishableKey(),
				accessToken: tokens.access_token,
				userId
			})
			await goto(postAuthPath(hasProfile))
		} catch (err) {
			error = err instanceof Error ? err.message : 'Telegram sign-in failed'
		} finally {
			busy = false
		}
	}

	onMount(() => {
		const host = widgetHost
		if (!host) return
		const win = window as Window & { onTelegramAuth?: (user: TelegramWidgetUser) => void }
		win.onTelegramAuth = (user) => {
			void completeTelegram(user)
		}
		const script = document.createElement('script')
		script.async = true
		script.src = 'https://telegram.org/js/telegram-widget.js?22'
		script.setAttribute('data-telegram-login', TELEGRAM_BOT_USERNAME)
		script.setAttribute('data-size', 'large')
		script.setAttribute('data-radius', 'true')
		script.setAttribute('data-request-access', 'write')
		script.setAttribute('data-onauth', 'onTelegramAuth(user)')
		host.replaceChildren(script)
		return () => {
			win.onTelegramAuth = undefined
			host.replaceChildren()
		}
	})
</script>

<svelte:head>
	<title>Sign in · Orma</title>
</svelte:head>

<main>
	<section class="card">
		<header class="brand">
			<Wordmark height="2.25rem" />
			<p class="gloss">ഓർമ്മ · it remembers what you keep not doing.</p>
		</header>

		<p class="lede">Sign in to set up your daily call.</p>

		<form class="form" onsubmit={sendLink}>
			<Field label="Email">
				<input
					type="email"
					name="email"
					autocomplete="email"
					placeholder="you@example.com"
					bind:value={email}
					required
				/>
			</Field>
			<Button type="submit" disabled={busy}>Email me a sign-in link</Button>
			<p class="hint">No password. The link signs you in on this device.</p>
		</form>

		<div class="divider" role="separator">
			<span class="hair"></span>
			<span class="or">or</span>
			<span class="hair"></span>
		</div>

		<div class="telegram">
			<div class="widget" bind:this={widgetHost}></div>
			<p class="hint">Orma sees your Telegram name and id. Never your messages.</p>
		</div>

		{#if status}
			<p class="status" role="status">{status}</p>
		{/if}
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
	</section>

	<p class="foot-hint">
		Telegram-only sign-in starts here. To add Telegram to an email account, open Settings after
		you sign in.
	</p>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-12) var(--space-4) var(--space-16);
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		width: min(24rem, 100%);
		padding: var(--space-8) var(--space-6);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-xl);
		box-shadow: var(--elevation-2);
	}

	.brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		text-align: center;
	}
	.gloss {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}

	.lede {
		margin: 0;
		color: var(--text);
		font-size: var(--font-size-lg);
		font-weight: var(--weight-semibold);
		text-align: center;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		line-height: var(--line-snug);
	}

	.divider {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.hair {
		flex: 1;
		border-top: 1px solid var(--border);
	}
	.or {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}

	.telegram {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
	}
	.widget {
		display: flex;
		justify-content: center;
		min-height: var(--tap-target);
	}

	.status,
	.error {
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.status {
		color: var(--success);
	}
	.error {
		color: var(--danger);
	}

	.foot-hint {
		max-width: 24rem;
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		line-height: var(--line-snug);
		text-align: center;
	}
</style>
