<script lang="ts">
	import { goto } from '$app/navigation'
	import { onMount } from 'svelte'
	import { getOrmaApiUrl, getPublishableKey, getSupabase } from '$lib/supabase'
	import { lookupProfileExists, postAuthPath } from '../../app/onboarding/profile-gate'
	import { Wordmark } from '$lib/shell'

	let { data } = $props()
	let message = $state('Signing you in.')

	onMount(async () => {
		if (data.error) {
			message = data.error
			return
		}
		const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
		const params = new URLSearchParams(hash)
		const accessToken = params.get('access_token')
		const refreshToken = params.get('refresh_token')
		if (accessToken && refreshToken) {
			const { error } = await getSupabase().auth.setSession({
				access_token: accessToken,
				refresh_token: refreshToken
			})
			if (error) {
				message = error.message
				return
			}
			window.history.replaceState(null, '', window.location.pathname)
			const { data: userData } = await getSupabase().auth.getUser()
			const userId = userData.user?.id
			const hasProfile = userId
				? await lookupProfileExists({
						apiUrl: getOrmaApiUrl(),
						anonKey: getPublishableKey(),
						accessToken: accessToken,
						userId
					})
				: false
			await goto(postAuthPath(hasProfile), { replaceState: true })
			return
		}
		if (!window.location.search.includes('code=') && !window.location.search.includes('token_hash=')) {
			message = 'This sign-in link is missing its token. Request a new one.'
		}
	})
</script>

<svelte:head>
	<title>Signing in · Orma</title>
</svelte:head>

<main>
	<section class="card">
		<header class="brand">
			<Wordmark height="2.25rem" />
		</header>
		<p class="status" role="status">{message}</p>
		<p class="back"><a href="/login">Back to sign in</a></p>
	</section>
</main>

<style>
	main {
		display: flex;
		justify-content: center;
		padding: var(--space-12) var(--space-4) var(--space-16);
	}

	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-5);
		width: min(24rem, 100%);
		padding: var(--space-8) var(--space-6);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-xl);
		box-shadow: var(--elevation-2);
		text-align: center;
	}

	.brand {
		display: flex;
		justify-content: center;
	}

	.status {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-base);
		line-height: var(--line-snug);
	}

	.back {
		margin: 0;
	}
	.back a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-target);
		color: var(--brand);
		font-size: var(--font-size-sm);
		text-decoration: none;
	}
	.back a:hover {
		text-decoration: underline;
	}
</style>
